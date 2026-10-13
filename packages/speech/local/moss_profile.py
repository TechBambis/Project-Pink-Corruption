# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Lightweight profile verification shared with the ordinary speech service.

Keep optional Torch/upstream model imports in the separately provisioned child.
"""
import hashlib
import json
from pathlib import Path

from .config import ROOT
PROFILE = json.loads((ROOT / 'config/moss-live.json').read_text())


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_profile(directory):
    directory = Path(directory)
    expected = {'moss_tts_decode_step.onnx', 'moss_tts_local_cached_step.onnx',
                'moss_tts_local_decoder.onnx', 'moss_tts_local_fixed_sampled_frame.onnx',
                'moss_tts_prefill.onnx'}
    if (PROFILE['version'] != 1 or PROFILE['profile'] != 'moss-int8-alias-v2'
            or len(PROFILE['graphs']) != 5 or {a['file'] for a in PROFILE['graphs']} != expected):
        raise ValueError('Incomplete or unsupported MOSS CPU profile')
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('The explicitly installed MOSS CPU profile is missing')
    result = {}
    for asset in PROFILE['graphs']:
        path = directory / asset['file']
        if (path.is_symlink() or not path.resolve().is_relative_to(directory.resolve())
                or not path.is_file() or path.stat().st_size != asset['bytes']
                or digest(path) != asset['sha256']):
            raise ValueError('Missing or changed MOSS CPU graph: ' + asset['file'])
        result[asset['file']] = path.resolve()
    return result

