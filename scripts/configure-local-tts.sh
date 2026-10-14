#!/usr/bin/env bash
set -euo pipefail
task_bts_root="$(cd "$(dirname "$0")/.." && pwd)"
task_speech_root="$(cd "${1:-$task_bts_root/../bts-sprachserver}" && pwd)"
umask 077
# Use the speech server's own dotenv dependency; never execute .env as shell code.
exec "$task_speech_root/.venv/bin/python" - "$task_bts_root" "$task_speech_root" <<'PY'
import json
import os
import tempfile
from pathlib import Path

from dotenv import dotenv_values

bts_root, speech_root = map(Path, __import__("sys").argv[1:3])
os.umask(0o077)
values = {**dotenv_values(speech_root / ".env"), **os.environ}
key = values.get("BTS_API_KEY", "")
if len(key) < 32 or not key.isascii():
    raise SystemExit("Der Sprachserver benötigt zuerst einen gültigen API-Key in seiner .env.")
host = values.get("BTS_HOST", "127.0.0.1")
if host in ("0.0.0.0", "::"):
    host = "127.0.0.1"
if ":" in host:
    host = "[" + host + "]"
port = int(values.get("BTS_PORT", "8077"))
if not 1 <= port <= 65535:
    raise SystemExit("Ungültiger Sprachserver-Port.")
config_path = bts_root / "config.json"
raw = config_path.read_bytes() if config_path.exists() else (bts_root / "config.json.default").read_bytes()
config = json.loads(raw)
data = bts_root / "data"
data.mkdir(exist_ok=True)


def private_write(path, content):
    with tempfile.NamedTemporaryFile(dir=data, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)
    path.chmod(0o600)


backup = data / "speech-config-backup.json"
if not backup.exists():
    private_write(backup, raw)
key_path = data / "speech-api-key"
if key_path.exists() and key_path.read_text("utf-8").strip() != key:
    key_backup = data / "speech-api-key.backup"
    if not key_backup.exists():
        private_write(key_backup, key_path.read_bytes())
private_write(key_path, (key + "\n").encode("ascii"))
speech = config.get("speech", {})
speech.update({
    "enabled": True, "url": "http://" + host + ":" + str(port),
    "api_key_file": "data/speech-api-key", "mode": "auto",
    "voice": speech.get("voice", "hallensprecherin"),
    "prefetch_matches": speech.get("prefetch_matches", 12),
    "prefetch_interval_ms": speech.get("prefetch_interval_ms", 30000),
    "deadline_ms": speech.get("deadline_ms", 700),
})
speech.pop("api_key", None)
config["speech"] = speech
private_write(config_path, (json.dumps(config, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
print("Lokale TTS-Verbindung eingerichtet. Sprachserver und BTS starten/neustarten.")
print("Im Browser unter 'Ansagen auf diesem Gerät' die Audiowiedergabe aktivieren.")
PY
