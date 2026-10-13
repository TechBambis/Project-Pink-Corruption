# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit same-text Supertonic 3 / Kokoro CPU trial, outside application runtime."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import resource
import socket
import statistics
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    imported = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(imported)
    return imported


common = module('tts_comparison', ROOT / 'scripts/tts-nano-benchmark.py')
setup = module('supertonic_setup', ROOT / 'scripts/setup-tts-supertonic.py')


def verify_assets():
    manifest = json.loads((ROOT / 'config/tts-supertonic-experiment.json').read_text())
    for directory, asset, _ in setup.locations(manifest):
        if not setup.assets.verified(directory / asset['file'], asset):
            raise RuntimeError('Provision pinned Supertonic assets explicitly before inference.')
    return manifest


def idle():
    for port in (6969, 6971):
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/diagnostics/replies', timeout=5) as response:
            if any(reply['status'] == 'active' for reply in json.load(response)['replies']):
                raise RuntimeError('A reply is active; defer the isolated CPU benchmark.')
    with urllib.request.urlopen('http://127.0.0.1:8080/slots', timeout=5) as response:
        if any(slot.get('is_processing') for slot in json.load(response)):
            raise RuntimeError('Native inference is active; defer the CPU benchmark.')


def worker(output, threads, step_values):
    started = time.perf_counter()
    manifest = verify_assets()
    import numpy as np
    import onnxruntime as ort
    from packages.speech.local.dsp import wav_bytes
    upstream = module('pinned_supertonic', ROOT / '.runtime/supertonic3/helper.py')

    def offline(*args, **kwargs):
        raise RuntimeError('Network access is disabled during Supertonic inference.')
    socket.socket.connect = offline
    imported = time.perf_counter()
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.inter_op_num_threads = 1
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    opts.add_session_config_entry('session.intra_op.allow_spinning', '0')
    opts.add_session_config_entry('session.inter_op.allow_spinning', '0')
    directory = str(ROOT / 'models/supertonic3/onnx')
    sessions = upstream.load_onnx_all(directory, opts, ['CPUExecutionProvider'])
    model = upstream.TextToSpeech(upstream.load_cfgs(directory), upstream.load_text_processor(directory), *sessions)
    styles = {name:upstream.load_voice_style([str(ROOT / f'models/supertonic3/voice_styles/{name}.json')])
              for name in ('F1', 'F2', 'F3', 'F4', 'F5')}
    loaded = time.perf_counter()
    np.random.seed(40)
    model('The public comparison is ready.', 'en', styles['F1'], total_step=5, speed=.78)
    warm = time.perf_counter()
    report = {'status':'running', 'manifest':manifest, 'threads':threads, 'speed':.78, 'voice':'F1',
              'runtimeVersions':{'python':sys.version, 'numpy':np.__version__, 'onnxruntime':ort.__version__},
              'importAndAssetVerifyMs':(imported-started)*1000, 'modelLoadMs':(loaded-imported)*1000,
              'warmupMs':(warm-loaded)*1000, 'runs':[]}
    for steps in step_values:
        result = {'engine':f'supertonic3-{steps}step-F1', 'steps':steps, 'measurements':[]}
        for repeat in range(3):
            for index, text in enumerate(common.TEXTS):
                np.random.seed(41 + repeat)
                begin = time.perf_counter()
                samples, duration = model(text, 'en', styles['F1'], total_step=steps, speed=.78)
                ms = (time.perf_counter()-begin)*1000
                # Upstream predicts useful length; trim its padded vocoder tail only.
                pcm = samples[0, :int(float(duration[0])*model.sample_rate)]
                common.record(result, output, index, repeat, text, pcm, model.sample_rate, ms)
        result.update({'status':'complete', 'threads':threads, 'fullPhraseMedianMs':statistics.median(m['fullPhraseMs'] for m in result['measurements']),
                       'rtfMedian':statistics.median(m['rtf'] for m in result['measurements'])})
        common.write_json(output / f'{result["engine"]}.json', result)
        report['runs'].append(result)
        common.write_json(output / 'supertonic3.json', report)
    for name, style in styles.items():
        np.random.seed(41)
        samples, duration = model(common.TEXTS[1], 'en', style, total_step=5, speed=.78)
        pcm = samples[0, :int(float(duration[0])*model.sample_rate)]
        (output / f'supertonic3-voice-{name}-raw.wav').write_bytes(wav_bytes(pcm, model.sample_rate))
    tag_text = '<sigh> You sound very certain. Let us see whether your argument holds.'
    np.random.seed(45)
    samples, duration = model(tag_text, 'en', styles['F1'], total_step=5, speed=.78)
    (output / 'supertonic3-sigh-raw.wav').write_bytes(wav_bytes(samples[0, :int(float(duration[0])*model.sample_rate)], model.sample_rate))
    report.update({'status':'complete', 'extraTagText':tag_text,
                   'maxRssMiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024})
    common.write_json(output / 'supertonic3.json', report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--worker', action='store_true')
    parser.add_argument('--threads', type=int, choices=(4, 6), default=6)
    parser.add_argument('--steps', type=int, nargs='+', choices=(2, 3, 4, 5, 10), default=[2, 5, 10])
    parser.add_argument('--output', default='runtime/tts-supertonic3-comparison-2026-10-09')
    args = parser.parse_args()
    if not args.run:
        parser.error('Use --run for actual local synthesis.')
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to((ROOT / 'runtime').resolve()):
        parser.error('Keep generated public audio under ignored runtime/.')
    output.mkdir(parents=True, exist_ok=True)
    if args.worker:
        worker(output, args.threads, args.steps)
        return
    manifest = verify_assets()
    report = {'status':'running', 'manifest':manifest, 'texts':common.TEXTS,
              'scope':f'CPU-only, three public texts, three uncached repeats, {args.threads} threads; Kokoro af_heart vs Supertonic F1, speed .78. Same numeric speed does not guarantee same cadence: report audio duration and RTF. Complete phrase API time, not conversation latency or streaming first PCM. Supertonic lacks word alignment: integration overhead excluded. No private history, human voice reference, microphone, physical output, preference or p95 qualification.', 'runs':[]}
    common.write_json(output / 'report.json', report)
    environment = {**os.environ, 'BAMBI_TTS_THREADS':str(args.threads), 'BAMBI_TTS_DYNAMIC_BLOCK':'0',
                   'HF_HUB_OFFLINE':'1', 'TRANSFORMERS_OFFLINE':'1'}
    with (ROOT / 'runtime/lifecycle.lock').open('a') as lease:
        fcntl.flock(lease, fcntl.LOCK_EX)
        for kind, python, script, flags in (
            ('kokoro', ROOT / '.runtime/tts-venv/bin/python', ROOT / 'scripts/tts-nano-benchmark.py', ['--worker','kokoro']),
            ('supertonic3', ROOT / '.runtime/tts-venv/bin/python', Path(__file__).resolve(), ['--worker', '--steps', *map(str, args.steps)]),
            ('listening', ROOT / '.runtime/chatterbox-nano/venv/bin/python', ROOT / 'scripts/tts-nano-benchmark.py', ['--worker','listening'])):
            idle()
            with (output / f'{kind}-worker.log').open('w') as log:
                subprocess.run([str(python), str(script), '--run', *flags, '--threads', str(args.threads), '--output', str(output)],
                               cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=420)
            if kind != 'listening':
                report['runs'].append(json.loads((output / f'{kind}.json').read_text()))
                common.write_json(output / 'report.json', report)
            print('Completed isolated worker:', kind, flush=True)
    report['status'] = 'complete'
    common.write_json(output / 'report.json', report)
    print('Public report and matched listening WAVs:', output, flush=True)


if __name__ == '__main__':
    main()
