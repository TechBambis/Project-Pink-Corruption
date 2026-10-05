#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
uv venv --python .runtime/tts-venv/bin/python --allow-existing .runtime/joyhub-venv
uv pip sync --python .runtime/joyhub-venv/bin/python packages/devices/requirements.lock
echo 'Ready: .runtime/joyhub-venv/bin/python tools/joyhub_bridge.py --scan'
