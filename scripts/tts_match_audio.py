"""Signal measurements and conservative, traceable edits for the fixed listening fixture."""
import copy
import json
from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 24000


def dbfs(samples):
    return float(20 * np.log10(max(float(np.sqrt(np.mean(np.asarray(samples, dtype=np.float64) ** 2))), 1e-12)))


def edge_quiet(samples, threshold_db=-48):
    """Return 5-ms-frame quiet margins; a signal measure, not phoneme recognition."""
    width = 120
    count = len(samples) // width
    if not count:
        return 0.0, 0.0
    levels = np.sqrt(np.mean(samples[:count * width].reshape(count, width).astype(np.float64) ** 2, axis=1))
    active = np.flatnonzero(levels > 10 ** (threshold_db / 20))
    if not len(active):
        return len(samples) / 24, len(samples) / 24
    return float(active[0] * 5), float((count - 1 - active[-1]) * 5)


def metrics(samples):
    leading, trailing = edge_quiet(samples)
    return {"duration_ms": round(len(samples) / 24, 3), "rms_dbfs": round(dbfs(samples), 2),
        "peak_dbfs": round(float(20 * np.log10(max(float(np.max(np.abs(samples))), 1e-12))), 2),
        "start_60ms_dbfs": round(dbfs(samples[:1440]), 2), "end_60ms_dbfs": round(dbfs(samples[-1440:]), 2),
        "leading_quiet_ms": leading, "trailing_quiet_ms": trailing,
        "start_sample": float(samples[0]), "end_sample": float(samples[-1])}


def audit(root):
    root = Path(root)
    report = json.loads((root / "report.json").read_text())
    clips, pieces, cases = {}, {}, []
    for name, info in report["pieces"].items():
        clips[name], rate = sf.read(root / info["file"], dtype="float32")
        if rate != RATE:
            raise ValueError("Unexpected sample rate")
        pieces[name] = metrics(clips[name])
        pieces[name]["audition_flags"] = []
        if not info["whole"] and pieces[name]["end_60ms_dbfs"] > -30:
            pieces[name]["audition_flags"].append("Aktiver Ausschnittrand; kein Nachweis einer abgeschnittenen Silbe")
        if pieces[name]["leading_quiet_ms"] >= 150:
            pieces[name]["audition_flags"].append("Langer leiser Vorlauf")
    for case in report["cases"]:
        joins = []
        for left, right in zip(case["parts"], case["parts"][1:]):
            a, b = pieces[left["piece"]], pieces[right["piece"]]
            joins.append({"from": left["piece"], "to": right["piece"], "inserted_ms": left["pause_ms"],
                "signal_quiet_ms": round(a["trailing_quiet_ms"] + left["pause_ms"] + b["leading_quiet_ms"], 3),
                "rms_difference_db": round(b["rms_dbfs"] - a["rms_dbfs"], 2)})
        cases.append({"id": case["id"], "joins": joins})
    return {"method": {"quiet_threshold_dbfs": -48, "frame_ms": 5,
        "scope": "Technische Messung, keine subjektive Hörnote; RMS ist kein LUFS-Wert und erkennt keine Wortbedeutung."},
        "pieces": pieces, "cases": cases}


def clean_source(name, samples, sha256, profile):
    result = samples.copy()
    changes = []
    for cleanup in profile.get("source_cleanups", {}).get(name, []):
        if cleanup["source_sha256"] != sha256:
            raise ValueError("Noise cleanup belongs to another source")
        start, end = cleanup["start_frame"], cleanup["end_frame"]
        if not 0 <= start < end <= len(result):
            raise ValueError("Invalid cleanup range")
        before = dbfs(result[start:end])
        fade = min(round(cleanup["fade_ms"] * 24), (end - start) // 2)
        envelope = np.zeros(end - start, dtype=np.float32)
        if fade:
            envelope[:fade] = np.linspace(1, 0, fade)
            envelope[-fade:] = np.linspace(0, 1, fade)
        result[start:end] *= envelope
        changes.append({**cleanup, "before_dbfs": round(before, 2), "after_dbfs": round(dbfs(result[start:end]), 2)})
    return result, changes


def prepare_piece(name, samples, profile):
    before = metrics(samples)
    leading, trailing = edge_quiet(samples, profile["edge_threshold_dbfs"])
    trim_start = max(0, min(leading - profile["keep_leading_ms"], profile["max_leading_trim_ms"]))
    trim_end = max(0, min(trailing - profile["keep_trailing_ms"], profile["max_trailing_trim_ms"]))
    a, b = round(trim_start * 24), len(samples) - round(trim_end * 24)
    result = samples[a:b].copy()
    if not len(result):
        raise ValueError("Edge edit removed all speech")
    fades = {"in_ms": 0, "out_ms": 0}
    fade = min(round(profile["fade_ms"] * 24), len(result) // 4)
    if name not in profile["preserve_full_blocks"] and fade:
        if dbfs(result[:480]) > -35 or abs(float(result[0])) > 0.001:
            result[:fade] *= np.linspace(0, 1, fade)
            fades["in_ms"] = fade / 24
        if dbfs(result[-480:]) > -35 or abs(float(result[-1])) > 0.001:
            result[-fade:] *= np.linspace(1, 0, fade)
            fades["out_ms"] = fade / 24
    gain_db = profile.get("piece_gain_db", {}).get(name, 0)
    if gain_db:
        gain = min(10 ** (gain_db / 20), 0.99 / max(float(np.max(np.abs(result))), 1e-12))
        result *= gain
        gain_db = 20 * np.log10(gain)
    return result, {"before": before, "after": metrics(result), "trim_start_ms": trim_start,
        "trim_end_ms": trim_end, "fades": fades, "gain_db": round(float(gain_db), 3)}


def optimize_spec(spec):
    result = copy.deepcopy(spec)
    for case in result["cases"]:
        if case["id"].startswith("d12-"):
            # Same spoken content, keep the already synthesized game block intact.
            case["parts"] = [{"piece": "game", "pause_ms": case["parts"][1]["pause_ms"]}, *case["parts"][2:]]
            case["note"] += " Im bearbeiteten Versuch bleibt der Spielblock am Stück; eine zusätzliche interne Montagepause entfällt."
    return result


def adaptive_pause(left, right, target_ms):
    trailing = edge_quiet(left)[1]
    leading = edge_quiet(right)[0]
    inserted = max(0.0, target_ms - trailing - leading)
    return inserted, {"target_ms": target_ms, "left_quiet_ms": trailing, "right_quiet_ms": leading,
        "inserted_ms": inserted, "signal_quiet_ms": trailing + inserted + leading}


def write_analysis(run, baseline, source_edits, piece_edits):
    before, after = audit(baseline), audit(run)
    report = {"before": before, "after": after, "source_edits": source_edits, "piece_edits": piece_edits,
        "extra_model_calls_for_audio_edits": 0}
    (run / "analysis.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    lines = ["# Technischer Vergleich des Hörsatzes", "", "Die Bearbeitung verwendet vorhandene Quellen ohne neue Synthese. "
        "Messwerte ersetzen keine Hörbewertung der Satzmelodie.", "", "## Auffällige Ausschnittränder", "",
        "| Stück | Ende vorher, dBFS RMS / 60 ms | Ende bearbeitet | Hinweis |", "| --- | --- | --- | --- |"]
    for name in ("team1", "team2", "walkover", "hall"):
        lines.append(f"| {name} | {before['pieces'][name]['end_60ms_dbfs']} | {after['pieces'][name]['end_60ms_dbfs']} | "
            + "; ".join(before["pieces"][name]["audition_flags"]) + " |")
    lines += ["", "Hohe Energie am Rand bedeutet aktive Sprache, nicht automatisch einen falschen Schnitt. "
        "Kurze Fades reduzieren einen harten Übergang; sie erzeugen keine neue Intonation und reparieren keine fehlende Silbe.", "",
        "## Vorhandene Stille und eingefügte Pause", "",
        "| Durchsage | Übergang vorher | Leiser Abstand vorher, ms | Übergang bearbeitet | Leiser Abstand bearbeitet, ms |",
        "| --- | --- | --- | --- | --- |"]
    for case_id in ("d04-team-1", "d05-team-1", "d09", "d11-tablet", "d12-sieger-1"):
        a = next(c for c in before["cases"] if c["id"] == case_id)
        b = next(c for c in after["cases"] if c["id"] == case_id)
        for index in range(max(len(a["joins"]), len(b["joins"]))):
            x = a["joins"][index] if index < len(a["joins"]) else None
            y = b["joins"][index] if index < len(b["joins"]) else None
            lines.append(f"| {case_id} | " + (f"{x['from']} → {x['to']} | {x['signal_quiet_ms']}" if x else "— | —")
                + " | " + (f"{y['from']} → {y['to']} | {y['signal_quiet_ms']}" if y else "— | —") + " |")
    lines += ["", "Die leisen Abstände sind Schätzungen mit 5-ms-Fenstern und −48 dBFS Schwelle. "
        "Atemgeräusche, leise Konsonanten und verschiedene Vokale lassen sich damit nicht zuverlässig klassifizieren.", "",
        "## D12 und das Signal vor Nina", "",
        "Der gebundene Quellbereich 5,245–5,400 s liegt zwischen dem vorherigen Wortende und dem bei etwa 5,43 s einsetzenden Nina. "
        "Sein niederpegeliges Signal wird in der Wiedergabekopie mit kurzen Übergängen unterdrückt. "
        "Die Quelldatei und die bevorzugte vollständige Referenz bleiben erhalten. D12 nutzt außerdem den Spielblock zusammenhängend.", "",
        "## Noch im Hörvergleich zu beurteilen", "", "- Fortsetzungs- und Abschlussbetonung der beiden Teamnamen.",
        "- Verbindung von Team und Hallenzusatz bei D05.", "- Verbindung von kampflos an und Siegername bei D12.",
        "- Wirkung der gesonderten Modellversuche mit Betonungs- beziehungsweise Pausenmarkern."]
    (run / "analysis.md").write_text("\n".join(lines) + "\n")
    return report
