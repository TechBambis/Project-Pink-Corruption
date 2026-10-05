#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
mkdir -p .runtime runtime models data
if [[ ! -x .runtime/bin/ollama ]]; then
  curl -fL --retry 3 https://github.com/ollama/ollama/releases/download/v0.35.1/ollama-linux-amd64.tar.zst -o .runtime/ollama.tar.zst
  curl -fsSL https://github.com/ollama/ollama/releases/download/v0.35.1/sha256sum.txt -o .runtime/sha256sum.txt
  (cd .runtime && rg ' \.?/?ollama-linux-amd64.tar.zst$' sha256sum.txt | sed 's/ollama-linux-amd64.tar.zst/ollama.tar.zst/' | sha256sum -c -)
  tar --zstd -xf .runtime/ollama.tar.zst -C .runtime
fi
./scripts/setup-local-tts.sh
npm ci --ignore-scripts
./scripts/start.sh
.runtime/bin/ollama pull qwen3.5:4b
python3 -c "import json,urllib.request; d=json.load(urllib.request.urlopen('http://127.0.0.1:11434/api/tags')); assert next(m['digest'] for m in d['models'] if m['name']=='qwen3.5:4b')=='2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd', 'Upstream model tag changed; review VERSIONS.md before replacing the verified model.'"
