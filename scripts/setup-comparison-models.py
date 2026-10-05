# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Install only the two explicitly selected 9B comparison GGUFs, by immutable pin."""
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
models = json.loads((ROOT / 'docs/comparison-models.json').read_text())
destination = ROOT / 'models/community'
destination.mkdir(parents=True, exist_ok=True)

def verified(path, model):
    if not path.exists() or path.stat().st_size != model['bytes']:
        return False
    print('Checking SHA256: ' + model['alias'], flush=True)
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == model['sha256']

with (destination / 'comparison-download.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    ready = {m['alias']: verified(destination / m['file'], m) for m in models}
    needed = sum(max(0, m['bytes'] - (destination / (m['file'] + '.part')).stat().st_size) if (destination / (m['file'] + '.part')).exists() else m['bytes'] for m in models if not ready[m['alias']])
    if needed and shutil.disk_usage(destination).free < needed + 2 * 1024**3:
        raise RuntimeError('Both selected models plus 2 GiB OS reserve do not fit')
    for model in models:
        path = destination / model['file']
        partial = path.with_suffix('.gguf.part')
        if not ready[model['alias']]:
            print(f"Downloading {model['alias']} ({model['bytes'] / 1e9:.2f} GB)", flush=True)
            url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{model['file']}"
            subprocess.run(['curl', '-fL', '--no-progress-meter', '--retry', '3', '--continue-at', '-', '-o', str(partial), url], check=True)
            if not verified(partial, model):
                raise RuntimeError('Size/SHA256 failed; partial file retained')
            partial.replace(path)
        marker = ROOT / 'runtime' / (model['alias'].split(':')[0] + '-installed.json')
        marker.parent.mkdir(exist_ok=True)
        marker.write_text(json.dumps(model, indent=2) + '\n')
        print('Verified: ' + model['alias'], flush=True)
