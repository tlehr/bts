#!/usr/bin/env python3
"""Generate an isolated, fixed match listening suite with context-derived cuts."""
import argparse
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


def assemble(spec, source_report, cuts_path):
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
    run = source_report.parent.parent / uuid.uuid4().hex[:12]
    for name in ("pieces", "sources"):
        (run / name).mkdir(parents=True, exist_ok=True)
    result = {"id": run.name, "title": spec["title"], "fixture": spec["fixture"], "note": spec["note"],
        "parameters": report["parameters"], "sampling": report["sampling"], "engine": report["engine"],
        "new_sources": report["new_sources"], "load_seconds": report["load_seconds"],
        "sources": {}, "pieces": {}, "cases": [], "alignment": cuts["method"],
        "plan_sha256": file_digest(BTS / "scripts/tts-match-listening-plan.js"),
        "cuts_sha256": file_digest(cuts_path)}
    arrays = {}
    for name, info in report["sources"].items():
        path = run / "sources" / (name + ".wav")
        shutil.copyfile(info["file"], path)
        result["sources"][name] = {**info, "file": str(path.relative_to(run))}
        arrays[name], rate = sf.read(path, dtype="float32")
        if rate != 24000 or arrays[name].ndim != 1:
            raise ValueError("Invalid rendered source")
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
        path = run / "pieces" / (name + ".wav")
        write_wav(path, clips[name])
        result["pieces"][name] = {**piece, "file": str(path.relative_to(run)),
            "start_frame": start, "end_frame": end, "source_sha256": info["sha256"],
            "sha256": file_digest(path), "duration": round(len(clips[name]) / 24000, 3)}
    for case in sorted(spec["cases"], key=lambda item: item["id"]):
        sequence = [np.zeros(720, dtype=np.float32)]
        for part in case["parts"]:
            sequence.append(clips[part["piece"]])
            sequence.append(np.zeros(round(24 * part["pause_ms"]), dtype=np.float32))
        sequence.append(np.zeros(720, dtype=np.float32))
        samples = np.concatenate(sequence)
        path = run / (case["id"] + ".wav")
        write_wav(path, samples)
        result["cases"].append({**case, "file": path.name, "sha256": file_digest(path),
            "frames": len(samples), "duration": round(len(samples) / 24000, 3)})
    result["reference"] = {"file": result["sources"]["field"]["file"],
        "sha256": result["sources"]["field"]["sha256"], "text": result["sources"]["field"]["display"]}
    (run / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    template = (BTS / "scripts/tts-match-listening.html").read_text()
    (run / "index.html").write_text(template.replace("__REPORT__", json.dumps(result, ensure_ascii=False).replace("<", "\\u003c")))
    with zipfile.ZipFile(run / "hoersatz-spiel-189.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(run.rglob("*")):
            if path.is_file() and path.suffix != ".zip":
                archive.write(path, path.relative_to(run))
    print(f"Fertig: {len(result['cases'])} Durchsagen, {len(clips)} wiederverwendete Stücke, {len(result['sources'])} vollständige Quellen.", flush=True)
    print(f"Hörseite: {run / 'index.html'}", flush=True)
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate-sources", action="store_true")
    parser.add_argument("--assemble", type=Path, metavar="SOURCES_JSON")
    parser.add_argument("--cuts", type=Path, default=BTS / "scripts/tts-match-listening-cuts.json")
    args = parser.parse_args()
    if args.generate_sources:
        generate(specification())
    elif args.assemble:
        assemble(specification(), args.assemble, args.cuts)
    else:
        parser.error("Select --generate-sources or --assemble SOURCES_JSON")


if __name__ == "__main__":
    main()
