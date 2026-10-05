#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

BAMBI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$BAMBI_ROOT/.runtime/bin:$PATH"
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_MODELS="$BAMBI_ROOT/models/ollama"
export OLLAMA_VULKAN=1
export GGML_VK_VISIBLE_DEVICES=0
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_CONTEXT_LENGTH=4096
export OLLAMA_KEEP_ALIVE=10m
# Keep optional Vulkan overlay layers out of inference processes.
export DISABLE_LSFG=1
export DISABLE_LSFGVK=1
export VK_LOADER_LAYERS_DISABLE='~implicit~'

export OLLAMA_NO_CLOUD=1
