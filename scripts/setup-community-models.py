# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Download the two user-requested GGUFs by immutable revision and verify SHA256.

Imports text-only models into the existing project-local Ollama. No model-provided
scripts execute, and no system installation or cloud inference is performed.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
os.environ['OLLAMA_HOST'] = '127.0.0.1:11434'
os.environ['OLLAMA_MODELS'] = str(ROOT / 'models/ollama')
MODELS = [
    {
        'repo': 'HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive',
        'revision': '0a41c68809d375475f954be12ba7c40efa56c2a9',
        'file': 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
        'sha256': '2ca636d9e81d3d23ca9b60c234fe185d30ec082eeba69ce770fdb0c76559a4f5',
        'bytes': 5627044224,
        'alias': 'bambi-qwen35-9b-hauhau:q4_k_m',
        'license': 'apache-2.0',
        'sampling': {'temperature': 0.7, 'top_p': 0.8, 'top_k': 20},
    },
    {
        'repo': 'HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive',
        'revision': '45b6a334b4bcd1d7f37179df58b3b1d66a184e5d',
        'file': 'Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
        'sha256': 'd0027dd3a9128d9323e9f282c8bf010a8526c46477584535991dc1a869b56e96',
        'bytes': 5335285728,
        'alias': 'bambi-gemma4-e4b-hauhau:q4_k_m',
        'license': 'gemma',
        'sampling': {'temperature': 1.0, 'top_p': 0.95, 'top_k': 64},
    },
]

def verified(path, model):
    if not path.exists() or path.stat().st_size != model['bytes']:
        return False
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == model['sha256']

destination = ROOT / 'models/community'
destination.mkdir(parents=True, exist_ok=True)
report = []
for model in MODELS:
    if len(sys.argv) > 1 and sys.argv[1] not in model['alias']:
        continue
    path = destination / model['file']
    if not verified(path, model):
        partial = path.with_suffix('.gguf.part')
        url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{model['file']}"
        print(f"Downloading {model['alias']} ({model['bytes'] / 1e9:.2f} GB)", flush=True)
        subprocess.run(['curl', '-fL', '--no-progress-meter', '--retry', '3', '--continue-at', '-', '-o', str(partial), url], check=True)
        if not verified(partial, model):
            raise RuntimeError(f"Size/SHA256 verification failed: {partial}")
        partial.replace(path)
    print(f"Verified {model['file']}: {model['sha256']}", flush=True)
    modelfile = destination / (model['alias'].split(':')[0] + '.Modelfile')
    modelfile.write_text(f'FROM {path}\nPARAMETER num_ctx 4096\n' + ''.join(
        f'PARAMETER {key} {value}\n' for key, value in model['sampling'].items()))
    subprocess.run([str(ROOT / '.runtime/bin/ollama'), 'create', model['alias'], '-f', str(modelfile)], check=True)
    # Ollama may copy the import. Keep the verified original path via a hard link
    # to its identical content-addressed blob, avoiding a second 5+ GB copy.
    blob = ROOT / 'models/ollama/blobs' / ('sha256-' + model['sha256'])
    if blob.exists() and path.stat().st_ino != blob.stat().st_ino and verified(blob, model):
        link = path.with_suffix('.gguf.link')
        link.unlink(missing_ok=True)
        os.link(blob, link)
        link.replace(path)
    record = {**model, 'text_only': True, 'context': 4096}
    reportpath = ROOT / 'runtime/community-models-installed.json'
    reportpath.parent.mkdir(exist_ok=True)
    with (reportpath.parent / 'community-models.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        existing = json.loads(reportpath.read_text()) if reportpath.exists() else []
        existing = [entry for entry in existing if entry['alias'] != model['alias']]
        existing.append(record)
        reportpath.write_text(json.dumps(existing, indent=2) + '\n')
print('Requested models imported into local Ollama.', flush=True)
