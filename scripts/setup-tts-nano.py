# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit isolated Nano weight setup; never invoked by application startup."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import re
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def validate_asset(asset):
    name = asset.get('file')
    if not isinstance(name, str) or not re.fullmatch(r'[a-zA-Z0-9_.-]+', name) or name in ('.', '..'):
        raise ValueError('Nano asset must be a plain filename')
    if type(asset.get('bytes')) is not int or not 0 < asset['bytes'] <= 4 * 1024 ** 3:
        raise ValueError('Invalid pinned Nano asset size')
    if not isinstance(asset.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', asset['sha256']):
        raise ValueError('Invalid pinned Nano asset checksum')


def verified(path, asset):
    validate_asset(asset)
    if path.is_symlink():
        raise ValueError('Refusing a symlinked model asset')
    if not path.is_file() or path.stat().st_size != asset['bytes']:
        return False
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest() == asset['sha256']


def install_asset(directory, asset, url, opener=urllib.request.urlopen):
    validate_asset(asset)
    name = asset['file']
    path = directory / name
    if path.is_symlink():
        raise ValueError('Refusing a symlinked model asset')
    if verified(path, asset):
        return path
    with tempfile.NamedTemporaryFile(dir=directory, prefix='nano-', suffix='.download', delete=False) as output:
        temporary = Path(output.name)
        digest = hashlib.sha256()
        count = 0
        try:
            with opener(url, timeout=120) as response:
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > asset['bytes']:
                        raise ValueError('Nano download exceeds the pinned size')
                    digest.update(chunk)
                    output.write(chunk)
            output.flush()
            if count != asset['bytes'] or digest.hexdigest() != asset['sha256']:
                raise ValueError('Nano asset checksum/size mismatch; refusing installation')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    if not args.download:
        parser.error('Use --download for this explicitly requested isolated experiment.')
    manifest = json.loads((ROOT / 'config/tts-nano-experiment.json').read_text())
    directory = ROOT / 'models/chatterbox-nano'
    directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink():
        raise ValueError('Refusing a symlinked experiment directory')
    needed = sum(asset['bytes'] for asset in manifest['files'] if not verified(directory / asset['file'], asset))
    if shutil.disk_usage(directory).free < needed + 512 * 1024 * 1024:
        raise RuntimeError('Insufficient space for verified Nano weights and a 512 MiB reserve')
    for asset in manifest['files']:
        print('Verifying/downloading isolated Nano asset:', asset['file'], flush=True)
        url = f"https://huggingface.co/{manifest['model']}/resolve/{manifest['revision']}/{asset['file']}"
        install_asset(directory, asset, url)
    print('Pinned Nano assets ready. No application voice or runtime was changed.', flush=True)


if __name__ == '__main__':
    main()
