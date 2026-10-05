#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

set -euo pipefail
cd "$(dirname "$0")/../.."
binary="${BAMBI_LLAMA_SERVER:-llama-server}"
model="${BAMBI_CLOUD_MODEL_FILE:-models/cloud/TheDrummer_Cydonia-24B-v4.3-Q5_K_M.gguf}"
keyfile="${BAMBI_CLOUD_KEY_FILE:-.runtime/cloud-api.key}"
if [[ ! -f "$model" ]]; then echo 'Download the pinned model with python3 scripts/cloud/download-model.py first.' >&2; exit 1; fi
if [[ ! -s "$keyfile" ]]; then echo 'Create a private API key file before starting the inference server. See docs/CLOUD_COMPUTE.md.' >&2; exit 1; fi
command -v "$binary" >/dev/null || { echo 'Install an RTX 5090-compatible CUDA llama-server build first.' >&2; exit 1; }
if [[ "$keyfile" == '.runtime/cloud-api.key' ]]; then
  python3 scripts/cloud/token-counter.py --ensure
fi
exec python3 scripts/cloud/server-config.py "$binary" "$model" "$keyfile"
