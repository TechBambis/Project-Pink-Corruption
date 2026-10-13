# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Optional, explicitly provisioned Supertonic provider for Voice Lab rendering."""
import hashlib
import importlib.util
import json
import math
from collections import OrderedDict
from pathlib import Path
import re
import numpy as np
import onnxruntime as ort
from .config import ROOT, MODELS
from .spoken import spoken_input


class SupertonicVoices:
    def names(self):
        return ['F1', 'F2', 'F3', 'F4', 'F5']

    def style(self, name):
        if name not in self.names():
            raise ValueError('Supertonic voice must be F1–F5; Kokoro blends are not supported')
        return name


def assets():
    manifest = json.loads((ROOT / 'config/tts-supertonic-experiment.json').read_text())
    records = []
    for entry in manifest['files']:
        if entry['group'] not in ('', 'onnx', 'voice_styles'):
            raise ValueError('Unexpected Supertonic asset directory')
        records.append((MODELS / 'supertonic3' / entry['group'] / entry['file'], entry))
    for entry in manifest['codeFiles']:
        if entry['file'] not in ('helper.py', 'LICENSE'):
            raise ValueError('Unexpected Supertonic source asset')
        records.append((ROOT / '.runtime/supertonic3' / entry['file'], entry))
    if {entry['file'] for entry in manifest['codeFiles']} != {'helper.py', 'LICENSE'}:
        raise ValueError('Supertonic requires pinned helper code and its license')
    for path, entry in records:
        if (not re.fullmatch(r'[a-zA-Z0-9_.-]+', entry['file']) or entry['file'] in ('.', '..')
                or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256'])
                or type(entry['bytes']) is not int or not 0 < entry['bytes'] <= 4 * 1024**3
                or any(parent.is_symlink() for parent in (path, *path.parents))):
            raise ValueError('Invalid or symlinked pinned Supertonic asset')
    return manifest, records


def available():
    try:
        _, records = assets()
        return all(path.is_file() and path.stat().st_size == entry['bytes'] for path, entry in records)
    except (OSError, ValueError, KeyError, TypeError):
        return False


def controls(steps=5, seed=41):
    if type(steps) is not int or steps not in (4, 5, 10):
        raise ValueError('Supertonic quality must be 4, 5 or 10 steps')
    if type(seed) is not int or not 0 <= seed <= 2147483647:
        raise ValueError('Supertonic seed must be an integer between 0 and 2147483647')
    return steps, seed


class SupertonicProvider:
    def __init__(self, threads=4):
        manifest, records = assets()
        for path, entry in records:
            if not path.is_file() or path.stat().st_size != entry['bytes']:
                raise FileNotFoundError('Supertonic is not set up. Run python3 scripts/setup-tts-supertonic.py --download explicitly.')
            with path.open('rb') as source:
                if hashlib.file_digest(source, 'sha256').hexdigest() != entry['sha256']:
                    raise ValueError('Supertonic asset checksum mismatch. Re-run its explicit setup.')
        self.model_id = manifest['revision']
        spec = importlib.util.spec_from_file_location('bambi_supertonic_helper', ROOT / '.runtime/supertonic3/helper.py')
        upstream = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(upstream)
        options = ort.SessionOptions()
        ort.disable_telemetry_events()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.add_session_config_entry('session.intra_op.allow_spinning', '0')
        options.add_session_config_entry('session.inter_op.allow_spinning', '0')
        directory = str(MODELS / 'supertonic3/onnx')
        sessions = upstream.load_onnx_all(directory, options, ['CPUExecutionProvider'])
        self.model = upstream.TextToSpeech(upstream.load_cfgs(directory), upstream.load_text_processor(directory), *sessions)
        self.sample_rate = self.model.sample_rate
        self.registry = SupertonicVoices()
        self.styles = {name:upstream.load_voice_style([str(MODELS / f'supertonic3/voice_styles/{name}.json')]) for name in self.registry.names()}
        self.steps, self.seed = controls()
        self.cache = OrderedDict()
        self.cache_hits = self.cache_misses = 0

    def configure(self, steps=5, seed=41):
        self.steps, self.seed = controls(steps, seed)

    def synthesize(self, text, voice, speed):
        text = spoken_input(text)
        self.registry.style(voice)
        if not text or len(text) > 180:
            raise ValueError('Supertonic expects a spoken phrase of at most 180 characters')
        if isinstance(speed, bool) or not isinstance(speed, (float, int)) or not math.isfinite(speed) or not .25 <= speed <= 1.5:
            raise ValueError('Effective speech speed must be 0.25–1.5')
        key = (self.model_id, voice, text, speed, self.steps, self.seed)
        if key in self.cache:
            self.cache_hits += 1
            self.cache.move_to_end(key)
            return self.cache[key].copy(), self.sample_rate
        self.cache_misses += 1
        state = np.random.get_state()
        try:
            np.random.seed(self.seed)
            wave, duration = self.model(text, 'en', self.styles[voice], total_step=self.steps, speed=speed)
        finally:
            np.random.set_state(state)
        samples = np.asarray(wave[0, :int(float(duration[0])*self.sample_rate)], dtype=np.float32)
        if not .1 < len(samples)/self.sample_rate < 90 or not np.isfinite(samples).all():
            raise ValueError('Supertonic returned invalid phrase audio')
        self.cache[key] = samples.copy()
        while len(self.cache) > 32:
            self.cache.popitem(last=False)
        return samples, self.sample_rate
