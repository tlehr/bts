"""DSP invariants for the isolated listening comparison; no model inference."""
import copy
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from tts_match_audio import adaptive_pause, clean_source, dbfs, edge_quiet, edit_piece_timing, optimize_spec, prepare_piece


@pytest.fixture
def profile():
    return json.loads((ROOT / "scripts/tts-match-listening-optimization.json").read_text())


def test_source_cleanup_does_not_touch_adjacent_words_or_original(profile):
    edit = profile["source_cleanups"]["game"][0]
    x = np.random.default_rng(42).normal(0, .01, edit["end_frame"] + 2400).astype(np.float32)
    original = x.copy()
    y, changes = clean_source("game", x, edit["source_sha256"], profile)
    assert np.array_equal(x, original)
    assert np.array_equal(y[:edit["start_frame"]], x[:edit["start_frame"]])
    assert np.array_equal(y[edit["end_frame"]:], x[edit["end_frame"]:])
    assert changes[0]["after_dbfs"] < changes[0]["before_dbfs"]
    with pytest.raises(ValueError, match="another source"):
        clean_source("game", x, "0" * 64, profile)


def test_edge_cleanup_retains_complete_signal_and_protective_margins(profile):
    speech = (.1 * np.sin(np.arange(4800) * 2 * np.pi * 150 / 24000)).astype(np.float32)
    x = np.concatenate([np.zeros(6000, np.float32), speech, np.zeros(6000, np.float32)])
    y, changes = prepare_piece("test", x, profile)
    a = 6000 - round(changes["trim_start_ms"] * 24)
    assert np.array_equal(y[a:a + len(speech)], speech)
    assert changes["trim_start_ms"] <= profile["max_leading_trim_ms"]
    assert changes["trim_end_ms"] <= profile["max_trailing_trim_ms"]
    leading, trailing = edge_quiet(y, profile["edge_threshold_dbfs"])
    assert leading >= profile["keep_leading_ms"] - 5
    assert trailing >= profile["keep_trailing_ms"] - 5


def test_pause_subtracts_existing_quiet_and_never_becomes_negative():
    speech = np.ones(2400, np.float32) * .1
    left = np.concatenate([speech, np.zeros(2400, np.float32)])
    right = np.concatenate([np.zeros(1200, np.float32), speech])
    pause, detail = adaptive_pause(left, right, 250)
    assert pause == 100
    assert detail["signal_quiet_ms"] == 250
    pause, detail = adaptive_pause(left, right, 60)
    assert pause == 0
    assert detail["signal_quiet_ms"] == 150


def test_short_edge_fades_preserve_middle_of_active_words(profile):
    x = np.full(2400, .1, np.float32)
    y, changes = prepare_piece("test", x, profile)
    fade = round(profile["fade_ms"] * 24)
    assert y[0] == 0 and y[-1] == 0
    assert np.array_equal(y[fade:-fade], x[fade:-fade])
    assert changes["fades"] == {"in_ms": 5, "out_ms": 5}


def test_dbfs_measurement_has_expected_rms_scale():
    assert dbfs(np.ones(2400) * .1) == pytest.approx(-20)


def test_whole_game_reuse_keeps_all_calls_and_original_plan():
    plan = json.loads(subprocess.check_output(["node", str(ROOT / "scripts/tts-match-listening-plan.js")]))
    original = copy.deepcopy(plan)
    optimized = optimize_spec(plan)
    assert plan == original
    assert [c["id"] for c in optimized["cases"]] == [c["id"] for c in plan["cases"]]
    for case in optimized["cases"]:
        if case["id"].startswith("d12-"):
            assert [p["piece"] for p in case["parts"]][:2] == ["game", "walkover"]
        else:
            assert case == next(c for c in original["cases"] if c["id"] == case["id"])


def test_internal_pause_keeps_every_sample_and_rejects_active_speech():
    x = np.concatenate([np.ones(2400, np.float32) * .1, np.zeros(1200, np.float32),
        np.ones(2400, np.float32) * -.1])
    original = x.copy()
    edit = {"kind": "pause", "source_sha256": "fixed", "start_frame": 3500,
        "end_frame": 3500, "insert_ms": 180}
    profile = {"piece_timing": {"role": [edit]}}
    y, changes = edit_piece_timing("role", x, 500, "fixed", profile)
    assert np.array_equal(x, original)
    assert np.array_equal(y[:3000], x[:3000])
    assert np.array_equal(y[7320:], x[3000:])
    assert np.all(y[3000:7320] == 0)
    assert changes[0]["duration_change_ms"] == 180
    with pytest.raises(ValueError, match="another source"):
        edit_piece_timing("role", x, 500, "changed", profile)
    with pytest.raises(ValueError, match="active speech"):
        edit_piece_timing("role", np.ones_like(x) * .1, 500, "fixed", profile)


def test_regional_tempo_preserves_pitch_and_untouched_words():
    rate = 24000
    tone = (.1 * np.sin(np.arange(rate) * 2 * np.pi * 200 / rate)).astype(np.float32)
    x = np.concatenate([np.zeros(2400, np.float32), tone, np.zeros(2400, np.float32)])
    profile = {"piece_timing": {"prefix": [{"kind": "tempo", "source_sha256": "fixed",
        "start_frame": 3400, "end_frame": 27400, "speed": .88}]}}
    y, changes = edit_piece_timing("prefix", x, 1000, "fixed", profile)
    assert np.array_equal(y[:2400], x[:2400])
    assert np.array_equal(y[-2400:], x[-2400:])
    stretched = y[2400:-2400]
    assert len(stretched) / len(tone) == pytest.approx(1 / .88, abs=.03)
    frequency = np.fft.rfftfreq(len(stretched), 1 / rate)[np.argmax(abs(np.fft.rfft(stretched)))]
    assert frequency == pytest.approx(200, abs=2)
    assert changes[0]["duration_change_ms"] > 100


def test_feedback_pause_targets_apply_to_all_d05_variants_and_both_winners(profile):
    plan = json.loads(subprocess.check_output(["node", str(ROOT / "scripts/tts-match-listening-plan.js")]))
    optimized = optimize_spec(plan, profile)
    for case in optimized["cases"]:
        expected = [140, 120, 320, 160] if case["id"].startswith("d05-") else (
            [250, 140] if case["id"].startswith("d12-") else None)
        if expected:
            assert [p["pause_ms"] for p in case["parts"][:-1]] == expected[:len(case["parts"]) - 1]
        else:
            assert case == next(c for c in plan["cases"] if c["id"] == case["id"])
