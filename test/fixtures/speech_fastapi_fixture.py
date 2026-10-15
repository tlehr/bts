"""Opt-in integration fixture using the real speech API and a small CPU mock engine."""
import json
import socket
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn

from bts_sprachserver.config import Settings
from bts_sprachserver.main import create_app

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
(root / "voices").mkdir(exist_ok=True)
(root / "config").mkdir(exist_ok=True)
profiles = {}
for voice in ("hallensprecherin", "hallensprecher"):
    sf.write(root / "voices" / (voice + ".wav"), np.zeros(240), 24000)
    profiles[voice] = {
        "file": "voices/" + voice + ".wav", "reference_text": "Eine Testreferenz.",
        "version": "test-1", "languages": ["de-DE"],
    }
(root / "config/voices.json").write_text(json.dumps({"voices": profiles}), "utf-8")


class Engine:
    def load(self, voices):
        self.voices = voices

    def generate(self, text, voice, language, seed):
        with (root / "received.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"text": text, "voice": voice, "language": language}, ensure_ascii=False) + "\n")
        if text == "BTS_TEST_GENERATION_FAILURE":
            raise RuntimeError("Injected test generation failure")
        return np.zeros(12000, dtype=np.float32), 24000


sock = socket.socket()
sock.bind(("127.0.0.1", 0))
sock.listen(64)
print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
settings = Settings(root=root, api_key="test-only-key-" + "x" * 32, requests_per_minute=1000)
server = uvicorn.Server(uvicorn.Config(create_app(settings, Engine()), access_log=False, log_level="warning"))
server.run(sockets=[sock])
