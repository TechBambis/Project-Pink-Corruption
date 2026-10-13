# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Bounded CPU options; an explicit local measured profile is tied to host and weights."""
import json
import os
import platform
import sys
from pathlib import Path
from .config import DATA


def cpu_identity():
    name = platform.processor()
    if sys.platform == 'linux':
        try:
            name = next(line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines()
                        if line.startswith('model name'))
        except (OSError, StopIteration):
            pass
    return {'platform': sys.platform, 'machine': platform.machine(), 'cpu': name,
            'logicalCPUs': os.cpu_count() or 1,
            'availableCPUs': len(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else os.cpu_count() or 1}


def cpu_runtime_options(model_id, profile_path=None, host=None, environment=None):
    host = cpu_identity() if host is None else host
    environment = os.environ if environment is None else environment
    result = {'threads': min(4, host['availableCPUs']), 'dynamicBlock': 0, 'source': 'default'}
    try:
        profile = json.loads(Path(profile_path or DATA / 'runtime/tts-cpu-profile.json').read_text())
        if (isinstance(profile, dict) and profile.get('version') == 1 and profile.get('host') == host
                and profile.get('modelSha256') == model_id
                and type(profile.get('threads')) is int and 1 <= profile['threads'] <= min(32, host['availableCPUs'])
                and type(profile.get('dynamicBlock', 0)) is int and 0 <= profile.get('dynamicBlock', 0) <= 64):
            result = {'threads': profile['threads'], 'dynamicBlock': profile.get('dynamicBlock', 0), 'source': 'measured-local'}
    except (OSError, ValueError):
        pass
    if 'BAMBI_TTS_THREADS' in environment:
        threads = int(environment['BAMBI_TTS_THREADS'])
        if not 1 <= threads <= 32:
            raise ValueError('BAMBI_TTS_THREADS must be 1–32')
        result = {'threads': threads, 'dynamicBlock': 0, 'source': 'environment'}
    if 'BAMBI_TTS_DYNAMIC_BLOCK' in environment:
        block = int(environment['BAMBI_TTS_DYNAMIC_BLOCK'])
        if not 0 <= block <= 64:
            raise ValueError('BAMBI_TTS_DYNAMIC_BLOCK must be 0–64')
        result = {**result, 'dynamicBlock': block, 'source': 'environment'}
    return result
