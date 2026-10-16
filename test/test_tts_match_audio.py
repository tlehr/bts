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
from tts_match_audio import adaptive_pause, clean_source, dbfs, edge_quiet, optimize_spec, prepare_piece


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
