# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Download only explicitly listed open model assets, verify each SHA-256."""
import hashlib
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parents[1]
directory = root / 'models/kokoro'
directory.mkdir(parents=True, exist_ok=True)
for asset in json.loads((root / 'packages/speech/local/models.json').read_text()):
    path = directory / asset['file']
    if path.exists() and hashlib.file_digest(path.open('rb'), 'sha256').hexdigest() == asset['sha256']:
        print(f'Verified cached {asset["file"]}')
        continue
    temporary = path.with_suffix(path.suffix + '.download')
    try:
        with urllib.request.urlopen(asset['url'], timeout=90) as source, temporary.open('wb') as output:
            while chunk := source.read(1024 * 1024):
                output.write(chunk)
        if hashlib.file_digest(temporary.open('rb'), 'sha256').hexdigest() != asset['sha256']:
            raise ValueError(f'Checksum mismatch for {asset["file"]}; refusing to install')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Installed and verified {asset["file"]}')
