#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

# Build the pinned CUDA server on a CPU workspace without requiring a visible GPU.
set -euo pipefail
if [[ "${1:-}" == '--help' ]]; then
  echo 'Usage: bash scripts/cloud/build-llama.sh'
  echo 'Requires git, cmake, a C++ compiler, CUDA nvcc >= 12.8 and development libraries.'
  echo 'Builds the pinned upstream server for Blackwell (SM 120); downloads no model.'
  exit 0
fi
cd "$(dirname "$0")/../.."
root="$PWD"
revision='11fe02151f79c41d0d4af7da708755d73b9c0da6'
source_dir="$root/.runtime/cloud-llama"
for binary in git cmake c++ nvcc python3; do
  if ! command -v "$binary" >/dev/null; then
    echo "Missing $binary. Model preparation can still run with download-model.py; see docs/HYPERAI_PREP.md for build dependencies." >&2
    exit 1
  fi
done
cuda_version="$(nvcc --version)"
printf '%s\n' "$cuda_version"
python3 - "$cuda_version" <<'PY'
import re, sys
match=re.search(r'release (\d+)\.(\d+)',sys.argv[1])
if not match or tuple(map(int,match.groups()))<(12,8):
    raise SystemExit('CUDA nvcc >= 12.8 is required for the Blackwell build; finish model preparation before changing the toolkit.')
PY
if [[ ! -d "$source_dir" ]]; then
  mkdir -p "$root/.runtime"
  git clone --filter=blob:none --no-checkout https://github.com/ggml-org/llama.cpp.git "$source_dir"
  git -C "$source_dir" fetch --depth 1 origin "$revision"
  git -C "$source_dir" checkout --detach "$revision"
else
  if [[ ! -d "$source_dir/.git" ]] || [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]]; then
    echo 'Existing cloud-llama directory does not match the pinned checkout. Inspect it before rebuilding.' >&2
    exit 1
  fi
  if [[ -n "$(git -C "$source_dir" status --porcelain --untracked-files=no)" ]]; then
    echo 'The pinned checkout has local edits. Inspect them before rebuilding.' >&2
    exit 1
  fi
fi
cmake -S "$source_dir" -B "$source_dir/build" \
  -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=120 -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON
cmake --build "$source_dir/build" --target llama-server --parallel "${BAMBI_CLOUD_BUILD_JOBS:-2}"
echo 'Pinned CUDA server built. Set BAMBI_LLAMA_SERVER to .runtime/cloud-llama/build/bin/llama-server when serving.'
