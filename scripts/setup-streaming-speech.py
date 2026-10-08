# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit provisioning only; runtime never downloads streaming recognition weights."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'config/streaming-speech-model.json').read_text())
directory = root / '.runtime/streaming-speech/model'
directory.mkdir(parents=True, exist_ok=True)
environment = root / '.runtime/streaming-stt-venv'
subprocess.run([sys.executable, '-m', 'venv', str(environment)], check=True)
subprocess.run([str(environment / 'bin/python'), '-m', 'pip', 'install', '--disable-pip-version-check',
                'sherpa-onnx==1.13.8', 'numpy==2.5.3'], check=True)
for file in manifest['files']:
    path = directory / file['path']
    def verified(candidate):
        return candidate.is_file() and candidate.stat().st_size == file['bytes'] and hashlib.sha256(candidate.read_bytes()).hexdigest() == file['sha256']
    if verified(path):
        continue
    temporary = path.with_suffix(path.suffix + '.download')
    url = f"https://huggingface.co/{manifest['model']}/resolve/{manifest['revision']}/{file['path']}"
    print('Downloading verified local speech asset:', file['path'], flush=True)
    try:
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                if output.tell() > file['bytes']:
                    raise ValueError('Download exceeds the pinned file size')
        if not verified(temporary):
            raise ValueError('Streaming speech asset checksum mismatch')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
print('English streaming speech installed. Restart the app server to enable it. No model downloads occur at runtime.')
