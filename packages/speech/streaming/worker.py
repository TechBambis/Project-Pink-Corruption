# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Resident CPU recognition, private pipes only. Provisional words never enter storage."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import os
import numpy as np
import sherpa_onnx

def emit(message):
    print(json.dumps(message), flush=True)

def load():
    root = Path(os.environ.get('BAMBI_RESOURCE_ROOT', Path(__file__).resolve().parents[3]))
    manifest = json.loads((root / 'config/streaming-speech-model.json').read_text(encoding='utf-8'))
    files = {}
    for asset in manifest['files']:
        path = (Path(os.environ['BAMBI_MODELS_ROOT']) / 'streaming' if os.environ.get('BAMBI_MODELS_ROOT') else root / '.runtime/streaming-speech/model') / asset['path']
        if path.stat().st_size != asset['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
            raise ValueError('Streaming speech asset checksum mismatch')
        files[asset['role']] = str(path)
    return sherpa_onnx.OnlineRecognizer.from_transducer(**files, num_threads=2, sample_rate=16000,
             feature_dim=80, decoding_method='greedy_search', provider='cpu', enable_endpoint_detection=False)

def run(recognizer):
    stream = None
    current = None
    samples_seen = 0
    previous = ''
    emit({'type': 'ready'})
    while line := sys.stdin.buffer.readline(100000):
        if len(line) >= 100000:
            raise ValueError('Streaming command exceeds its limit')
        command = json.loads(line)
        kind = command.get('type')
        if kind == 'reset':
            stream = None
            current = None
            continue
        if kind == 'start':
            if stream is not None:
                raise ValueError('An utterance is already active')
            current = command['id']
            stream = recognizer.create_stream()
            samples_seen = 0
            previous = ''
            continue
        if stream is None or command.get('id') != current:
            raise ValueError('No matching active utterance')
        if kind == 'audio':
            pcm = base64.b64decode(command['pcm'], validate=True)
            if not pcm or len(pcm) % 4 or len(pcm) > 16384:
                raise ValueError('Invalid PCM frame')
            samples = np.frombuffer(pcm, dtype='<f4')
            if not np.isfinite(samples).all() or np.abs(samples).max() > 1.01:
                raise ValueError('Invalid PCM samples')
            samples_seen += len(samples)
            if samples_seen > 16000 * 27:
                raise ValueError('Utterance exceeds its limit')
            stream.accept_waveform(16000, samples)
        elif kind == 'finish':
            # Flush the model's right context without waiting for additional microphone silence.
            stream.accept_waveform(16000, np.zeros(4800, dtype=np.float32))
            stream.input_finished()
        else:
            raise ValueError('Unknown streaming command')
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        text = recognizer.get_result(stream).strip()
        if kind == 'finish':
            emit({'type':'final','id':current,'text':text})
            stream = None
            current = None
        else:
            if text != previous:
                emit({'type':'partial','id':current,'text':text})
                previous = text
            emit({'type':'ack','id':current,'bytes':len(pcm)})

if __name__ == '__main__':
    try:
        run(load())
    except Exception:
        emit({'type':'error','message':'Local streaming speech failed. Retry the microphone or use Whisper.'})
        sys.exit(1)
