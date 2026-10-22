# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit, hash-pinned LIVE-03 research setup. Never called by app startup."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'config/live-voice-experiment.json'


def validate_asset(asset):
    for key in ('file', 'path'):
        value = asset.get(key)
        path = PurePosixPath(value) if isinstance(value, str) else None
        if not path or path.is_absolute() or '..' in path.parts or '\\' in value or not re.fullmatch(r'[A-Za-z0-9_./-]+', value):
            raise ValueError('Invalid research asset path')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', asset.get('repo', '')):
        raise ValueError('Invalid research repository')
    if not re.fullmatch(r'[0-9a-f]{40}', asset.get('revision', '')) or not re.fullmatch(r'[0-9a-f]{64}', asset.get('sha256', '')):
        raise ValueError('Research assets require immutable revisions and SHA-256')
    if type(asset.get('bytes')) is not int or not 0 <= asset['bytes'] <= 2 * 1024 ** 3:
        raise ValueError('Invalid research asset size')


def destination(base, asset):
    validate_asset(asset)
    target = base / asset['path']
    if target.is_symlink() or not target.resolve().is_relative_to(base.resolve()):
        raise ValueError('Research asset escapes its root')
    return target


def verified(path, asset):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != asset['bytes']:
        return False
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == asset['sha256']


def install(base, asset, source=False):
    path = destination(base, asset)
    if verified(path, asset):
        return 'verified'
    path.parent.mkdir(parents=True, exist_ok=True)
    url = (f"https://raw.githubusercontent.com/{asset['repo']}/{asset['revision']}/{asset['file']}" if source
           else f"https://huggingface.co/{asset['repo']}/resolve/{asset['revision']}/{asset['file']}")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.live-voice-', suffix='.part', delete=False) as output:
            temporary = Path(output.name)
            digest = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(url, timeout=60) as response:
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > asset['bytes']:
                        raise ValueError('Research download exceeds its pinned size')
                    digest.update(block)
                    output.write(block)
            if size != asset['bytes'] or digest.hexdigest() != asset['sha256']:
                raise ValueError('Research download failed size/hash verification')
        temporary.replace(path)
        return 'installed'
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def install_moss_profile(source, reference, name, kind, run=False):
    """Explicit import of the exact tested CPU graphs and an authorized WAV.

    Import is local only, never inference-time setup. All inputs are verified
    before writing; a reference record is activated only after its assets.
    """
    sys.path.insert(0, str(ROOT))
    from packages.speech.local.moss import PROFILE, verify_profile, digest
    graphs = verify_profile(source)
    reference = Path(reference)
    if (not re.fullmatch(r'[a-z][a-z0-9_]{0,47}', name) or kind not in ('synthetic', 'authorized')
            or reference.is_symlink() or not reference.is_file() or reference.stat().st_size > 12 * 1024**2):
        raise ValueError('An explicitly authorized bounded local reference is required')
    with wave.open(str(reference)) as stream:
        rate, channels, frames = stream.getframerate(), stream.getnchannels(), stream.getnframes()
        if stream.getsampwidth() != 2 or channels not in (1, 2) or rate not in (16000, 22050, 24000, 44100, 48000) or not 0 < frames <= rate * 30:
            raise ValueError('MOSS reference must be bounded PCM16 speech')
        samples = stream.readframes(frames)
        if len(samples) != frames * channels * 2:
            raise ValueError('MOSS reference is truncated')
        if not any(samples):
            raise ValueError('MOSS reference contains no speech samples')
    record = {'version': 1, 'id': 'moss_' + name, 'profile': PROFILE['profile'],
              'status': 'experimental-opt-in', 'referenceKind': kind, 'file': name + '.wav',
              'bytes': reference.stat().st_size, 'sha256': digest(reference), 'sampleRate': rate,
              'channels': channels, 'seconds': frames / rate,
              'nativeWordTimings': False, 'nativeVocalTags': False}
    if not run:
        return record | {'installation': 'verified inputs; --run required to install'}
    models = ROOT / 'models/live-voice'
    def copy(source_path, target, expected_size, expected_sha):
        if target.is_symlink() or not target.resolve().is_relative_to(models.resolve()):
            raise ValueError('MOSS import escapes its model root')
        if target.is_file() and target.stat().st_size == expected_size and digest(target) == expected_sha:
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.moss-import-', suffix='.part', delete=False) as output:
                temporary = Path(output.name)
                with source_path.open('rb') as input_file:
                    shutil.copyfileobj(input_file, output, 1024 * 1024)
            if temporary.stat().st_size != expected_size or digest(temporary) != expected_sha:
                raise ValueError('MOSS import changed during copy')
            temporary.replace(target)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
    for asset in PROFILE['graphs']:
        copy(graphs[asset['file']], models / PROFILE['profile'] / asset['file'], asset['bytes'], asset['sha256'])
    copy(reference, models / 'moss-references' / record['file'], record['bytes'], record['sha256'])
    target = models / 'moss-references' / (name + '.json')
    if target.is_symlink() or not target.resolve().is_relative_to(models.resolve()):
        raise ValueError('MOSS reference record escapes its root')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, prefix='.moss-reference-', suffix='.part', delete=False) as output:
            temporary = Path(output.name)
            json.dump(record, output, indent=2)
            output.write('\n')
        temporary.replace(target)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return record | {'installation': 'installed locally; not a qualified provider or default change'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='Explicitly download only the pinned research assets')
    parser.add_argument('--provider', choices=('sopro', 'moss', 'pocket'), required=True)
    parser.add_argument('--moss-int8-from', type=Path, help='Explicit local import of the exact tested CPU graph set')
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--reference-name', default='character')
    parser.add_argument('--reference-kind', choices=('synthetic', 'authorized'))
    args = parser.parse_args()
    if (args.moss_int8_from or args.reference or args.reference_kind) and not (args.provider == 'moss' and args.moss_int8_from and args.reference and args.reference_kind):
        parser.error('MOSS import requires --provider moss, --moss-int8-from, --reference and --reference-kind')
    manifest = json.loads(MANIFEST.read_text())
    assert manifest['version'] == 1 and manifest['status'] == 'experiment-only'
    provider = next(p for p in manifest['providers'] if p['id'] == args.provider)
    if provider['status'] == 'access-required':
        print(json.dumps({'provider': args.provider, 'status': 'access-required', 'reason': provider['reason']}))
        return
    if args.moss_int8_from:
        # Reject bad local input before any optional model downloads or writes.
        install_moss_profile(args.moss_int8_from, args.reference, args.reference_name, args.reference_kind)
    for group, base, source in [('assets', ROOT / 'models/live-voice' / args.provider, False),
                                ('sources', ROOT / '.runtime/live-voice/sources' / args.provider, True)]:
        for asset in provider[group]:
            path = destination(base, asset)
            status = install(base, asset, source) if args.run else 'verified' if verified(path, asset) else 'missing'
            print(json.dumps({'provider': args.provider, 'group': group, 'file': asset['path'], 'status': status}), flush=True)
    if args.moss_int8_from:
        print(json.dumps(install_moss_profile(args.moss_int8_from, args.reference, args.reference_name, args.reference_kind, args.run)), flush=True)


if __name__ == '__main__':
    main()
