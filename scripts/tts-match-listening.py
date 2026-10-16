#!/usr/bin/env python3
"""Generate an isolated, fixed match listening suite with context-derived cuts."""
import argparse
import copy
import json
import shutil
import subprocess
import sys
import time
import uuid
import zipfile
from pathlib import Path

BTS = Path(__file__).resolve().parent.parent
SPEECH = BTS.parent / "bts-sprachserver"
sys.path.insert(0, str(SPEECH))

import numpy as np
import soundfile as sf
from bts_sprachserver.config import Settings, KittenSampling
from bts_sprachserver.kitten import file_digest
from bts_sprachserver.listening_lab import LabEngine, digest, render_clip, trim_edges
from bts_sprachserver.voices import load_voices
from tts_match_audio import adaptive_pause, audit, clean_source, optimize_spec, prepare_piece, write_analysis


def specification():
    return json.loads(subprocess.check_output(["node", str(BTS / "scripts/tts-match-listening-plan.js")]))


def write_wav(path, samples):
    with sf.SoundFile(path, mode="x", samplerate=24000, channels=1, format="WAV", subtype="PCM_16") as wav:
        wav.write(samples)


def generate(spec):
    settings = Settings.from_env(backend="kitten_cpp")
    base = SPEECH / "data/listening-lab"
    work = base / "match-suite"
    work.mkdir(parents=True, exist_ok=True)
    engine = LabEngine(settings.model_copy(update={"data_dir": work / "work"}), base)
    parameters = spec["parameters"]
    sampling = KittenSampling.model_validate({**settings.kitten_sampling.model_dump(),
        **{key: parameters[key] for key in ("temperature", "top_k", "top_p")}})
    engine.experiment_sampling = sampling
    identity = digest([engine.identity, parameters, sampling.model_dump()])[:12]
    directory = work / ("sources-" + identity)
    directory.mkdir(exist_ok=True)
    raw_dir = work / "clips"
    raw_dir.mkdir(exist_ok=True)
    report = {"parameters": parameters, "sampling": sampling.model_dump(), "engine": engine.identity,
              "sources": {}, "new_sources": 0, "load_seconds": 0}
    loaded = False
    try:
        for index, source in enumerate(spec["sources"], 1):
            key = digest([engine.identity, source["text"], parameters["voice"], sampling.model_dump(), parameters["seed"]])
            raw = base / "clips" / (key + ".wav")
            reused = raw.is_file()
            if not reused:
                raw = raw_dir / (key + ".wav")
            cached = raw.is_file()
            started = time.perf_counter()
            print(f"{index}/{len(spec['sources'])} {source['id']}: {'Cache' if cached else 'Generierung'} · {source['text']}", flush=True)
            if not cached:
                if not loaded:
                    engine.load(load_voices(settings))
                    loaded = True
                    report["load_seconds"] = round(time.perf_counter() - started, 3)
                    started = time.perf_counter()
                samples, rate = engine.generate(source["text"], parameters["voice"], "de-DE", parameters["seed"])
                if rate != 24000 or not len(samples) or not np.isfinite(samples).all():
                    raise ValueError("Invalid generated audio")
                write_wav(raw, samples)
                report["new_sources"] += 1
            rendered = directory / (source["id"] + "-" + key[:12] + ".wav")
            if not rendered.exists():
                samples = render_clip(raw.read_bytes(), BTS, internal=False, speed=parameters["speed"])
                write_wav(rendered, np.concatenate([np.zeros(720), samples, np.zeros(720)]))
            info = sf.info(rendered)
            report["sources"][source["id"]] = {**source, "file": str(rendered), "raw_file": str(raw),
                "raw_sha256": file_digest(raw), "sha256": file_digest(rendered), "sample_rate": info.samplerate,
                "frames": info.frames, "duration": info.duration, "cache_hit": cached,
                "existing_lab_cache": reused, "generation_seconds": round(time.perf_counter() - started, 3)}
            (directory / "sources.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            print(f"  Fertig · {info.duration:.2f} s Audio · {report['sources'][source['id']]['generation_seconds']:.1f} s Aufwand", flush=True)
        report["worker_pid"] = getattr(engine._process, "pid", None)
        (directory / "sources.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    finally:
        engine.close()
    print(f"Quellen fertig: {directory / 'sources.json'}", flush=True)
    return directory / "sources.json"


def assemble(spec, source_report, cuts_path, optimization_path=None, baseline=None, probe_report=None, probe_cuts_path=None):
    report = json.loads(source_report.read_text())
    cuts = json.loads(cuts_path.read_text())
    if cuts.get("sample_rate") != 24000:
        raise ValueError("Cuts require the checked 24 kHz sources")
    if report["parameters"] != spec["parameters"]:
        raise ValueError("Source parameters differ from the listening plan")
    for source in spec["sources"]:
        info = report["sources"][source["id"]]
        if info["text"] != source["text"] or file_digest(Path(info["file"])) != info["sha256"]:
            raise ValueError("Source text or audio changed: " + source["id"])
    for name, piece in spec["pieces"].items():
        if not piece["whole"]:
            cut = cuts["pieces"][name]
            info = report["sources"][piece["source"]]
            if cut["source_sha256"] != info["sha256"] or cut["source"] != piece["source"]:
                raise ValueError("Cuts belong to a different recording: " + name)
            start, end = cut["start_frame"], cut["end_frame"]
            if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= info["frames"]:
                raise ValueError("Invalid excerpt: " + name)
    profile = json.loads(optimization_path.read_text()) if optimization_path else None
    if profile and baseline is None:
        raise ValueError("Optimized comparison requires an existing baseline suite")
    if profile:
        spec = optimize_spec(spec)
    run = source_report.parent.parent / uuid.uuid4().hex[:12]
    for name in ("pieces", "sources"):
        (run / name).mkdir(parents=True, exist_ok=True)
    result = {"id": run.name, "title": spec["title"], "fixture": spec["fixture"], "note": spec["note"],
        "parameters": report["parameters"], "sampling": report["sampling"], "engine": report["engine"],
        "new_sources": 0, "source_batch_new_generations": report["new_sources"], "load_seconds": 0,
        "sources": {}, "pieces": {}, "cases": [], "alignment": cuts["method"],
        "plan_sha256": file_digest(BTS / "scripts/tts-match-listening-plan.js"),
        "cuts_sha256": file_digest(cuts_path)}
    source_edits, piece_edits = {}, {}
    if profile:
        result["optimization"] = {"profile_sha256": file_digest(optimization_path), "baseline_id": baseline.name,
            "new_generations_for_edits": 0,
            "summary": "Geprüfte leise Störstelle bereinigt, Randpausen berücksichtigt, kurze Fades an aktiven Schnitten. "
                       "D12 verwendet den Spielblock am Stück. Die Satzmelodie bleibt eine Hörentscheidung."}
    arrays = {}
    for name, info in report["sources"].items():
        path = run / "sources" / (name + ".wav")
        shutil.copyfile(info["file"], path)
        result["sources"][name] = {**info, "file": str(path.relative_to(run))}
        arrays[name], rate = sf.read(path, dtype="float32")
        if rate != 24000 or arrays[name].ndim != 1:
            raise ValueError("Invalid rendered source")
        if profile:
            arrays[name], source_edits[name] = clean_source(name, arrays[name], info["sha256"], profile)
        words = source_report.parent / (name + "-words.json")
        if words.is_file():
            shutil.copyfile(words, run / "sources" / words.name)
    clips = {}
    for name, piece in spec["pieces"].items():
        info = report["sources"][piece["source"]]
        full = arrays[piece["source"]]
        if piece["whole"]:
            start, end = 0, len(full)
        else:
            cut = cuts["pieces"][name]
            start, end = cut["start_frame"], cut["end_frame"]
            if cut["source_sha256"] != info["sha256"] or cut["source"] != piece["source"]:
                raise ValueError("Cuts belong to a different recording: " + name)
        if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= len(full):
            raise ValueError("Invalid excerpt: " + name)
        # No time stretching or inner silence compaction after extraction.
        clips[name] = trim_edges(full[start:end])
        if not len(clips[name]) or np.max(np.abs(clips[name])) <= 4 / 32768:
            raise ValueError("Silent excerpt: " + name)
        if profile:
            clips[name], piece_edits[name] = prepare_piece(name, clips[name], profile)
        path = run / "pieces" / (name + ".wav")
        write_wav(path, clips[name])
        result["pieces"][name] = {**piece, "file": str(path.relative_to(run)),
            "start_frame": start, "end_frame": end, "source_sha256": info["sha256"],
            "sha256": file_digest(path), "duration": round(len(clips[name]) / 24000, 3)}
    for case in sorted(spec["cases"], key=lambda item: item["id"]):
        sequence = [np.zeros(720, dtype=np.float32)]
        joins = []
        for index, part in enumerate(case["parts"]):
            if profile and index + 1 < len(case["parts"]):
                target = part["pause_ms"]
                pause, detail = adaptive_pause(clips[part["piece"]], clips[case["parts"][index + 1]["piece"]], target)
                part["pause_ms"] = pause
                part["target_pause_ms"] = target
                joins.append(detail)
            sequence.append(clips[part["piece"]])
            sequence.append(np.zeros(round(24 * part["pause_ms"]), dtype=np.float32))
        sequence.append(np.zeros(720, dtype=np.float32))
        samples = np.concatenate(sequence)
        path = run / (case["id"] + ".wav")
        write_wav(path, samples)
        result["cases"].append({**case, "file": path.name, "sha256": file_digest(path),
            "frames": len(samples), "duration": round(len(samples) / 24000, 3), "joins": joins})
    if profile:
        originals = {case["id"]: case for case in json.loads((baseline / "report.json").read_text())["cases"]}
        (run / "original").mkdir()
        references = {"d01-ohne-offizielle": "field", "d03": "begin", "d05-team-1": "prep_team",
            "d06": "umpire", "d07": "judge", "d08-tablet": "tablet", "d08-klapptafel": "board",
            "d11-tablet": "prep_operator", "d11-tablet-ohne-treffpunkt": "prep_operator_no_meeting",
            "d12-sieger-1": "walkover"}
        for case in result["cases"]:
            original = originals[case["id"]]
            target = run / "original" / (case["id"] + ".wav")
            shutil.copyfile(baseline / original["file"], target)
            case["original"] = {"file": str(target.relative_to(run)), "duration": original["duration"],
                "sha256": original["sha256"]}
            if case["id"] in references:
                case["full_reference"] = {"file": result["sources"][references[case["id"]]]["file"],
                    "note": "Vorhandene ungekürzte Kontextquelle; bei D12 hat die Einleitung Kommata."}
    if probe_report:
        probes = json.loads(probe_report.read_text())
        probe_cuts = json.loads(probe_cuts_path.read_text()) if probe_cuts_path else {"pieces": {}, "notes": {}}
        if probe_cuts_path and probe_cuts.get("sample_rate") != 24000:
            raise ValueError("Unexpected probe cuts sample rate")
        (run / "probes").mkdir()
        result["probes"] = {"new_generations": probes["new_generations"], "items": [], "pieces": {}}
        probe_arrays = {}
        for name, item in probes["sources"].items():
            target = run / "probes" / (name + ".wav")
            if file_digest(Path(item["file"])) != item["sha256"]:
                raise ValueError("Expression probe changed")
            shutil.copyfile(item["file"], target)
            result["probes"]["items"].append({**item, "file": str(target.relative_to(run)), "note": probe_cuts["notes"].get(name, "")})
            probe_arrays[name], rate = sf.read(target, dtype="float32")
            if rate != 24000:
                raise ValueError("Unexpected probe rate")
        replacements = {}
        for name, cut in probe_cuts["pieces"].items():
            source = probes["sources"][cut["source"]]
            if cut["source_sha256"] != source["sha256"]:
                raise ValueError("Probe cut belongs to another source")
            a, b = cut["start_frame"], cut["end_frame"]
            if not 0 <= a < b <= len(probe_arrays[cut["source"]]):
                raise ValueError("Invalid probe excerpt")
            samples = trim_edges(probe_arrays[cut["source"]][a:b])
            if profile:
                samples, edit = prepare_piece(name, samples, profile)
            else:
                edit = {}
            replacements[name] = samples
            target = run / "probes" / (name + ".wav")
            write_wav(target, samples)
            result["probes"]["pieces"][name] = {**cut, "file": str(target.relative_to(run)),
                "sha256": file_digest(target), "edits": edit}
        for case in result["cases"]:
            if case["id"].startswith("d12-") and "walkover" in replacements:
                selected = {"walkover"}
                label = "Vergleich: sauber ausgeschnittene gemeinsame Kampflos-Klausel aus dem Modellversuch"
                suffix = "modell-klausel"
            else:
                selected = {"field_start", "field_end"} & {p["piece"] for p in case["parts"]} & set(replacements)
                label = "Vergleich: Feldnummer mit Modell-Hervorhebung, übrige Bausteine gleich"
                suffix = "feld-betont"
            if not selected:
                continue
            parts = copy.deepcopy(case["parts"])
            alternate = {**clips, **{name: replacements[name] for name in selected}}
            sequence = [np.zeros(720, dtype=np.float32)]
            for index, part in enumerate(parts):
                if profile and index + 1 < len(parts):
                    pause, _ = adaptive_pause(alternate[part["piece"]], alternate[parts[index + 1]["piece"]],
                        part.get("target_pause_ms", part["pause_ms"]))
                    part["pause_ms"] = pause
                sequence += [alternate[part["piece"]], np.zeros(round(24 * part["pause_ms"]), dtype=np.float32)]
            sequence.append(np.zeros(720, dtype=np.float32))
            target = run / "probes" / (case["id"] + "-" + suffix + ".wav")
            samples = np.concatenate(sequence)
            write_wav(target, samples)
            case["variants"] = [{"label": label, "file": str(target.relative_to(run)),
                "sha256": file_digest(target), "duration": round(len(samples) / 24000, 3), "parts": parts,
                "replacements": {name: result["probes"]["pieces"][name]["file"] for name in selected}}]
    result["reference"] = {"file": result["sources"]["field"]["file"],
        "sha256": result["sources"]["field"]["sha256"], "text": result["sources"]["field"]["display"]}
    (run / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    if profile:
        result["analysis"] = write_analysis(run, baseline, source_edits, piece_edits)
        (run / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    template = (BTS / "scripts/tts-match-listening.html").read_text()
    (run / "index.html").write_text(template.replace("__REPORT__", json.dumps(result, ensure_ascii=False).replace("<", "\\u003c")))
    with zipfile.ZipFile(run / "hoersatz-spiel-189.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(run.rglob("*")):
            if path.is_file() and path.suffix != ".zip":
                archive.write(path, path.relative_to(run))
    print(f"Fertig: {len(result['cases'])} Durchsagen, {len(clips)} bereitgestellte Stücke, {len(result['sources'])} vollständige Quellen.", flush=True)
    print(f"Hörseite: {run / 'index.html'}", flush=True)
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate-sources", action="store_true")
    parser.add_argument("--assemble", type=Path, metavar="SOURCES_JSON")
    parser.add_argument("--cuts", type=Path, default=BTS / "scripts/tts-match-listening-cuts.json")
    parser.add_argument("--optimization", type=Path)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--probe-report", type=Path)
    parser.add_argument("--probe-cuts", type=Path, default=BTS / "scripts/tts-prosody-probe-cuts.json")
    parser.add_argument("--analyze", type=Path, metavar="SUITE_DIRECTORY")
    args = parser.parse_args()
    if args.analyze:
        print(json.dumps(audit(args.analyze), ensure_ascii=False, indent=2))
    elif args.generate_sources:
        generate(specification())
    elif args.assemble:
        assemble(specification(), args.assemble, args.cuts, args.optimization, args.baseline, args.probe_report, args.probe_cuts)
    else:
        parser.error("Select --generate-sources or --assemble SOURCES_JSON")


if __name__ == "__main__":
    main()
