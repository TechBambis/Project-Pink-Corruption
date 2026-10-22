# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Registered local references and a single explicitly selected CPU child."""
import atexit
import base64
from contextlib import closing
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time
import uuid

import numpy as np
from .config import ROOT, DATA, MODELS
from .moss_profile import PROFILE, digest
from .dsp import wav_bytes
from .spoken import spoken_input
from .timing import DEFAULT_PAUSES


def script_plan(text, timing=None):
    """Explicit script pauses are silence, never model conditioning text."""
    pauses = {**DEFAULT_PAUSES, **(timing or {})}
    text = re.sub(r'\[SFX:PAUSE_(5|10)\]', lambda m: '[pause:' + str(int(m[1]) * 1000) + ']', text, flags=re.I)
    text = re.sub(r'\[PAUSE\]', '[pause:10000]', text, flags=re.I)
    # This provider advertises no native vocal tags. Do not pronounce markers
    # as words or substitute another speaker's sound for the intended event.
    text = re.sub(r'<(?:laugh|sigh|breath|chuckle|giggle)>|\[(?:laugh|sigh|breath|chuckle|giggle)\]', ' ', text, flags=re.I)
    marker = re.compile(r'\[pause:(\d+|normal|short|medium|long|transition)\]', re.I)
    def remove_zero(match):
        value = match[1].lower()
        ms = int(value) if value.isdigit() else pauses[value]
        if type(ms) not in (int, float) or not 0 <= ms <= 10000:
            raise ValueError('Pause must be between 0 and 10000 ms')
        return ' ' if ms == 0 else match[0]
    text = marker.sub(remove_zero, text)
    parts, offset = [], 0
    for match in marker.finditer(text):
        value = match[1].lower()
        parts.append((spoken_input(text[offset:match.start()]), int(value) if value.isdigit() else pauses[value]))
        offset = match.end()
    parts.append((spoken_input(text[offset:]), 0))
    if any('[pause:' in part.lower() for part, _ in parts):
        raise ValueError('Invalid pause marker')
    if sum(ms for _, ms in parts) > 30000 or len(parts) > 32:
        raise ValueError('MOSS script exceeds its bounded pause budget')
    return parts


def validate_config(config):
    if config['speed'] != 1 or config['pitchSemitones'] != 0 or any(layer['enabled'] for layer in config['layers'].values()):
        raise ValueError('MOSS uses its reference at native pace/pitch; disable voice layers')
    if config['sampleRate'] != 48000 or config['processing']['enabled'] or config['drone']['enabled'] or config['noise']['enabled']:
        raise ValueError('MOSS raw audio uses 48 kHz without processing or background layers')


def reference_record(voice):
    if not isinstance(voice, str) or not re.fullmatch(r'moss_[a-z][a-z0-9_]{0,47}', voice):
        raise ValueError('Choose an installed MOSS reference; blending is unavailable')
    directory = MODELS / 'live-voice/moss-references'
    if directory.is_symlink() or not directory.resolve().is_relative_to(MODELS.resolve()):
        raise ValueError('MOSS registry escapes the configured model root')
    name = voice[5:]
    metadata, audio = directory / (name + '.json'), directory / (name + '.wav')
    if any(p.is_symlink() or not p.resolve().is_relative_to(directory.resolve()) for p in (metadata, audio)):
        raise ValueError('MOSS reference escapes its registry')
    if not metadata.is_file() or metadata.stat().st_size > 8192:
        raise ValueError('MOSS reference is not explicitly installed')
    record = json.loads(metadata.read_text())
    if (not isinstance(record, dict) or type(record.get('version')) is not int or record.get('version') != 1
            or record.get('id') != voice or record.get('file') != audio.name
            or record.get('profile') != PROFILE['profile'] or record.get('status') != 'experimental-opt-in'
            or record.get('referenceKind') not in ('synthetic', 'authorized')
            or type(record.get('bytes')) is not int or not 0 < record['bytes'] <= 12 * 1024**2
            or not re.fullmatch(r'[0-9a-f]{64}', record.get('sha256', ''))
            or not audio.is_file() or audio.stat().st_size != record['bytes'] or digest(audio) != record['sha256']):
        raise ValueError('MOSS reference metadata or audio changed; rerun explicit setup')
    return record, audio


def python_path():
    return DATA / '.runtime/live-voice/venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def voices():
    if not python_path().is_file():
        return []
    profile = MODELS / 'live-voice' / PROFILE['profile']
    if any(not (profile / a['file']).is_file() or (profile / a['file']).stat().st_size != a['bytes'] for a in PROFILE['graphs']):
        return []
    result = []
    for path in sorted((MODELS / 'live-voice/moss-references').glob('*.json')):
        try:
            voice = 'moss_' + path.stem
            reference_record(voice)
            result.append(voice)
        except (OSError, ValueError, TypeError, KeyError):
            pass
    return result


class MossVoices:
    def names(self):
        return voices()

    def style(self, voice):
        reference_record(voice)
        return voice


class MossWorker:
    """The parent always drains IPC, including cancelled future packets."""
    def __init__(self, voice, cancel=lambda: False):
        record, _ = reference_record(voice)
        self.voice, self.reference_sha256 = voice, record['sha256']
        self.messages = queue.Queue(maxsize=8)
        self.discard, self.closed = threading.Event(), threading.Event()
        self.slot = threading.Lock()
        directory = DATA / 'runtime'; directory.mkdir(parents=True, exist_ok=True)
        self.log = (directory / 'moss-worker.log').open('a')
        self.process = None
        try:
            self.process = subprocess.Popen([str(python_path()), '-m', 'packages.speech.local.moss_worker', '--voice', voice],
                cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, text=True, bufsize=1,
                env={**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'})
            self.reader = threading.Thread(target=self.read, name='moss-ipc', daemon=True)
            self.reader.start()
            self.ready = self.next(120, cancel)
            if (self.ready.get('type') != 'ready' or self.ready.get('referenceSha256') != self.reference_sha256
                    or self.ready.get('sampleRate') != 48000 or self.ready.get('channels') != 2):
                raise RuntimeError('MOSS child did not verify its reference/PCM format')
        except BaseException:
            self.close()
            raise

    def read(self):
        try:
            while True:
                line = self.process.stdout.readline(16 * 1024**2 + 1)
                if not line:
                    break
                if len(line) > 16 * 1024**2:
                    raise ValueError('MOSS IPC packet exceeded its bound')
                message = json.loads(line)
                if not isinstance(message, dict):
                    raise ValueError('MOSS IPC packet must be an object')
                while not self.closed.is_set():
                    if self.discard.is_set() and message.get('type') == 'frame':
                        break
                    try:
                        self.messages.put(message, timeout=.025)
                        break
                    except queue.Full:
                        pass
        except Exception:
            if not self.closed.is_set():
                self.discard.set()
        finally:
            while not self.closed.is_set():
                try:
                    self.messages.put({'type': 'closed'}, timeout=.025)
                    break
                except queue.Full:
                    pass

    def next(self, seconds, cancel=lambda: False):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if self.closed.is_set():
                raise RuntimeError('MOSS worker is closed')
            if cancel():
                raise InterruptedError('MOSS request cancelled')
            try:
                message = self.messages.get(timeout=.025)
                if message.get('type') == 'closed':
                    raise RuntimeError('MOSS worker exited')
                return message
            except queue.Empty:
                pass
        raise TimeoutError('MOSS IPC deadline expired')

    def send(self, message):
        self.process.stdin.write(json.dumps(message, separators=(',', ':')) + '\n')
        self.process.stdin.flush()

    def stream(self, text, seed=41, cancel=lambda: False):
        if not self.slot.acquire(blocking=False):
            raise RuntimeError('MOSS renderer is busy')
        identifier = uuid.uuid4().hex
        finished = False
        admitted = False
        self.discard.clear()
        try:
            if cancel():
                raise InterruptedError('MOSS request cancelled')
            self.send({'type': 'render', 'id': identifier, 'text': text, 'seed': seed})
            admitted = True
            offset, sequence = 0, 0
            until = time.monotonic() + 120
            while True:
                message = self.next(max(.001, until - time.monotonic()), cancel)
                if message.get('id') != identifier:
                    raise RuntimeError('MOSS returned stale or uncorrelated PCM')
                kind = message['type']
                if kind in ('end', 'cancelled', 'error'):
                    finished = True
                    if kind != 'end':
                        raise InterruptedError('MOSS synthesis cancelled') if kind == 'cancelled' else RuntimeError('MOSS synthesis failed')
                    if (type(message.get('samples')) is not int or type(message.get('frames')) is not int
                            or message.get('samples') != offset or message.get('frames') != sequence or not sequence):
                        self.close()
                        raise RuntimeError('MOSS output is incomplete')
                    return
                if (kind != 'frame' or type(message.get('seq')) is not int or type(message.get('offset')) is not int
                        or message.get('seq') != sequence or message.get('offset') != offset
                        or message.get('sampleRate') != 48000 or message.get('channels') != 2
                        or type(message.get('samples')) is not int or not 0 < message['samples'] <= 30 * 48000
                        or offset + message['samples'] > 30 * 48000):
                    raise RuntimeError('MOSS PCM dimensions/order changed')
                raw = base64.b64decode(message['pcm'], validate=True)
                if len(raw) != message['samples'] * 2 * 4:
                    raise RuntimeError('MOSS PCM byte count changed')
                pcm = np.frombuffer(raw, dtype='<f4').reshape(-1, 2)
                if not np.isfinite(pcm).all():
                    raise RuntimeError('MOSS returned non-finite PCM')
                offset += len(pcm); sequence += 1
                yield pcm
        finally:
            if admitted and not finished and not self.closed.is_set():
                self.discard.set()
                try:
                    self.send({'type': 'cancel', 'id': identifier})
                    until = time.monotonic() + 2
                    while True:
                        message = self.next(max(.001, until - time.monotonic()))
                        if message.get('id') != identifier:
                            raise RuntimeError('MOSS cancel returned a stale terminal')
                        if message['type'] in ('end', 'cancelled', 'error'):
                            break
                except Exception:
                    self.close()
            self.slot.release()

    def close(self):
        self.closed.set()
        process = self.process
        if process is not None:
            try:
                process.stdin.close()  # EOF cancels the exact child even on parent shutdown.
            except (OSError, ValueError):
                pass
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=2)
            if hasattr(self, 'reader'):
                self.reader.join(2)
            process.stdout.close()
        self.log.close()


class MossRenderer:
    """One persistent child; reference changes replace only that owned child."""
    def __init__(self):
        self.worker = None
        atexit.register(self.close)

    def close(self):
        if self.worker is not None:
            self.worker.close(); self.worker = None

    def chunks(self, text, voice, seed=41, cancel=lambda: False, timing=None):
        if (not isinstance(text, str) or not 1 <= len(text) <= 1000
                or type(seed) is not int or not 0 <= seed < 2**32):
            raise ValueError('MOSS requires 1–1000 characters and a bounded integer seed')
        if cancel():
            raise InterruptedError('MOSS request cancelled')
        plan = script_plan(text, timing)
        if any(ms for _, ms in plan):
            # Authored silent gaps retain complete-unit timing and history.
            # Plain replies still use native PCM without waiting for completion.
            audio, display, samples = [], [], 0
            for part, ms in plan:
                if cancel():
                    raise InterruptedError('MOSS request cancelled')
                if part:
                    display.append(part)
                    with closing(self._chunks(part, voice, seed, cancel)) as stream:
                        for chunk in stream:
                            samples += len(chunk['samples'])
                            if samples + round(ms * 48) > 48000 * 30:
                                raise ValueError('MOSS script exceeds its 30-second audio bound')
                            audio.append(chunk['samples'])
                if ms:
                    silence = np.zeros((round(ms * 48), 2), dtype=np.float32)
                    samples += len(silence)
                    if samples > 48000 * 30:
                        raise ValueError('MOSS script exceeds its 30-second audio bound')
                    audio.append(silence)
            yield {'samples': np.concatenate(audio), 'text': ' '.join(display), 'final': True, 'whole': True}
            return
        text = plan[0][0]
        if not text.strip():
            raise ValueError('No spoken MOSS text')
        yield from self._chunks(text, voice, seed, cancel)

    def _chunks(self, text, voice, seed, cancel):
        record, _ = reference_record(voice)
        if (self.worker is None or self.worker.closed.is_set() or self.worker.process.poll() is not None or self.worker.voice != voice
                or self.worker.reference_sha256 != record['sha256']):
            self.close(); self.worker = MossWorker(voice, cancel)
        stream = self.worker.stream(text, seed, cancel)
        pending = None
        sequence, offset = 0, 0
        try:
            for pcm in stream:
                if pending is not None:
                    yield {'samples': pending, 'text': '', 'final': False, 'index': sequence, 'offset': offset}
                    sequence += 1; offset += len(pending)
                pending = pcm
            if pending is None:
                raise RuntimeError('MOSS produced no audio')
            yield {'samples': pending, 'text': text, 'final': True, 'index': sequence, 'offset': offset}
        finally:
            stream.close()

    def render(self, text, config, cancel=lambda: False, seed=41):
        validate_config(config)
        started = time.perf_counter()
        pcm = np.concatenate([c['samples'] for c in self.chunks(text, config['voice'], seed, cancel, config['timing'])])
        duration = len(pcm) / 48000
        return wav_bytes(pcm, 48000), {'durationSeconds': duration, 'renderSeconds': time.perf_counter() - started,
                                     'peak': float(np.max(np.abs(pcm))), 'provider': 'moss'}
