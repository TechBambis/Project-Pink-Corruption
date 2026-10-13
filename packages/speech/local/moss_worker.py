# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Private offline CPU child. IPC EOF cancels its active native stream."""
import argparse
import base64
import contextlib
import json
import queue
import socket
import sys
import threading


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--voice', required=True)
    args = parser.parse_args()
    def denied(*a, **k):
        raise RuntimeError('MOSS inference is offline')
    socket.socket.connect = denied; socket.create_connection = denied
    socket.socket.connect_ex = denied
    from .moss_service import reference_record, MODELS
    from .moss import MossProvider
    record, reference = reference_record(args.voice)
    with contextlib.redirect_stdout(sys.stderr):
        provider = MossProvider(reference, derived_directory=MODELS / 'live-voice/moss-int8-alias-v2', threads=3)
    output_lock, state_lock = threading.Lock(), threading.Lock()
    protocol_output = sys.stdout
    pending, closing = queue.Queue(maxsize=1), threading.Event()
    active = None

    def send(message):
        with output_lock:
            print(json.dumps(message, separators=(',', ':')), file=protocol_output, flush=True)

    def read():
        nonlocal active
        try:
            while True:
                line = sys.stdin.readline(16385)
                if not line:
                    break
                if len(line) > 16384:
                    break
                request = json.loads(line)
                if not isinstance(request, dict):
                    break
                with state_lock:
                    if request.get('type') == 'cancel':
                        if active is not None and request.get('id') == active['id']:
                            active['cancel'].set()
                        continue
                    if (request.get('type') != 'render' or not isinstance(request.get('id'), str)
                            or not 1 <= len(request['id']) <= 80 or not isinstance(request.get('text'), str)
                            or not 1 <= len(request['text']) <= 1000 or type(request.get('seed')) is not int
                            or not 0 <= request['seed'] < 2**32 or active is not None):
                        raise ValueError('Invalid or busy private MOSS request')
                    active = request | {'cancel': threading.Event()}
                    pending.put_nowait(active)
        except Exception:
            pass
        finally:
            closing.set()
            with state_lock:
                if active is not None:
                    active['cancel'].set()
            try:
                pending.put_nowait(None)
            except queue.Full:
                pass

    send({'type': 'ready', 'provider': 'moss', 'sampleRate': 48000, 'channels': 2,
          'referenceSha256': provider.reference_sha256, 'conditioningId': provider.conditioning_id,
          'wordTimings': False, 'nativeVocalTags': False})
    reader = threading.Thread(target=read, name='moss-supervisor', daemon=True); reader.start()
    while not closing.is_set():
        job = pending.get()
        if job is None:
            break
        sequence, offset, outcome = 0, 0, 'end'
        try:
            with contextlib.redirect_stdout(sys.stderr):
                for pcm in provider.stream(job['text'], seed=job['seed'], cancel=job['cancel'].is_set):
                    if job['cancel'].is_set():
                        raise InterruptedError()
                    send({'type': 'frame', 'id': job['id'], 'seq': sequence, 'offset': offset,
                          'sampleRate': 48000, 'channels': 2, 'samples': len(pcm),
                          'pcm': base64.b64encode(pcm.astype('<f4', copy=False).tobytes()).decode()})
                    sequence += 1; offset += len(pcm)
        except InterruptedError:
            outcome = 'cancelled'
        except Exception:
            outcome = 'error'
        finally:
            with state_lock:
                if job['cancel'].is_set():
                    outcome = 'cancelled'
                active = None
            send({'type': outcome, 'id': job['id'], 'frames': sequence, 'samples': offset})
        if provider._poisoned:
            break


if __name__ == '__main__':
    main()
