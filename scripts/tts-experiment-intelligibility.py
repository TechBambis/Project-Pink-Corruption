# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit local Whisper smoke test of public TTS benchmark WAVs only."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]



def words(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower())


def word_errors(reference, hypothesis):
    expected, actual = words(reference), words(hypothesis)
    previous = list(range(len(actual)+1))
    for i, word in enumerate(expected, 1):
        current = [i]
        for j, heard in enumerate(actual, 1):
            current.append(min(current[-1]+1, previous[j]+1, previous[j-1]+(word != heard)))
        previous = current
    return previous[-1], len(expected)


def transcribe(path):
    wav = path.read_bytes()
    boundary = 'BambiPublicTTSFixture'
    fields = {'response_format':'json', 'language':'en', 'temperature':'0.0'}
    sections = [f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
                for key, value in fields.items()]
    sections.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="public-fixture.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()+wav+b'\r\n')
    body = b''.join(sections)+f'--{boundary}--\r\n'.encode()
    request = urllib.request.Request('http://127.0.0.1:8081/inference', data=body,
                                     headers={'Content-Type':f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    return result['text'], hashlib.sha256(wav).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--sweep-only', action='store_true')
    args = parser.parse_args()
    if not args.run:
        parser.error('Use --run to transcribe the public synthetic fixtures locally.')
    spec = importlib.util.spec_from_file_location('tts_trial', ROOT / 'scripts/tts-supertonic-benchmark.py')
    trial = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trial)
    nano = ROOT / 'runtime/tts-nano-comparison-2026-10-09'
    supertonic = ROOT / 'runtime/tts-supertonic3-comparison-2026-10-09'
    result = {'scope':'Local Whisper recognizer smoke test on public benchmark audio with identical Classic DSP and loudness matching. Word error rate also includes recognizer errors; no human listening preference, general accuracy benchmark or production alignment qualification.', 'status':'running', 'measurements':[]}
    if args.sweep_only:
        supertonic = ROOT / 'runtime/tts-supertonic3-quality-sweep-2026-10-09'
        runs = [(supertonic, run) for run in json.loads((supertonic / 'supertonic3.json').read_text())['runs']]
    else:
        runs = [(nano, json.loads((nano / 'nano.json').read_text())),
                (supertonic, json.loads((supertonic / 'kokoro.json').read_text()))]
        runs.extend((supertonic, run) for run in json.loads((supertonic / 'supertonic3.json').read_text())['runs'])
    destination = supertonic / 'intelligibility.json'
    with (ROOT / 'runtime/lifecycle.lock').open('a') as lease:
        fcntl.flock(lease, fcntl.LOCK_EX)
        trial.idle()
        for directory, run in runs:
            for measurement in run['measurements']:
                filename = measurement['rawFile'].replace('-raw.wav', '-listen.wav')
                if Path(filename).name != filename or not filename.endswith('-listen.wav'):
                    raise ValueError('Only public benchmark filenames are accepted')
                path = directory / filename
                if path.is_symlink():
                    raise ValueError('Refusing a symlinked audio fixture')
                trial.idle()
                begin = time.perf_counter()
                heard, digest = transcribe(path)
                errors, count = word_errors(measurement['text'], heard)
                result['measurements'].append({'engine':run['engine'], 'file':filename, 'sha256':digest,
                                               'expected':measurement['text'], 'transcript':heard, 'errors':errors,
                                               'referenceWords':count, 'wer':errors/count,
                                               'recognitionMs':(time.perf_counter()-begin)*1000})
                trial.common.write_json(destination, result)
            print('Completed local public-audio recognition:', run['engine'], flush=True)
    result['summary'] = []
    for _, run in runs:
        samples = [m for m in result['measurements'] if m['engine'] == run['engine']]
        errors = sum(m['errors'] for m in samples)
        count = sum(m['referenceWords'] for m in samples)
        result['summary'].append({'engine':run['engine'], 'samples':len(samples), 'errors':errors,
                                  'referenceWords':count, 'wer':errors/count})
    result['status'] = 'complete'
    trial.common.write_json(destination, result)
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
