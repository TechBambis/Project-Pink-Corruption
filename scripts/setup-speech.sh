#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
mkdir -p .runtime/rpms .runtime/toolchain vendor models
if [[ ! -d vendor/whisper.cpp ]]; then git clone --depth 1 --branch v1.9.4 https://github.com/ggml-org/whisper.cpp.git vendor/whisper.cpp; fi
if [[ ! -x .runtime/buildtools/bin/cmake ]]; then python3 -m venv .runtime/buildtools; .runtime/buildtools/bin/pip install cmake==4.4.3 ninja==1.13.2; fi
if [[ ! -f models/ggml-base.bin ]]; then curl -fL --retry 3 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o models/ggml-base.bin; fi
printf '%s  %s\n' '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' 'models/ggml-base.bin' | sha256sum -c -
.runtime/buildtools/bin/cmake -S vendor/whisper.cpp -B .runtime/whisper-cpu -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=OFF -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF
.runtime/buildtools/bin/cmake --build .runtime/whisper-cpu -j 6
if [[ "${1:-}" == '--vulkan' ]]; then
 dnf5 --repo=fedora --repo=updates download --destdir=.runtime/rpms glslc.x86_64 vulkan-headers.noarch vulkan-loader-devel.x86_64 spirv-headers-devel.noarch
 python3 scripts/extract-vulkan-deps.py
 .runtime/buildtools/bin/cmake -S vendor/whisper.cpp -B .runtime/whisper-vulkan -DCMAKE_BUILD_TYPE=Release -DGGML_VULKAN=ON -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF -DCMAKE_PREFIX_PATH="$PWD/.runtime/toolchain/usr" -DVulkan_GLSLC_EXECUTABLE="$PWD/.runtime/toolchain/usr/bin/glslc"
 .runtime/buildtools/bin/cmake --build .runtime/whisper-vulkan -j 4
fi
./scripts/start.sh
