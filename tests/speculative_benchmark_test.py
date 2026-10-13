# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Offline benchmark contracts: no model downloads or inference."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('speculative_benchmark', ROOT / 'scripts/speculative-benchmark.py')
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def stream(*events):
    return io.BytesIO(b''.join(b'data: ' + json.dumps(event).encode() + b'\n\n' for event in events))


class BenchmarkContracts(unittest.TestCase):
    def test_mtp_uses_embedded_heads_without_a_separate_drafter(self):
        self.assertEqual(bench.mode_options('mtp', Path('/unused'), 2),
                         ('f16', ['--spec-type', 'draft-mtp', '--spec-draft-n-max', '2']))
        config, target = bench.experiment_config('4b-mtp')
        self.assertEqual(target['bytes'], 2788710496)
        self.assertEqual(target['alias'], config['targetAlias'])
        self.assertEqual(len(target['sha256']), 64)

    def test_combined_q8_dflash_uses_both_without_changing_baseline_cache(self):
        cache, arguments = bench.mode_options('dflash-q8', Path('/verified/draft.gguf'), 3)
        self.assertEqual(cache, 'q8_0')
        self.assertEqual(arguments, ['--spec-type', 'draft-dflash', '--spec-draft-model', '/verified/draft.gguf', '--spec-draft-n-max', '3'])
        self.assertEqual(bench.mode_options('kv-q8', Path('/unused'), 3), ('q8_0', []))
        self.assertEqual(bench.mode_options('baseline', Path('/unused'), 3), ('f16', []))
        with self.assertRaises(ValueError):
            bench.mode_options('unreviewed', Path('/unused'), 3)

    def test_4b_profile_is_pinned_and_does_not_require_an_app_catalog_entry(self):
        catalog = (ROOT / 'config/local-model-catalog.json').read_bytes()
        config, target = bench.experiment_config('4b')
        self.assertEqual(config['context'], 24576)
        self.assertEqual(config['promptCacheMiB'], 2048)
        self.assertEqual(target['alias'], config['targetAlias'])
        self.assertEqual(target['bytes'], 2707513696)
        self.assertEqual(config['draft']['bytes'], 454200928)
        self.assertEqual((ROOT / 'config/local-model-catalog.json').read_bytes(), catalog)
        with self.assertRaises(ValueError):
            bench.experiment_config('../unreviewed')

    def test_complete_stream_keeps_text_and_real_server_timings(self):
        body = stream({'content': 'A complete '}, {'content': 'sentence.', 'stop': True,
                      'tokens_predicted': 4, 'timings': {'predicted_per_second': 12.5}, 'truncated': False})
        with patch.object(bench.urllib.request, 'urlopen', return_value=body):
            result = bench.completion('http://127.0.0.1:1', {'prompt': 'public fixture'})
        self.assertEqual(result['text'], 'A complete sentence.')
        self.assertEqual(result['tokensPredicted'], 4)
        self.assertEqual(result['timings']['predicted_per_second'], 12.5)
        self.assertIsNotNone(result['firstSentenceMs'])
        self.assertTrue(body.closed)

    def test_broken_stream_is_not_counted_as_a_successful_benchmark(self):
        body = stream({'content': 'An unfinished answer'})
        with patch.object(bench.urllib.request, 'urlopen', return_value=body):
            with self.assertRaisesRegex(RuntimeError, 'without a confirmed final'):
                bench.completion('http://127.0.0.1:1', {'prompt': 'public fixture'})
        self.assertTrue(body.closed)

    def test_invalid_asset_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'model.gguf'
            path.write_bytes(b'not the pinned model')
            with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                bench.verified(path, {'bytes': path.stat().st_size, 'sha256': '0' * 64})

    def test_exception_cleans_owned_child_and_leaves_other_process_alive(self):
        other = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        try:
            with tempfile.TemporaryDirectory() as folder:
                worker = bench.Worker([sys.executable, '-c', 'import time; time.sleep(30)'], dict(bench.os.environ), Path(folder))
                with self.assertRaisesRegex(RuntimeError, 'test failure'):
                    with worker:
                        raise RuntimeError('test failure')
                self.assertIsNotNone(worker.process.poll())
                self.assertTrue(worker.log.closed)
                self.assertIsNone(other.poll())
        finally:
            other.terminate()
            other.wait(timeout=5)

    def test_busy_owned_application_is_never_suspended(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'runtime').mkdir()
            with patch.object(bench, 'ROOT', root), patch.object(bench, 'listening_pids', return_value=[42]), \
                 patch.object(bench, 'registry', return_value=[]), \
                 patch.object(bench, 'recover_llama', return_value={'pid': 42, 'runtimeProfile': bench.RUNTIME_PROFILE}), \
                 patch.object(bench, 'request', return_value=[{'is_processing': True}]), \
                 patch.object(bench, 'stop_llama') as stop:
                with self.assertRaisesRegex(RuntimeError, 'busy'):
                    with bench.suspend_idle_runner(True, root / 'runtime'):
                        self.fail('Busy runner was accepted.')
                stop.assert_not_called()

    def test_experiment_holds_native_lifecycle_lease_until_worker_finishes(self):
        import fcntl
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'runtime').mkdir()
            with patch.object(bench, 'ROOT', root), patch.object(bench, 'listening_pids', return_value=[]):
                with bench.suspend_idle_runner(True, root / 'runtime'):
                    with (root / 'runtime/lifecycle.lock').open('a') as second:
                        with self.assertRaises(BlockingIOError):
                            fcntl.flock(second, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with (root / 'runtime/lifecycle.lock').open('a') as second:
                    fcntl.flock(second, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_idle_application_is_restored_even_when_experiment_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'runtime').mkdir()
            entry = {'pid': 42, 'starttime': '10', 'runtimeProfile': bench.RUNTIME_PROFILE, 'model': 'original', 'context': 24576}
            (root / 'runtime/owned-processes.json').write_text(json.dumps({'llama': {**entry, 'requested': 'cpu'}}))
            (root / 'runtime/report.json').write_text('{}')
            with patch.object(bench, 'ROOT', root), patch.object(bench, 'listening_pids', return_value=[42]), \
                 patch.object(bench, 'registry', return_value=[]), patch.object(bench, 'recover_llama', return_value=entry), \
                 patch.object(bench, 'request', return_value=[{'is_processing': False}]), \
                 patch.object(bench, 'stop_llama') as stop, \
                 patch.object(bench.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as restore:
                with self.assertRaisesRegex(RuntimeError, 'benchmark failed'):
                    with bench.suspend_idle_runner(True, root / 'runtime'):
                        raise RuntimeError('benchmark failed')
                stop.assert_called_once()
                command = restore.call_args.args[0]
                self.assertEqual(command[-4:], ['--model', 'original', '--context', '24576'])
                self.assertEqual(restore.call_args.kwargs['env']['BAMBI_ACCELERATOR'], 'cpu')
                self.assertTrue(json.loads((root / 'runtime/report.json').read_text())['applicationRunner']['restored'])

    def test_registry_write_failure_after_stop_still_restores_original_model(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'runtime').mkdir()
            entry = {'pid': 42, 'starttime': '10', 'runtimeProfile': bench.RUNTIME_PROFILE, 'model': 'original', 'context': 24576}
            (root / 'runtime/owned-processes.json').write_text(json.dumps({'llama': entry}))
            with patch.object(bench, 'ROOT', root), patch.object(bench, 'listening_pids', return_value=[42]), \
                 patch.object(bench, 'registry', return_value=[]), patch.object(bench, 'recover_llama', return_value=entry), \
                 patch.object(bench, 'request', return_value=[{'is_processing': False}]), \
                 patch.object(bench, 'stop_llama') as stop, patch.object(bench, 'save_state', side_effect=OSError('registry write failed')), \
                 patch.object(bench.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as restore:
                with self.assertRaisesRegex(OSError, 'registry write failed'):
                    with bench.suspend_idle_runner(True, root / 'runtime'):
                        self.fail('Broken registry was accepted.')
                stop.assert_called_once()
                restore.assert_called_once()
                self.assertEqual(restore.call_args.args[0][-4:], ['--model', 'original', '--context', '24576'])


if __name__ == '__main__':
    unittest.main()
