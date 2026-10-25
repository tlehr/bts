"""Disposable real synthesis API for a controlled BTS load comparison."""
import json
import os
from pathlib import Path
import socket
import sys
import time
import tempfile

options = json.loads(sys.stdin.readline())
# Stop the disposable API if its controller is killed during startup. Native
# Kitten also loses its private stdin pipe when this parent exits.
if sys.platform == 'linux':
    import ctypes
    import signal
    parent_pid = os.getppid()
    if ctypes.CDLL(None).prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise RuntimeError('Could not set parent-death signal')
    if os.getppid() != parent_pid:
        sys.exit(1)
sys.path.insert(0, options["speech_repository"])
from bts_sprachserver.config import Settings
from bts_sprachserver.main import create_app
from bts_sprachserver.kitten import KittenEngine
from bts_sprachserver.voices import load_voices
from pydantic import SecretStr
import uvicorn


def event(kind, **values):
    print(json.dumps({"event": kind, "ts": time.time_ns() / 1e6, **values}), flush=True)


from bts_sprachserver.resources import apply_cpu_priority
apply_cpu_priority(options["nice"])
folder = Path(options["directory"]).resolve()
if (not folder.is_dir() or not folder.name.startswith("api-")
        or not folder.parent.name.startswith("bts-speech-load-")
        or folder.parent.parent != Path(tempfile.gettempdir()).resolve() or any(folder.iterdir())):
    raise RuntimeError("The speech probe requires its own disposable API directory")
settings = Settings.from_env(backend="kitten_cpp").model_copy(update={
    "api_key": SecretStr(options["key"]), "data_dir": folder, "offline": True,
    "torch_threads": options["threads"], "kitten_decoder_threads": options["threads"],
    "requests_per_minute": 10000, "retries": 0, "context_version": "bts-context-v2",
    "log_level": "WARNING",
})

if options.get("fake"):
    import numpy as np
    settings = settings.model_copy(update={"context_enabled": False, "context_version": "bts-context-v1", "backend": "qwen"})

    class Engine:
        def load(self, voices):
            pass

        def generate(self, text, voice, language, seed):
            event("inference_start")
            time.sleep(.03)
            event("inference_end")
            return np.sin(np.arange(12000) * .1).astype(np.float32) * .1, 24000

    engine = Engine()
    native_pid = None
else:
    class Engine(KittenEngine):
        def generate(self, *args, **kwargs):
            event("inference_start", warmup=getattr(self, "warming", False))
            started = time.monotonic()
            try:
                return super().generate(*args, **kwargs)
            finally:
                event("inference_end", warmup=getattr(self, "warming", False), elapsed_ms=(time.monotonic() - started) * 1000)

    engine = Engine(settings)
    engine.warming = True
    engine.load(load_voices(settings))
    # Equal model/inference warmup in every case, including the idle control.
    engine.generate("Dies ist eine Sprachprobe für das Badmintonturnier.", "hallensprecher", "de-DE", 42)
    engine.warming = False
    native_pid = engine._process.pid

from bts_sprachserver.cache import AudioCache
original_write = AudioCache.write


def timed_write(self, *args, **kwargs):
    started = time.monotonic()
    try:
        return original_write(self, *args, **kwargs)
    finally:
        event("audio_write", elapsed_ms=(time.monotonic() - started) * 1000)


AudioCache.write = timed_write
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
sock.listen(64)
event("ready", port=sock.getsockname()[1], pid=os.getpid(), native_pid=native_pid,
      nice=os.getpriority(os.PRIO_PROCESS, 0), threads=options["threads"], fake=options.get("fake", False))
uvicorn.Server(uvicorn.Config(create_app(settings, engine), access_log=False, log_level="warning")).run(sockets=[sock])
