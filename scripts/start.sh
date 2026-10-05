#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
if [[ ! -d node_modules ]]; then npm ci --ignore-scripts; fi
npm run build -- --emptyOutDir
exec python3 scripts/lifecycle.py start "$@"
