# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit pinned Linux Qwen VoiceDesign GGUF/Vulkan setup; never app startup."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('tts_assets', ROOT / 'scripts/setup-tts-nano.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


def locations(manifest, root=ROOT):
    if manifest['model'] != 'Serveurperso/Qwen3-TTS-GGUF' or manifest['abiVersion'] != 5:
        raise ValueError('Unexpected Qwen source or ABI')
    if not re.fullmatch(r'[0-9a-f]{40}', manifest['revision']):
        raise ValueError('Immutable Qwen model revision required')
    records = [(root / 'models/qwen3tts', e,
                f"https://huggingface.co/{manifest['model']}/resolve/{manifest['revision']}/{e['file']}") for e in manifest['files']]
    for e in manifest['codeArchives']:
        if e['repository'] not in ('ServeurpersoCom/qwentts.cpp', 'ServeurpersoCom/ggml') or not re.fullmatch(r'[0-9a-f]{40}', e['revision']):
            raise ValueError('Unexpected Qwen native source')
        records.append((root / '.runtime/qwen3tts', e, f"https://codeload.github.com/{e['repository']}/tar.gz/{e['revision']}"))
    e = manifest['modelLicenseFile']
    if e['repository'] != 'QwenLM/Qwen3-TTS' or e['source'] != 'LICENSE' or not re.fullmatch(r'[0-9a-f]{40}', e['revision']):
        raise ValueError('Unexpected Qwen model license')
    records.append((root / 'models/qwen3tts', e, f"https://raw.githubusercontent.com/{e['repository']}/{e['revision']}/LICENSE"))
    for directory, e, _ in records:
        assets.validate_asset(e)
        if any(p.is_symlink() for p in (directory, *directory.parents)):
            raise ValueError('Refusing a symlinked Qwen setup directory')
    return records


def extract(archive, directory):
    """Unpack only regular files/directories; never follow archive links."""
    directory.mkdir(parents=True, exist_ok=True)
    if any(p.is_symlink() for p in (directory, *directory.parents)):
        raise ValueError('Symlinked Qwen source directory')
    with tarfile.open(archive) as source:
        for item in source:
            parts = PurePosixPath(item.name).parts
            if not parts or item.name.startswith('/') or '..' in parts:
                raise ValueError('Unsafe Qwen source archive path')
            # GitHub tarballs have one enclosing directory.
            relative = Path(*parts[1:])
            target = directory / relative
            if any(p.is_symlink() for p in (target, *target.parents)):
                raise ValueError('Refusing source extraction over symlinks')
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif item.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(item) as incoming:
                    content = incoming.read()
                if not target.is_file() or target.read_bytes() != content:
                    target.write_bytes(content)
            elif item.issym() or item.islnk() or item.isdev() or item.isfifo():
                if str(relative) == '.pi/SYSTEM.md' and item.issym() and item.linkname == 'gg/SYSTEM.md':
                    # Pinned upstream agent documentation, unused by this build.
                    # Do not install/follow it into our source workspace.
                    continue
                raise ValueError('Source archive contains links or special files')
            # Non-file PAX metadata has no executable/file payload.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--jobs', type=int, default=3)
    args = parser.parse_args()
    if not args.download and not args.build:
        parser.error('Use --download and/or --build explicitly.')
    if not 1 <= args.jobs <= 6:
        parser.error('--jobs must be 1–6')
    manifest = json.loads((ROOT / 'config/tts-qwen3-experiment.json').read_text())
    records = locations(manifest)
    needed = sum(e['bytes'] for d, e, _ in records if not assets.verified(d / e['file'], e))
    if shutil.disk_usage(ROOT).free < (needed if args.download else 0) + 512 * 1024**2:
        raise RuntimeError('Qwen setup requires a 512 MiB free-space reserve')
    for directory, entry, url in records:
        directory.mkdir(parents=True, exist_ok=True)
        if args.download:
            print('Verifying/downloading pinned Qwen asset:', entry['file'], flush=True)
            assets.install_asset(directory, entry, url)
        elif not assets.verified(directory / entry['file'], entry):
            raise ValueError('Missing or unverified Qwen assets; explicitly use --download')
    if args.build:
        if not sys.platform.startswith('linux') or not all(shutil.which(x) for x in ('cmake', 'ninja', 'g++', 'glslc')):
            raise RuntimeError('This experiment needs Linux, CMake, Ninja, C++ and Vulkan shader tools')
        runtime = ROOT / '.runtime/qwen3tts'
        extract(runtime / 'source.tar.gz', runtime / 'source')
        extract(runtime / 'ggml.tar.gz', runtime / 'source/ggml')
        env = dict(os.environ, GIT_CEILING_DIRECTORIES=str(runtime))
        # A tarball has no Git identity. Prevent upstream version.cmake from
        # accidentally reporting the surrounding Bambi repository's commit.
        command = ['cmake', '-S', str(runtime / 'source'), '-B', str(runtime / 'build'), '-G', 'Ninja',
                   '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_POSITION_INDEPENDENT_CODE=ON', '-DQWEN_SHARED=ON',
                   '-DGGML_VULKAN=ON', '-DGGML_CUDA=OFF', '-DGGML_NATIVE=ON',
                   '-DGGML_BUILD_TESTS=OFF', '-DGGML_BUILD_EXAMPLES=OFF']
        headers = ROOT / '.runtime/toolchain/usr'
        if (headers / 'share/cmake/SPIRV-Headers').is_dir():
            command += [f'-DCMAKE_PREFIX_PATH={headers}', f'-DCMAKE_CXX_FLAGS=-I{headers}/include']
        subprocess.run(command, env=env, check=True)
        subprocess.run(['cmake', '--build', str(runtime / 'build'), '--target', 'qwen', 'qwen-tts', 'test-abi-c', '-j', str(args.jobs)], env=env, check=True)
        subprocess.run([str(runtime / 'build/test-abi-c')], env=env, check=True)
        files = []
        for path in sorted((runtime / 'build').glob('lib*.so*')):
            if path.is_symlink():
                continue
            with path.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            files.append({'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest})
        record = {'abiVersion': 5, 'codeRevision': manifest['codeArchives'][0]['revision'],
                  'ggmlRevision': manifest['codeArchives'][1]['revision'], 'backend': 'vulkan', 'files': files}
        with tempfile.NamedTemporaryFile(dir=runtime, mode='w', delete=False) as output:
            json.dump(record, output, indent=2)
            output.write('\n')
            name = output.name
        Path(name).replace(runtime / 'build-provenance.json')
    print('Qwen experiment ready. Select Qwen VoiceDesign in Voice Lab; session voice is unchanged.')


if __name__ == '__main__':
    main()
