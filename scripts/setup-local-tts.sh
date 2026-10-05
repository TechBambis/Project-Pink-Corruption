#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
if ! command -v uv >/dev/null; then
  echo 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/' >&2
  exit 1
fi
# Setup is the only phase requiring downloads; normal start never invokes uv.
uv venv --python 3.12 --allow-existing .runtime/tts-venv
uv pip sync --python .runtime/tts-venv/bin/python packages/speech/local/requirements.lock
.runtime/tts-venv/bin/python scripts/setup-local-tts.py
.runtime/tts-venv/bin/python tools/voice_lab.py export-voice
echo 'Offline Kokoro ready. Start ./scripts/start.sh; open http://127.0.0.1:6969/voice-lab'
