# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import hashlib
import json
import re
from pathlib import Path
import numpy as np
from .config import CANDIDATES, ROOT

def parse_mix(expression):
    parts = []
    for part in expression.split('+'):
        # Accept explicit ratios and the existing app's Kokoro percentages.
        match = re.fullmatch(r'\s*([a-z][a-z0-9_]*)(?::([\d.]+)|\(([\d.]+)\))?\s*', part)
        if not match:
            raise ValueError('Use af_sarah:0.6 + af_bella:0.4')
        weight = float(match[2] or match[3] or 1)
        if not np.isfinite(weight) or not 0 <= weight <= 100:
            raise ValueError('Invalid voice weight')
        parts.append((match[1], weight))
    if not 1 <= len(parts) <= 7 or sum(weight for _, weight in parts) <= 0:
        raise ValueError('Voice mix needs 1–7 voices with positive total weight')
    total = sum(weight for _, weight in parts)
    return [(name, weight / total) for name, weight in parts]

class VoiceRegistry:
    def __init__(self, bundle, directory=None):
        self.bundle = bundle
        self.directory = Path(directory or ROOT / 'voices')
        self.custom = {}
        for path in self.directory.glob('*.npy'):
            if re.fullmatch(r'[a-z][a-z0-9_]*', path.stem):
                style = np.load(path, allow_pickle=False)
                self._validate(style)
                self.custom[path.stem] = style.astype(np.float32)
        self.cache = {}

    def _validate(self, style):
        if style.shape != self.bundle['af_heart'].shape or not np.isfinite(style).all():
            raise ValueError('Custom voice must match the Kokoro embedding shape and contain finite values')

    def names(self):
        return [name for name in CANDIDATES if name in self.bundle] + sorted(self.custom)

    def style(self, expression):
        if expression not in self.cache:
            style = None
            for name, weight in parse_mix(expression):
                if name not in self.names():
                    raise ValueError(f'Unknown local female voice: {name}')
                source = self.custom[name] if name in self.custom else self.bundle[name]
                style = source * weight if style is None else style + source * weight
            self._validate(style)
            self.cache[expression] = style.astype(np.float32)
            if len(self.cache) > 64:
                self.cache.pop(next(iter(self.cache)))
        return self.cache[expression]

    def fingerprint(self, expression):
        return hashlib.sha256(self.style(expression).tobytes()).hexdigest()

    def export(self, name, expression):
        if not re.fullmatch(r'[a-z][a-z0-9_]*', name) or name in CANDIDATES:
            raise ValueError('Invalid custom voice name')
        style = self.style(expression)
        self.directory.mkdir(parents=True, exist_ok=True)
        np.save(self.directory / f'{name}.npy', style, allow_pickle=False)
        provenance = {'name': name, 'method': 'normalized embedding average', 'mix': parse_mix(expression),
                      'upstream': 'hexgrad/Kokoro-82M v1.0 via thewh1teagle model-files-v1.1',
                      'license': 'Apache-2.0 (derived voice embedding)', 'sha256': hashlib.sha256(style.tobytes()).hexdigest(),
                      'referenceRecordings': [], 'description': 'Original local blend; no commercial reference voice or recordings used.'}
        (self.directory / f'{name}.json').write_text(json.dumps(provenance, indent=2))
        self.custom[name] = style
        self.cache.clear()
        return provenance
