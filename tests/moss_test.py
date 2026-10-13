"""MOSS handoff/cancellation contracts; no model downloads or device output."""
import sys
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import wave
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from packages.speech.local.moss import MossProvider, verify_profile
from packages.speech.local import moss
spec = importlib.util.spec_from_file_location('moss_setup_tests', ROOT / 'scripts/setup-live-voice.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class Codec:
    def __init__(self):
        self.resets = 0
        self.value = .125

    def reset(self):
        self.resets += 1

    def run_frames(self, frames):
        return np.full((1, 2, 4), self.value, dtype=np.float32), 4


class Runtime:
    def __init__(self):
        self.codec_streaming_session = Codec()
        self.generated = 0
        self.fail = False
        self.bound = False

    def encode_text(self, text):
        return text

    def build_voice_clone_request_rows(self, reference, text):
        self.codec_streaming_session.value = .75 if text == 'Next job.' else .125
        return text

    def generate_audio_frames(self, rows, on_frame):
        for i in range(8):
            self.generated += 1
            on_frame([], i, [i])
            if self.fail:
                raise ValueError('Native failure')
        return list(range(375 if self.bound else 8))


def fixture():
    # Exercise the real stream owner with a deterministic native runtime stand-in.
    provider = object.__new__(MossProvider)
    provider.model = Runtime()
    provider.reference = []
    provider._np = np
    provider._budget = lambda *_: 1
    provider._slot = threading.Lock()
    provider._poisoned = False
    return provider


class MossStreamTests(unittest.TestCase):
    def test_cancel_before_first_pcm_and_next_job_recovers(self):
        provider = fixture()
        with self.assertRaises(InterruptedError):
            list(provider.stream('Hello.', cancel=lambda: True))
        self.assertEqual(provider.model.generated, 0)
        frames = list(provider.stream('Next job.'))
        self.assertEqual(len(frames), 8)
        self.assertTrue(all(np.all(frame == .75) for frame in frames))

    def test_close_discards_buffered_future_pcm_and_releases_slot_after_reset(self):
        provider = fixture()
        stream = provider.stream('Old job.')
        first = next(stream)
        self.assertTrue(np.all(first == .125))
        # The consumer stops while a producer may be blocked on its bounded queue.
        stream.close()
        resets_after_close = provider.model.codec_streaming_session.resets
        self.assertGreaterEqual(resets_after_close, 2)
        frames = list(provider.stream('Next job.'))
        self.assertEqual(len(frames), 8)
        self.assertTrue(all(np.all(frame == .75) for frame in frames))
        self.assertGreater(provider.model.codec_streaming_session.resets, resets_after_close)

    def test_second_stream_cannot_replace_an_active_job(self):
        provider = fixture()
        stream = provider.stream('Old job.')
        next(stream)
        with self.assertRaisesRegex(RuntimeError, 'busy'):
            next(provider.stream('Next job.'))
        stream.close()
        self.assertEqual(len(list(provider.stream('Next job.'))), 8)

    def test_native_failure_is_not_success_and_state_recovers(self):
        provider = fixture()
        provider.model.fail = True
        with self.assertRaisesRegex(ValueError, 'Native failure'):
            list(provider.stream('Hello.'))
        provider.model.fail = False
        self.assertEqual(len(list(provider.stream('Next job.'))), 8)

    def test_failed_codec_reset_requires_a_new_worker(self):
        provider = fixture()
        with patch.object(provider.model.codec_streaming_session, 'reset', side_effect=RuntimeError('reset failed')):
            with self.assertRaisesRegex(RuntimeError, 'restart'):
                list(provider.stream('Hello.'))
        self.assertTrue(provider._poisoned)
        with self.assertRaisesRegex(RuntimeError, 'restart'):
            list(provider.stream('Next job.'))

    def test_deadline_releases_a_producer_blocked_behind_slow_consumer(self):
        provider = fixture()
        stream = provider.stream('Hello.', deadline=time.monotonic() + .03)
        next(stream)
        time.sleep(.04)
        with self.assertRaises(InterruptedError):
            next(stream)
        self.assertFalse(provider._poisoned)
        self.assertEqual(len(list(provider.stream('Next job.'))), 8)

    def test_generation_bound_never_claims_completed_output(self):
        provider = fixture()
        provider.model.bound = True
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            list(provider.stream('Hello.'))

    def test_deadlines_and_seeds_are_bounded_before_admission(self):
        provider = fixture()
        for deadline in [float('nan'), float('inf'), True, time.monotonic() + 1000]:
            with self.subTest(deadline=deadline), self.assertRaises(ValueError):
                list(provider.stream('Hello.', deadline=deadline))
        for seed in [True, -1, 2**32, '41']:
            with self.subTest(seed=seed), self.assertRaises(ValueError):
                list(provider.stream('Hello.', seed=seed))
        with self.assertRaises(InterruptedError):
            list(provider.stream('Hello.', deadline=time.monotonic() - 1))
        self.assertEqual(len(list(provider.stream('Next job.'))), 8)

    def test_corrupt_pcm_is_rejected_without_poisoning_next_request(self):
        provider = fixture()
        with patch.object(provider.model.codec_streaming_session, 'run_frames', return_value=(np.full((1, 2, 4), np.nan), 4)):
            with self.assertRaisesRegex(ValueError, 'Invalid bounded'):
                list(provider.stream('Hello.'))
        self.assertEqual(len(list(provider.stream('Next job.'))), 8)

    def test_missing_profile_fails_without_network_or_model_import(self):
        with self.assertRaises(ValueError):
            verify_profile(ROOT / 'runtime/does-not-exist-moss-profile')

    def test_incomplete_profile_cannot_silently_use_float_graphs(self):
        with patch.dict(moss.PROFILE, {'graphs': []}), self.assertRaisesRegex(ValueError, 'Incomplete'):
            verify_profile(ROOT)


class MossSetupTests(unittest.TestCase):
    def test_invalid_local_cli_inputs_do_not_start_downloads(self):
        with patch.object(sys, 'argv', ['setup-live-voice.py', '--run', '--provider', 'moss',
                                       '--moss-int8-from', 'runtime/does-not-exist',
                                       '--reference', 'runtime/missing.wav', '--reference-kind', 'authorized']), \
                patch.object(setup, 'install') as install:
            with self.assertRaises(ValueError):
                setup.main()
            install.assert_not_called()

    def inputs(self, root, silent=False):
        source = root / 'source'; source.mkdir()
        graphs = []
        for graph in moss.PROFILE['graphs']:
            content = graph['file'].encode()
            (source / graph['file']).write_bytes(content)
            graphs.append({'file': graph['file'], 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        reference = root / 'reference.wav'
        with wave.open(str(reference), 'wb') as stream:
            stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(24000)
            stream.writeframes(np.full(2400, 0 if silent else 2000, dtype='<i2').tobytes())
        return source, reference, graphs

    def test_validation_only_never_installs_and_valid_import_has_no_partials(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); source, reference, graphs = self.inputs(root)
            with patch.object(setup, 'ROOT', root), patch.dict(moss.PROFILE, {'graphs': graphs}):
                setup.install_moss_profile(source, reference, 'test', 'synthetic')
                self.assertFalse((root / 'models').exists())
                record = setup.install_moss_profile(source, reference, 'test', 'synthetic', True)
                self.assertEqual(record['id'], 'moss_test')
                self.assertEqual((root / 'models/live-voice/moss-references/test.wav').read_bytes(), reference.read_bytes())
                self.assertTrue((root / 'models/live-voice/moss-references/test.json').is_file())
                self.assertEqual(list(root.rglob('*.part')), [])

    def test_bad_graph_and_silent_reference_fail_before_activation(self):
        for silent, corrupt in [(False, True), (True, False)]:
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder); source, reference, graphs = self.inputs(root, silent)
                if corrupt:
                    (source / graphs[0]['file']).write_bytes(b'wrong')
                with patch.object(setup, 'ROOT', root), patch.dict(moss.PROFILE, {'graphs': graphs}):
                    with self.assertRaises(ValueError):
                        setup.install_moss_profile(source, reference, 'test', 'authorized', True)
                self.assertFalse((root / 'models').exists())

    def test_reference_record_cannot_escape_model_root(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); source, reference, graphs = self.inputs(root)
            with patch.object(setup, 'ROOT', root), patch.dict(moss.PROFILE, {'graphs': graphs}):
                for name in ['../outside', '/outside', 'MixedCase', 'test\\outside']:
                    with self.subTest(name=name), self.assertRaises(ValueError):
                        setup.install_moss_profile(source, reference, name, 'authorized', True)
            self.assertFalse((root / 'models').exists())


if __name__ == '__main__':
    unittest.main()
