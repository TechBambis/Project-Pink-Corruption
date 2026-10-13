# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit pinned Supertonic 3 CPU experiment setup; never used by app startup."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('tts_asset_setup', ROOT / 'scripts/setup-tts-nano.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


def locations(manifest, root=ROOT):
    for key in ('revision', 'codeRevision'):
        if not re.fullmatch(r'[0-9a-f]{40}', manifest[key]):
            raise ValueError('An immutable experiment revision is required')
    if manifest['model'] != 'supertone-oss-archive/supertonic-3':
        raise ValueError('Unexpected Supertonic model source')
    records = []
    for asset in manifest['files']:
        assets.validate_asset(asset)
        if asset['group'] not in ('', 'onnx', 'voice_styles'):
            raise ValueError('Unexpected asset directory')
        relative = '/'.join(part for part in (asset['group'], asset['file']) if part)
        directory = root / 'models/supertonic3' / asset['group']
        url = f"https://huggingface.co/{manifest['model']}/resolve/{manifest['revision']}/{relative}"
        records.append((directory, asset, url))
    for asset in manifest['codeFiles']:
        assets.validate_asset(asset)
        if (asset['file'], asset['source']) not in (('helper.py', 'py/helper.py'), ('LICENSE', 'LICENSE')):
            raise ValueError('Unexpected upstream code file')
        url = f"https://raw.githubusercontent.com/supertone-oss-archive/supertonic/{manifest['codeRevision']}/{asset['source']}"
        records.append((root / '.runtime/supertonic3', asset, url))
    for directory, _, _ in records:
        if any(path.is_symlink() for path in (directory, *directory.parents) if path.is_relative_to(root)):
            raise ValueError('Refusing a symlinked experiment directory')
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    if not args.download:
        parser.error('Use --download for this explicitly requested experiment.')
    manifest = json.loads((ROOT / 'config/tts-supertonic-experiment.json').read_text())
    records = locations(manifest)
    needed = sum(asset['bytes'] for directory, asset, _ in records if not assets.verified(directory / asset['file'], asset))
    if shutil.disk_usage(ROOT).free < needed + 512 * 1024 * 1024:
        raise RuntimeError('Insufficient space for pinned assets and a 512 MiB reserve')
    for directory, asset, url in records:
        directory.mkdir(parents=True, exist_ok=True)
        print('Verifying/downloading isolated Supertonic asset:', asset['file'], flush=True)
        assets.install_asset(directory, asset, url)
    print('Supertonic assets ready; no application runtime or voice was changed.', flush=True)


if __name__ == '__main__':
    main()
