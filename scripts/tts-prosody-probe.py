#!/usr/bin/env python3
"""Two isolated expression probes using the installed Kitten assets, no service changes."""
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

BTS = Path(__file__).resolve().parent.parent
SPEECH = BTS.parent / "bts-sprachserver"
sys.path.insert(0, str(SPEECH))

import numpy as np
import soundfile as sf
from bts_sprachserver.config import Settings
from bts_sprachserver.kitten import file_digest
from bts_sprachserver.listening_lab import LabEngine, digest, render_clip
from bts_sprachserver.voices import load_voices


def main():
    settings = Settings.from_env(backend="kitten_cpp")
    base = SPEECH / "data/listening-lab"
    root = base / "match-suite/prosody"
    root.mkdir(parents=True, exist_ok=True)
    engine = LabEngine(settings.model_copy(update={"data_dir": root / "work"}), base)
    original = (SPEECH / "native/kitten_worker.cpp").read_text()
    needle = "const auto ids=kitten::prompt(tm,tokenize(vocab,chunk),ref_text,ref_audio,{},true);"
    assert original.count(needle) == 1, "Pinned worker prompt changed; inspect before enabling expressions"
    replacement = """std::vector<int> expression;
                if (kitten::has_expression(chunk)) {
                    expression=tokenize(vocab,config.at("generation").at("emotion_control").get<std::string>());
                }
                const auto ids=kitten::prompt(tm,tokenize(vocab,chunk),ref_text,ref_audio,expression,true);"""
    patched = original.replace(needle, replacement)
    native = root / ("native-" + digest(patched)[:12])
    native.mkdir(exist_ok=True)
    (native / "kitten_worker.cpp").write_text(patched)
    shutil.copyfile(SPEECH / "native/CMakeLists.txt", native / "CMakeLists.txt")
    build = root / ("worker-" + digest([patched, engine.identity])[:12])
    worker = build / "bts-kitten-worker"
    if not worker.exists():
        python = SPEECH / "data/kitten/build-env/bin/python"
        installation = engine.runtime["paths"]["config"].parent.parent
        prefix = subprocess.check_output([str(python), "-c", "import torch; print(torch.utils.cmake_prefix_path)"], text=True).strip()
        build.mkdir(exist_ok=True)
        with (build / "build.log").open("w") as log:
            for command in ([str(python), "-m", "cmake", "-S", str(native), "-B", str(build),
                "-DCMAKE_BUILD_TYPE=Release", "-DBTS_KITTEN_LAB=ON",
                "-DKITTEN_SOURCE=" + str(installation / "source"), "-DKITTEN_LIB=" + str(installation / "lib"),
                "-DCMAKE_PREFIX_PATH=" + prefix], [str(python), "-m", "cmake", "--build", str(build), "-j", "2"]):
                subprocess.run(command, check=True, stdout=log, stderr=log)
    engine.runtime["paths"]["worker"] = worker
    identity = digest([engine.identity, file_digest(worker), patched])
    output = root / identity[:12]
    output.mkdir(exist_ok=True)
    plan = json.loads(subprocess.check_output(["node", str(BTS / "scripts/tts-match-listening-plan.js")]))
    source = {item["id"]: item for item in plan["sources"]}
    probes = [
        {"id": "field_emphasis", "display": source["field"]["display"],
         "text": source["field"]["text"].replace("Spielfeld acht", "Spielfeld (((acht)))"),
         "purpose": "Hervorhebung der Feldnummer im vollständigen Referenzaufruf"},
        {"id": "walkover_pause", "display": source["walkover"]["display"],
         "text": source["walkover"]["text"].replace("geht kampflos an: Max", "geht kampflos an: <pause> Max"),
         "purpose": "Aussprechbares Ende der gemeinsamen Kampflos-Klausel vor dem Beispiel-Sieger"},
    ]
    report = {"engine": identity, "worker_sha256": file_digest(worker), "expression_conditioning": "{emo: 1}",
        "parameters": plan["parameters"], "sampling": settings.kitten_sampling.model_dump(),
        "new_generations": 0, "sources": {}}
    loaded = False
    try:
        for item in probes:
            key = digest([identity, item["text"], plan["parameters"], report["sampling"]])
            raw = output / (item["id"] + "-raw.wav")
            meta = output / (item["id"] + "-cache.json")
            started = time.perf_counter()
            hit = raw.is_file() and meta.is_file() and json.loads(meta.read_text())["key"] == key
            print(item["id"], "Cache" if hit else "Generierung", item["text"], flush=True)
            if not hit:
                if raw.exists():
                    raise RuntimeError("Probe cache identity changed; keep the old audio and use a new output directory")
                if not loaded:
                    engine.load(load_voices(settings))
                    loaded = True
                samples, rate = engine.generate(item["text"], "hallensprecher", "de-DE", 42)
                sf.write(raw, samples, rate, subtype="PCM_16")
                meta.write_text(json.dumps({"key": key, "sha256": file_digest(raw)}))
                report["new_generations"] += 1
            elif file_digest(raw) != json.loads(meta.read_text())["sha256"]:
                raise RuntimeError("Probe audio changed")
            target = output / (item["id"] + ".wav")
            if not target.exists():
                samples = render_clip(raw.read_bytes(), BTS, internal=False, speed=1.155)
                sf.write(target, np.concatenate([np.zeros(720), samples, np.zeros(720)]), 24000, subtype="PCM_16")
            report["sources"][item["id"]] = {**item, "file": str(target), "sha256": file_digest(target),
                "seconds": round(time.perf_counter() - started, 3), "cache_hit": hit}
            (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            print("Fertig:", target, flush=True)
    finally:
        engine.close()
    print("Prosodie-Bericht:", output / "report.json", flush=True)


if __name__ == "__main__":
    main()
