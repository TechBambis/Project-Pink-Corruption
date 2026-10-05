# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""CLI companion to /voice-lab; no designer or cloud dependencies."""
import argparse
import json
import time
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from packages.speech.local.config import CALIBRATION, CANDIDATES, ROOT, load_preset
from packages.speech.local.provider import KokoroProvider
from packages.speech.local.renderer import Renderer

def main():
    parser = argparse.ArgumentParser(description='Local Bambi Voice Lab')
    parser.add_argument('command', choices=['render', 'compare', 'export-voice'])
    parser.add_argument('--text', default=CALIBRATION)
    parser.add_argument('--preset', default='bambi_local_clean')
    parser.add_argument('--voice')
    parser.add_argument('--speed', type=float)
    parser.add_argument('--output', default='runtime/bambi-test.wav')
    parser.add_argument('--name', default='bambi_classic')
    parser.add_argument('--mix', default='af_nicole:0.15 + af_bella:0.425 + af_heart:0.425')
    parser.add_argument('--music', help='Optional original/local PCM WAV, mixed at music_optional gain')
    args = parser.parse_args()
    start = time.perf_counter()
    provider = KokoroProvider()
    startup = time.perf_counter() - start
    if args.command == 'export-voice':
        print(json.dumps(provider.registry.export(args.name, args.mix), indent=2))
        return
    renderer = Renderer(provider)
    changes = {}
    if args.voice:
        changes['voice'] = args.voice
    if args.speed:
        changes['speed'] = args.speed
    music = None
    if args.music:
        import wave
        import numpy as np
        with wave.open(args.music, 'rb') as source:
            if source.getsampwidth() != 2 or source.getnchannels() not in [1, 2]:
                raise ValueError('Music input must be a 16-bit mono/stereo PCM WAV')
            samples = np.frombuffer(source.readframes(source.getnframes()), '<i2').astype(np.float32) / 32768
            if source.getnchannels() == 2:
                samples = samples.reshape(-1, 2)
            music = (samples, source.getframerate())
    if args.command == 'render':
        config = load_preset(args.preset, changes)
        audio, report = renderer.render(args.text, config, music)
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(audio)
        report['startupSeconds'] = startup
        output.with_suffix('.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return
    output = Path(args.output if args.output != 'runtime/bambi-test.wav' else 'runtime/voice-comparison')
    output.mkdir(parents=True, exist_ok=True)
    reports = []
    for voice in [*CANDIDATES, *[x for x in provider.registry.names() if x not in CANDIDATES]]:
        config = load_preset('bambi_voice_test', {**changes, 'voice': voice})
        audio, report = renderer.render(args.text, config)
        (output / f'{voice}.wav').write_bytes(audio)
        reports.append(report)
        print(f'{voice}: {report["durationSeconds"]:.2f}s audio / {report["renderSeconds"]:.2f}s render / RTF {report["realtimeFactor"]:.3f}', flush=True)
    result = {'calibrationText': args.text, 'startupSeconds': startup, 'runtime': 'kokoro-onnx 0.6.1 CPU', 'candidates': reports,
              'selection': 'No automatic perceptual ranking. Listen and compare in Voice Lab.'}
    (output / 'comparison.json').write_text(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
