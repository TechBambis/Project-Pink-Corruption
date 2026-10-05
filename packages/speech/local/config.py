# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import copy
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PRESETS = ROOT / 'presets/audio'
CANDIDATES = ['af_heart', 'af_bella', 'af_sarah', 'af_nicole', 'af_sky', 'af_river', 'af_aoede']
CALIBRATION = ('Take a quiet moment. [pause:550] Keep the small silver key beside the blue glass. '
               '[pause:900] Crisp consonants. Soft sentence endings. [pause:550] '
               'The pace stays even, and the tone stays clear. [pause:1500] '
               'Here, now. [pause:550] Here, now. [pause:900] One short phrase. Then another.')

def merge(base, changes):
    result = copy.deepcopy(base)
    for key, value in changes.items():
        if key not in result:
            raise ValueError(f'Unknown setting: {key}')
        if isinstance(result[key], dict):
            if not isinstance(value, dict):
                raise ValueError(f'{key} must be an object')
            result[key] = merge(result[key], value)
        else:
            result[key] = value
    return result

def validate(config):
    def num(value, low, high, name):
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{name} must be between {low} and {high}')
    def walk(value):
        if isinstance(value, dict):
            for k, v in value.items():
                if k == 'enabled' and not isinstance(v, bool):
                    raise ValueError('enabled must be boolean')
                if isinstance(v, (dict, list)):
                    walk(v)
                elif isinstance(v, float) and not math.isfinite(v):
                    raise ValueError('Non-finite setting')
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(config)
    if not isinstance(config['voice'], str):
        raise ValueError('voice must be a voice name or weighted mix')
    num(config['speed'], .5, 1.5, 'speed')
    config.setdefault('trigger', {'speedMultiplier': 1, 'volumeDb': 0})
    if not isinstance(config['trigger'], dict) or set(config['trigger']) != {'speedMultiplier', 'volumeDb'}:
        raise ValueError('trigger must contain speedMultiplier and volumeDb')
    num(config['trigger']['speedMultiplier'], .5, 1.5, 'trigger speedMultiplier')
    num(config['trigger']['volumeDb'], -24, 6, 'trigger volumeDb')
    num(config['pitchSemitones'], -4, 4, 'pitchSemitones')
    if isinstance(config['sampleRate'],bool) or config['sampleRate'] not in [16000, 22050, 24000, 44100, 48000]:
        raise ValueError('Unsupported sample rate')
    for key, value in config['timing'].items():
        num(value, 0, 10000, key)
    for key, value in config['mix'].items():
        num(value, -80, 6, key)
    dsp = config['processing']
    num(dsp['highpassHz'], 0, 200, 'highpassHz')
    num(dsp['eqHz'], 100, 6000, 'eqHz')
    num(dsp['eqDb'], -6, 6, 'eqDb')
    num(dsp['compressionRatio'], 1, 4, 'compressionRatio')
    num(dsp['thresholdDb'], -40, 0, 'thresholdDb')
    num(dsp['attackMs'], 1, 200, 'attackMs')
    num(dsp['releaseMs'], 10, 1000, 'releaseMs')
    num(dsp['echoMs'], 0, 1500, 'echoMs')
    if not isinstance(dsp['echoEnabled'],bool):
        raise ValueError('echoEnabled must be boolean')
    num(config['limiterPeak'], .1, .999, 'limiterPeak')
    for ear in ['left', 'right']:
        for tone in ['lowHz', 'highHz']:
            num(config['drone'][ear][tone], 20, 2000, tone)
    for key in ['lowModHz', 'highModHz']:
        num(config['drone'][key], 0, 20, key)
    num(config['drone']['modDepth'], 0, 1, 'modDepth')
    noise = config['noise']
    if noise['type'] not in ['pink', 'white', 'brown']:
        raise ValueError('Unknown noise type')
    num(noise['lowpassHz'], 100, config['sampleRate'] / 2 - 1, 'noise lowpass')
    num(noise['width'], 0, 1, 'noise width')
    for layer in ['left_voice', 'right_voice']:
        item = config['layers'][layer]
        if not isinstance(item['voice'], str):
            raise ValueError('Layer voice must be a name or mix')
        num(item['delayMs'], 0, 2000, 'layer delay')
        num(item['speed'], .5, 1.5, 'layer speed')
        num(item['pitchSemitones'], -4, 4, 'layer pitch')
        num(item['pan'], -1, 1, 'pan')
    return config

def load_preset(name='bambi_local_clean', overrides=None):
    if name not in [p.stem for p in PRESETS.glob('*.json')]:
        raise ValueError('Unknown audio preset')
    data = json.loads((PRESETS / f'{name}.json').read_text())
    data.setdefault('trigger', {'speedMultiplier': 1, 'volumeDb': 0})
    return validate(merge(data, overrides or {}))

def preset_catalog():
    return {p.stem: load_preset(p.stem) for p in sorted(PRESETS.glob('*.json'))}
