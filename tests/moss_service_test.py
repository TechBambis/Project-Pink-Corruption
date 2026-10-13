# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""IPC ordering, interrupted references and completed-utterance ownership."""
import base64
import hashlib
import json
from pathlib import Path
import queue
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from packages.speech.local import moss_service as service


def worker():
    result = object.__new__(service.MossWorker)
    result.slot = threading.Lock()
    result.closed, result.discard = threading.Event(), threading.Event()
    result.messages = queue.Queue()
    result.sent = []
    result.send = result.sent.append
    result.close = lambda: result.closed.set()
    return result


def frame(identifier='job', **changes):
    return {'type': 'frame', 'id': identifier, 'seq': 0, 'offset': 0,
            'sampleRate': 48000, 'channels': 2, 'samples': 4,
            'pcm': base64.b64encode(np.full((4, 2), .25, dtype='<f4').tobytes()).decode(), **changes}


class IpcTests(unittest.TestCase):
    def test_cancel_before_admission_sends_nothing_and_keeps_worker_reusable(self):
        child = worker()
        with self.assertRaises(InterruptedError):
            list(child.stream('Hello.', cancel=lambda: True))
        self.assertEqual(child.sent, [])
        self.assertFalse(child.closed.is_set())
        self.assertFalse(child.slot.locked())

    def test_verified_frames_and_terminal_counts(self):
        child = worker()
        child.messages.put(frame())
        child.messages.put({'type': 'end', 'id': 'job', 'samples': 4, 'frames': 1})
        with patch.object(service.uuid, 'uuid4', return_value=SimpleNamespace(hex='job')):
            frames = list(child.stream('Hello.'))
        self.assertEqual(len(frames), 1)
        self.assertTrue(np.all(frames[0] == .25))
        self.assertFalse(child.slot.locked())

    def test_stale_corrupt_and_unordered_packets_cancel_before_reuse(self):
        for packet in (frame(identifier='old'), frame(seq=True), frame(offset=1),
                       frame(pcm='?'), frame(pcm=base64.b64encode(np.full((4, 2), np.nan, dtype='<f4').tobytes()).decode())):
            with self.subTest(packet=packet):
                child = worker()
                child.messages.put(packet)
                child.messages.put({'type': 'cancelled', 'id': 'job'})
                with patch.object(service.uuid, 'uuid4', return_value=SimpleNamespace(hex='job')):
                    with self.assertRaises((RuntimeError, ValueError)):
                        list(child.stream('Hello.'))
                self.assertEqual(child.sent[-1], {'type': 'cancel', 'id': 'job'})
                self.assertFalse(child.slot.locked())
                self.assertFalse(child.closed.is_set())

    def test_closing_consumer_discards_future_pcm_then_recovers(self):
        child = worker()
        child.messages.put(frame())
        child.messages.put(frame(seq=1, offset=4))
        child.messages.put({'type': 'cancelled', 'id': 'job'})
        with patch.object(service.uuid, 'uuid4', return_value=SimpleNamespace(hex='job')):
            stream = child.stream('Old job.')
            next(stream)
            stream.close()
            self.assertTrue(child.discard.is_set())
            self.assertTrue(child.messages.empty())
            child.messages.put(frame())
            child.messages.put({'type': 'end', 'id': 'job', 'samples': 4, 'frames': 1})
            self.assertEqual(len(list(child.stream('Next job.'))), 1)
            self.assertFalse(child.discard.is_set())

    def test_incomplete_terminal_never_completes_utterance(self):
        child = worker()
        child.messages.put(frame())
        child.messages.put({'type': 'end', 'id': 'job', 'samples': 5, 'frames': 1})
        with patch.object(service.uuid, 'uuid4', return_value=SimpleNamespace(hex='job')):
            with self.assertRaisesRegex(RuntimeError, 'incomplete'):
                list(child.stream('Hello.'))


class RendererTests(unittest.TestCase):
    def test_unsupported_native_vocal_tags_never_become_spoken_words(self):
        self.assertEqual(service.script_plan('Hello. <laugh> [sigh] Ready.'), [('Hello. Ready.', 0)])

    def test_explicit_pauses_are_exact_silence_and_never_reach_native_text(self):
        renderer = object.__new__(service.MossRenderer)
        texts = []
        def native(text, *args):
            texts.append(text)
            yield {'samples': np.full((4, 2), .25), 'text': text, 'final': True}
        renderer._chunks = native
        chunks = list(renderer.chunks('Hello. [pause:100] Ready. [pause:short]', 'moss_test', timing={'short': 200}))
        self.assertEqual(texts, ['Hello.', 'Ready.'])
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0]['text'], 'Hello. Ready.')
        self.assertTrue(chunks[0]['whole'])
        pcm = chunks[0]['samples']
        self.assertEqual(len(pcm), 8 + 4800 + 9600)
        self.assertTrue(np.all(pcm[4:4804] == 0))
        self.assertTrue(np.all(pcm[4808:] == 0))

    def test_zero_pause_keeps_one_stream_and_invalid_pauses_never_render(self):
        renderer = object.__new__(service.MossRenderer)
        texts = []
        def native(text, *args):
            texts.append(text)
            yield {'samples': np.ones((4, 2)), 'text': text, 'final': True}
        renderer._chunks = native
        chunks = list(renderer.chunks('Hello. [pause:0] Ready.', 'moss_test'))
        self.assertEqual(texts, ['Hello. Ready.'])
        self.assertNotIn('whole', chunks[0])
        for text in ('Hello. [pause:-1]', 'Hello. [pause:unknown]', '[pause:10001]', '[pause:10000]' * 4):
            with self.subTest(text=text), self.assertRaises(ValueError):
                list(renderer.chunks(text, 'moss_test'))
        self.assertEqual(len(texts), 1)

    def renderer(self, native):
        renderer = object.__new__(service.MossRenderer)
        renderer.worker = SimpleNamespace(closed=threading.Event(), process=SimpleNamespace(poll=lambda: None),
                                         voice='moss_test', reference_sha256='hash', stream=lambda *args: native)
        return renderer

    def test_only_verified_last_packet_can_credit_full_text(self):
        first, last = np.ones((4, 2)), np.ones((8, 2))
        renderer = self.renderer(iter((first, last)))
        # Real worker streams are generators, whose close releases their owner.
        renderer.worker.stream = lambda *args: (pcm for pcm in (first, last))
        with patch.object(service, 'reference_record', return_value=({'sha256': 'hash'}, None)):
            chunks = list(renderer.chunks('Hello.', 'moss_test'))
        self.assertEqual([(c['text'], c['final']) for c in chunks], [('', False), ('Hello.', True)])
        self.assertIs(chunks[-1]['samples'], last)

    def test_native_error_never_emits_held_tail_as_complete(self):
        def native():
            yield np.ones((4, 2))
            raise RuntimeError('Native failure')
        renderer = self.renderer(native())
        with patch.object(service, 'reference_record', return_value=({'sha256': 'hash'}, None)):
            with self.assertRaisesRegex(RuntimeError, 'Native failure'):
                next(renderer.chunks('Hello.', 'moss_test'))

    def test_early_consumer_close_closes_native_stream(self):
        stopped = []
        def native():
            try:
                yield np.ones((4, 2))
                yield np.ones((4, 2))
            finally:
                stopped.append(True)
        renderer = self.renderer(native())
        with patch.object(service, 'reference_record', return_value=({'sha256': 'hash'}, None)):
            chunks = renderer.chunks('Hello.', 'moss_test')
            next(chunks); chunks.close()
        self.assertEqual(stopped, [True])


class RegistryTests(unittest.TestCase):
    def test_valid_reference_changed_bytes_and_malformed_metadata(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(service, 'MODELS', Path(temporary)):
            directory = Path(temporary) / 'live-voice/moss-references'
            directory.mkdir(parents=True)
            audio = directory / 'test.wav'; audio.write_bytes(b'local reference')
            descriptor = directory / 'test.json'
            record = {'version': 1, 'id': 'moss_test', 'file': audio.name, 'profile': service.PROFILE['profile'],
                      'status': 'experimental-opt-in', 'referenceKind': 'synthetic', 'bytes': audio.stat().st_size,
                      'sha256': hashlib.sha256(audio.read_bytes()).hexdigest()}
            descriptor.write_text(json.dumps(record))
            self.assertEqual(service.reference_record('moss_test')[1], audio)
            audio.write_bytes(b'wrong reference')
            with self.assertRaises(ValueError):
                service.reference_record('moss_test')
            descriptor.write_text('[]')
            with self.assertRaises(ValueError):
                service.reference_record('moss_test')
            with self.assertRaises(ValueError):
                service.reference_record('moss_../outside')


if __name__ == '__main__':
    unittest.main()
