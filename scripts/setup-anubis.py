# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Reuse the verified installed Ollama blob for the pinned native Anubis runner."""
import fcntl
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
pin = json.loads((ROOT / 'docs/anubis-model.json').read_text())
destination = ROOT / 'models/community'
destination.mkdir(parents=True, exist_ok=True)
target = destination / pin['file']
source = ROOT / 'models/ollama/blobs' / ('sha256-' + pin['sha256'])
with (destination / 'anubis-setup.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    candidate = target if target.exists() else source
    if not candidate.is_file() or candidate.stat().st_size != pin['bytes']:
        raise RuntimeError('Install the pinned Anubis Mini Q4_K_M with Ollama first; no weights were changed.')
    with candidate.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != pin['sha256']:
            raise RuntimeError('Anubis SHA256 verification failed; no weights were changed.')
    if not target.exists():
        os.link(source, target)
    print(json.dumps({'installed': True, 'reusedOllamaWeights': True, 'alias': pin['alias'], 'file': str(target)}))
