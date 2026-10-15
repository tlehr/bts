#!/usr/bin/env bash
set -euo pipefail
bts_lab_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bts_lab_speech_root="${BTS_SPEECH_PROJECT:-$bts_lab_root/../bts-sprachserver}"
cd -- "$bts_lab_speech_root"
exec .venv/bin/python -m bts_sprachserver.listening_lab --bts-root "$bts_lab_root" "$@"
