# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Resumable, pinned GGUF download for the explicitly requested 35B comparison."""
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
model = json.loads((ROOT / 'docs/qwen36-model.json').read_text())
destination = ROOT / 'models/community'
destination.mkdir(parents=True, exist_ok=True)

def verified(path):
    if not path.exists() or path.stat().st_size != model['bytes']:
        return False
    print('Checking SHA256 …', flush=True)
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == model['sha256']

with (destination / 'qwen36-download.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    path = destination / model['file']
    partial = path.with_suffix('.gguf.part')
    if not verified(path):
        remaining = model['bytes'] - (partial.stat().st_size if partial.exists() else 0)
        if shutil.disk_usage(destination).free < remaining + 2 * 1024**3:
            raise RuntimeError('Not enough free space including a 2 GiB OS reserve')
        url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{model['file']}"
        print(f"Downloading {model['bytes'] / 1e9:.2f} GB, immutable revision {model['revision']}", flush=True)
        subprocess.run(['curl', '-fL', '--no-progress-meter', '--retry', '3', '--continue-at', '-', '-o', str(partial), url], check=True)
        if not verified(partial):
            raise RuntimeError('Size/SHA256 verification failed; incomplete file retained for diagnosis')
        partial.replace(path)
    report = ROOT / 'runtime/qwen36-installed.json'
    report.write_text(json.dumps(model, indent=2) + '\n')
    print(f"Verified {path.name}; no duplicate Ollama import", flush=True)
