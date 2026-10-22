# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Ownership tests never use production weights, GPU processes or port 8080."""
import importlib.util
import io
import json
import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import runtime_process as ownership
from accelerator_bridge import runtime_policy


class NativeRuntimeTests(unittest.TestCase):
    def test_9b_mtp_profiles_are_explicit_and_keep_baseline_decoding_separate(self):
        root = Path(__file__).resolve().parents[1]
        pins = json.loads((root / 'docs/comparison-models.json').read_text())
        for alias in ['bambi-qwen35-9b-dark-roast-mtp-on:iq4_xs', 'bambi-qwen35-9b-defiant-fable-mtp-on:iq3_m']:
            pin = next(pin for pin in pins if pin['alias'] == alias)
            self.assertEqual(ownership.speculative_options(pin), ['--spec-type', 'draft-mtp', '--spec-draft-n-max', '3'])
            self.assertEqual(ownership.model_contexts(pin), [16384, 24576])
            baseline = {**pin, 'runtime': {'cache_type': 'f16'}}
            self.assertEqual(ownership.speculative_options(baseline), [])
            with self.assertRaisesRegex(RuntimeError, 'Unsupported pinned speculative'):
                ownership.speculative_options({**pin, 'alias': 'unreviewed-model'})

    def test_anubis_context_cache_policy_and_registry(self):
        root = Path(__file__).resolve().parents[1]
        pin = json.loads((root / 'docs/anubis-model.json').read_text())
        self.assertEqual(ownership.context_cache_type(pin, 32768), 'q8_0')
        self.assertEqual(ownership.context_cache_type(pin, 65536), 'q4_0')
        self.assertIn(pin['context'], ownership.model_contexts(pin))
        self.assertIn(pin['alias'], [item['alias'] for item in ownership.registry(root)])
        self.assertEqual(ownership.prompt_cache_mib(pin['alias']), 1024)
        self.assertNotIn(65536, ownership.model_contexts({'alias': 'legacy-fixture'}))

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='bambi-native-test-')
        self.root = Path(self.directory.name)
        for name in ['scripts', 'runtime', 'docs', 'models/community', '.runtime/lib/ollama']:
            (self.root / name).mkdir(parents=True)
        self.binary = self.root / '.runtime/lib/ollama/llama-server'
        shutil.copyfile(Path('/proc/self/exe').resolve(), self.binary)
        self.binary.chmod(0o700)
        (self.root / 'models/community/fixture.gguf').write_bytes(b'fixture')
        self.alias = 'fixture-9b:latest'
        self.pins = [{'alias': self.alias, 'file': 'fixture.gguf', 'bytes': 7}]
        (self.root / 'docs/community-models.json').write_text(json.dumps(self.pins))
        self.profile = ownership.RUNTIME_PROFILE
        self.children = []
        self.server = self.root / 'fixture_server.py'
        self.server.write_text('''import argparse,json,http.server,signal
p=argparse.ArgumentParser();p.add_argument('--test-port',type=int);p.add_argument('--alias');p.add_argument('--ctx-size',type=int);p.add_argument('--test-ignore-term',action='store_true');a,_=p.parse_known_args()
if a.test_ignore_term:signal.signal(signal.SIGTERM,signal.SIG_IGN)
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  body={'status':'ok'} if self.path=='/health' else {'data':[{'id':a.alias}]} if self.path=='/v1/models' else {'default_generation_settings':{'n_ctx':a.ctx_size}}
  self.send_response(200);self.end_headers();self.wfile.write(json.dumps(body).encode())
 def log_message(self,*args):pass
http.server.HTTPServer(('127.0.0.1',a.test_port),Handler).serve_forever()
''')

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=5)
        self.directory.cleanup()

    def launch(self, foreign=False, cwd=None, weight=None, ignore_term=False, cache_mib=None, mode='auto', cache_type='f16', dflash=False, mtp=False, batch_size=None, micro_batch_size=None, declared_port=8080):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        arguments = [str(self.binary if not foreign else Path('/proc/self/exe').resolve()), str(self.server),
                     '-m', str(weight or self.root / 'models/community/fixture.gguf'), '--alias', self.alias,
                     '--host', '127.0.0.1', '--port', str(declared_port), '--ctx-size', '8192', '--parallel', '1',
                     '--ctx-checkpoints', '16', '--checkpoint-min-step', '512', '--cache-ram', str(ownership.prompt_cache_mib(self.alias) if cache_mib is None else cache_mib),
                     '--reasoning', 'off', '--device', 'none' if mode == 'cpu' else 'Vulkan0', '--gpu-layers', '0' if mode == 'cpu' else 'auto', '--fit', 'off' if mode == 'cpu' else 'on', '--fit-ctx', '8192', '--fit-target', '1024', '--flash-attn', 'on', '--jinja', '--no-webui',
                     '--cache-type-k', cache_type, '--cache-type-v', cache_type, '--test-port', str(port)]
        if ignore_term:
            arguments.append('--test-ignore-term')
        if self.alias.startswith('bambi-qwen35-4b-hauhau'):
            arguments += ['--verbosity', '4']
        if 'ubatch_size' in self.pins[0].get('runtime', {}):
            arguments += ['--ubatch-size', str(micro_batch_size or self.pins[0]['runtime']['ubatch_size'])]
        elif micro_batch_size is not None:
            arguments += ['--ubatch-size', str(micro_batch_size)]
        if batch_size is not None:
            arguments += ['--batch-size', str(batch_size)]
        if mtp:
            arguments += ownership.speculative_options(self.pins[0])
        if dflash:
            arguments += ['--spec-type', 'draft-dflash', '--spec-draft-model', str(self.root / 'models/speculative/draft.gguf'), '--spec-draft-n-max', '3']
        child = subprocess.Popen(arguments, cwd=cwd or self.root, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.children.append(child)
        for _ in range(100):
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1', port)) == 0:
                    return child, port
            if child.poll() is not None:
                self.fail('Isolated fixture did not start')
            time.sleep(.01)
        self.fail('Fixture port did not open')

    def runner(self):
        source = Path(__file__).resolve().parents[1] / 'scripts/llama-runtime.py'
        target = self.root / 'scripts/llama-runtime.py'
        shutil.copyfile(source, target)
        previous = Path.cwd()
        try:
            spec = importlib.util.spec_from_file_location('fixture_native_runner', target)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        finally:
            os.chdir(previous)

    def setup_mtp(self, enabled=True, bad_hash=False):
        self.alias = 'bambi-qwen35-4b-hauhau-mtp-' + ('experiment' if enabled else 'baseline') + ':q4_k_m'
        self.pins[0].update(alias=self.alias, sha256='0' * 64 if bad_hash else hashlib.sha256(b'fixture').hexdigest(), runtime={'cache_type': 'f16', 'ubatch_size': 128})
        if enabled:
            self.pins[0]['runtime']['speculative'] = {'type': 'draft-mtp', 'draft_tokens': 3}
        (self.root / 'docs/community-models.json').write_text(json.dumps(self.pins))

    def test_registry_enables_calibration_for_supported_catalog_models_only(self):
        root = Path(__file__).resolve().parents[1]
        catalog = json.loads((root / 'config/local-model-catalog.json').read_text())
        expected = {pin['alias'] for pin in catalog if pin.get('desktopSupported') and pin.get('license') in ['apache-2.0', 'lfm1.0']}
        actual = {pin['alias'] for pin in ownership.registry(root) if pin.get('calibration_supported')}
        self.assertEqual(len(expected), 9)
        self.assertEqual(actual, expected)

    def test_alternate_port_requires_explicit_matching_expectation_and_exact_owner(self):
        child, _ = self.launch(declared_port=18180)
        self.assertIsNone(ownership.inspect_llama(self.root, child.pid, self.pins, self.profile))
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile, port=18180)
        self.assertEqual(entry['port'], 18180)
        self.assertEqual(entry['runtimeProfile'], self.profile)
        with self.assertRaisesRegex(RuntimeError, 'ownership changed'):
            ownership.stop_llama(self.root, entry, self.pins, self.profile)
        self.assertIsNone(child.poll())
        foreign, _ = self.launch(foreign=True, declared_port=18180)
        self.assertIsNone(ownership.inspect_llama(self.root, foreign.pid, self.pins, self.profile, port=18180))
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]) as listeners:
            self.assertEqual(ownership.recover_llama(self.root, self.pins, self.profile, port=18180)['pid'], child.pid)
            listeners.assert_called_once_with(18180)
        ownership.stop_llama(self.root, entry, self.pins, self.profile, seconds=.1, port=18180)
        child.wait(timeout=5)
        self.assertIsNone(foreign.poll())

    def test_alternate_port_rejects_invalid_expectations_before_process_access(self):
        for port in (True, 0, 80, 65536, '18180', 18180.0):
            with self.subTest(port=port), self.assertRaises(ValueError):
                ownership.inspect_llama(self.root, os.getpid(), self.pins, self.profile, port=port)

    def test_calibrated_large_batches_keep_ownership_and_recovery_for_supported_profiles(self):
        self.pins[0].update(calibration_supported=True, runtime={'ubatch_size': 128})
        child, _ = self.launch(batch_size=1024, micro_batch_size=256)
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertEqual(entry['runtimeProfile'], self.profile)
        self.assertEqual(entry['context'], 8192)  # Fixture context, never the real model endpoint.
        self.pins[0]['calibration_supported'] = False
        incompatible = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertEqual(incompatible['runtimeProfile'], 'recovered-incompatible')
        self.assertIsNone(child.poll())

    def test_research_admission_never_reuses_or_stops_existing_native_owner(self):
        child, _ = self.launch()
        module = self.runner()
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]), \
             patch.object(module, 'stop_llama') as stop, \
             patch.object(module, 'request') as network, \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192', '--require-empty-slot']):
            with self.assertRaisesRegex(RuntimeError, 'empty inference slot'):
                module.main()
            stop.assert_not_called()
            network.assert_not_called()
        self.assertIsNone(child.poll())

    def test_research_admission_never_unloads_an_ollama_model(self):
        module = self.runner()
        with patch.object(module, 'recover_llama', return_value=None), \
             patch.object(module, 'request', return_value={'models': [{'name': 'public fixture'}]}) as network, \
             patch.object(module.socket, 'socket') as socket_factory, \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192', '--require-empty-slot']):
            socket_factory.return_value.__enter__.return_value.connect_ex.return_value = 1
            with self.assertRaisesRegex(RuntimeError, 'No Ollama model was unloaded'):
                module.main()
            network.assert_called_once_with('http://127.0.0.1:11434/api/ps')

    def test_mtp_ownership_requires_its_pinned_speculation_and_matching_runner_is_reused(self):
        self.setup_mtp()
        child, port = self.launch(mtp=True)
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertTrue(entry['mtp'])
        self.assertEqual(entry['dflash'], 'off')
        self.assertEqual(entry['runtimeProfile'], self.profile)
        self.assertNotIn('--spec-draft-model', entry['command'])
        self.assertEqual(ownership.prompt_cache_mib(self.alias), 2048)
        module = self.runner()
        native_request = module.request
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]), \
             patch.object(module, 'request', side_effect=lambda url, data=None: native_request(url.replace(':8080', ':' + str(port)), data)), \
             patch.object(module, 'stop_llama') as stop, \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192']), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as done:
                module.main()
            self.assertEqual(done.exception.code, 0)
            stop.assert_not_called()

    def test_mtp_off_uses_the_same_asset_without_a_speculative_context(self):
        self.setup_mtp(enabled=False)
        child, _ = self.launch()
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertFalse(entry['mtp'])
        self.assertEqual(entry['runtimeProfile'], self.profile)
        self.assertEqual(ownership.speculative_options(self.pins[0]), [])

    def test_bad_mtp_hash_and_missing_speculative_flags_cannot_reuse_or_stop_existing_ai(self):
        self.setup_mtp(bad_hash=True)
        child, _ = self.launch()
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertEqual(entry['runtimeProfile'], 'recovered-incompatible')
        module = self.runner()
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]), \
             patch.object(module, 'stop_llama') as stop, \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192']):
            with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                module.main()
            stop.assert_not_called()
        self.assertIsNone(child.poll())

    def setup_4b_draft(self, bad_hash=False):
        self.alias = 'bambi-qwen35-4b-hauhau:q4_k_m'
        self.pins[0]['alias'] = self.alias
        (self.root / 'docs/community-models.json').write_text(json.dumps(self.pins))
        (self.root / 'config').mkdir(exist_ok=True)
        (self.root / 'models/speculative').mkdir(exist_ok=True)
        payload = b'public draft fixture'
        (self.root / 'models/speculative/draft.gguf').write_bytes(payload)
        manifest = {'status': 'experiment-only', 'draft': {'file': 'draft.gguf', 'bytes': len(payload), 'sha256': '0' * 64 if bad_hash else hashlib.sha256(payload).hexdigest()}}
        (self.root / 'config/speculative-4b-experiment.json').write_text(json.dumps(manifest))

    def test_4b_dflash_process_is_owned_and_matching_profile_reuses_it(self):
        self.setup_4b_draft()
        child, port = self.launch(dflash=True)
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertEqual(entry['dflash'], 'on')
        self.assertEqual(entry['runtimeProfile'], self.profile)
        self.assertEqual(ownership.prompt_cache_mib(self.alias), 2048)
        module = self.runner()
        native_request = module.request
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]), \
             patch.object(module, 'request', side_effect=lambda url, data=None: native_request(url.replace(':8080', ':' + str(port)), data)), \
             patch.object(module, 'stop_llama') as stop, \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192', '--dflash', 'on']), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as done:
                module.main()
            self.assertEqual(done.exception.code, 0)
            stop.assert_not_called()
        self.assertIsNone(child.poll())

    def test_missing_or_tampered_small_model_license_does_not_stop_existing_ai(self):
        child, _ = self.launch()
        target = 'bambi-lfm25-1.2b:Q4_K_M'
        notice = b'public pinned license fixture'
        pin = {'alias': target, 'file': 'fixture.gguf', 'bytes': 7,
               'sha256': hashlib.sha256(b'fixture').hexdigest(),
               'resource_plan': {'estimatedWorkingBytes': 1024**3, 'reserveBytes': 1024**3},
               'licenseNotice': {'path': 'community/LICENSE.txt', 'bytes': len(notice), 'sha256': hashlib.sha256(notice).hexdigest()}}
        self.pins.append(pin)
        (self.root / 'docs/community-models.json').write_text(json.dumps(self.pins))
        module = self.runner()
        for payload in [None, b'x' * len(notice)]:
            if payload is not None:
                (self.root / 'models/community/LICENSE.txt').write_bytes(payload)
            with patch.object(ownership, 'listening_pids', return_value=[child.pid]), patch.object(module, 'stop_llama') as stop, patch.object(sys, 'argv', ['runner', 'start', '--model', target, '--context', '8192']):
                with self.assertRaisesRegex(RuntimeError, 'license notice'):
                    module.main()
                stop.assert_not_called()
            self.assertIsNone(child.poll())

    def test_bad_draft_hash_is_rejected_before_stopping_existing_ai(self):
        self.setup_4b_draft(bad_hash=True)
        child, _ = self.launch()
        module = self.runner()
        with patch.object(module, 'stop_llama') as stop, patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192', '--dflash', 'on']):
            with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
                module.main()
            stop.assert_not_called()
        self.assertIsNone(child.poll())

    def test_dflash_for_other_model_is_rejected_before_stopping_existing_ai(self):
        child, _ = self.launch()
        module = self.runner()
        with patch.object(module, 'stop_llama') as stop, patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192', '--dflash', 'on']):
            with self.assertRaisesRegex(RuntimeError, 'available for Hauhau 4B'):
                module.main()
            stop.assert_not_called()
        self.assertIsNone(child.poll())

    def test_matching_project_process_is_verified_and_socket_owner_is_found(self):
        child, port = self.launch()
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertEqual(entry['model'], self.alias)
        self.assertEqual(entry['context'], 8192)
        self.assertEqual(entry['runtimeProfile'], self.profile)
        self.assertIn(child.pid, ownership.listening_pids(port))
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]):
            self.assertEqual(ownership.recover_llama(self.root, self.pins, self.profile)['pid'], child.pid)

    def test_foreign_binary_is_never_adopted_or_stopped(self):
        child, _ = self.launch(foreign=True)
        self.assertIsNone(ownership.inspect_llama(self.root, child.pid, self.pins, self.profile))
        entry = {'pid': child.pid, 'starttime': ownership.identity(child.pid)}
        with self.assertRaisesRegex(RuntimeError, 'ownership changed'):
            ownership.stop_llama(self.root, entry, self.pins, self.profile)
        self.assertIsNone(child.poll())

    def test_undersized_9b_cache_is_owned_but_requires_profile_upgrade(self):
        child, _ = self.launch(cache_mib=256)
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertIsNotNone(entry)
        self.assertEqual(entry['runtimeProfile'], 'recovered-incompatible')
        self.assertIsNone(child.poll())

    def test_35b_preserves_its_scoped_memory_profile(self):
        self.alias = 'fixture-35b:latest'
        self.pins[0]['alias'] = self.alias
        child, _ = self.launch(cache_mib=256)
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertEqual(entry['runtimeProfile'], self.profile)

    def test_wrong_working_directory_or_weight_is_not_project_ownership(self):
        child, _ = self.launch(cwd=self.root.parent)
        self.assertIsNone(ownership.inspect_llama(self.root, child.pid, self.pins, self.profile))
        another, _ = self.launch(weight=self.root / 'unregistered.gguf')
        self.assertIsNone(ownership.inspect_llama(self.root, another.pid, self.pins, self.profile))

    def test_stale_pid_identity_cannot_stop_an_existing_process(self):
        child, _ = self.launch()
        with self.assertRaisesRegex(RuntimeError, 'ownership changed'):
            ownership.stop_llama(self.root, {'pid': child.pid, 'starttime': 'stale'}, self.pins, self.profile)
        self.assertIsNone(child.poll())

    def test_stubborn_owned_process_is_gone_before_stop_returns(self):
        child, port = self.launch(ignore_term=True)
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        ownership.stop_llama(self.root, entry, self.pins, self.profile, seconds=.1)
        self.assertIsNotNone(child.poll())
        with socket.socket() as probe:
            self.assertNotEqual(probe.connect_ex(('127.0.0.1', port)), 0)

    def test_recovery_restores_registry_and_reuses_same_process(self):
        child, port = self.launch()
        module = self.runner()
        statepath = self.root / 'runtime/owned-processes.json'
        statepath.write_text(json.dumps({'server': {'pid': 42, 'root': 'preserved'}}))
        native_request = module.request
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]), \
             patch.object(module, 'request', side_effect=lambda url, data=None: native_request(url.replace(':8080', ':' + str(port)), data)), \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192']), redirect_stdout(io.StringIO()):
            for _ in range(2):
                with self.assertRaises(SystemExit) as done:
                    module.main()
                self.assertEqual(done.exception.code, 0)
        state = json.loads(statepath.read_text())
        self.assertEqual(state['llama']['pid'], child.pid)
        self.assertTrue(state['llama']['recovered'])
        self.assertEqual(state['server'], {'pid': 42, 'root': 'preserved'})
        self.assertIsNone(child.poll())

    def test_explicit_hauhau_q8_is_owned_and_reused_but_default_still_means_f16(self):
        self.alias = 'bambi-qwen35-9b-hauhau:q4_k_m'
        self.pins[0]['alias'] = self.alias
        (self.root / 'docs/community-models.json').write_text(json.dumps(self.pins))
        child, port = self.launch(cache_type='q8_0')
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertEqual(entry['cacheType'], 'q8_0')
        self.assertEqual(entry['runtimeProfile'], self.profile)
        self.assertEqual(ownership.context_cache_type(self.pins[0], 8192), 'f16')
        module = self.runner()
        native_request = module.request
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]), \
             patch.object(module, 'request', side_effect=lambda url, data=None: native_request(url.replace(':8080', ':' + str(port)), data)), \
             patch.object(module, 'stop_llama') as stop, \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192', '--kv-cache', 'q8_0']), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as done:
                module.main()
            self.assertEqual(done.exception.code, 0)
            stop.assert_not_called()
        self.assertIsNone(child.poll())

    def test_q8_for_other_model_is_rejected_before_stopping_its_runner(self):
        child, _ = self.launch()
        module = self.runner()
        with patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192', '--kv-cache', 'q8_0']):
            with self.assertRaisesRegex(RuntimeError, 'available for Hauhau'):
                module.main()
        self.assertIsNone(child.poll())

    def test_missing_requested_weights_do_not_stop_the_working_model(self):
        child, _ = self.launch()
        module = self.runner()
        pins = self.pins + [{'alias': 'missing-model', 'file': 'missing.gguf', 'bytes': 7}]
        (self.root / 'docs/community-models.json').write_text(json.dumps(pins))
        with patch.object(sys, 'argv', ['runner', 'start', '--model', 'missing-model']):
            with self.assertRaisesRegex(RuntimeError, 'not installed'):
                module.main()
        self.assertIsNone(child.poll())

    def test_foreign_port_conflict_gives_actionable_error_without_stopping_service(self):
        child, _ = self.launch(foreign=True)
        module = self.runner()
        with patch.object(ownership, 'listening_pids', return_value=[child.pid]), \
             patch.object(module.socket, 'socket') as probe, \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192']):
            probe.return_value.__enter__.return_value.connect_ex.return_value = 0
            with self.assertRaisesRegex(RuntimeError, 'ownership could not be verified'):
                module.main()
        self.assertIsNone(child.poll())

    def test_binary_upgrade_recognizes_the_old_process_without_reusing_its_profile(self):
        child, _ = self.launch()
        self.binary.unlink()
        shutil.copyfile(Path('/proc/self/exe').resolve(), self.binary)
        self.binary.chmod(0o700)
        entry = ownership.inspect_llama(self.root, child.pid, self.pins, self.profile)
        self.assertIsNotNone(entry)
        self.assertEqual(entry['runtimeProfile'], 'recovered-incompatible')
        ownership.stop_llama(self.root, entry, self.pins, self.profile)
        child.wait(timeout=5)

    def cold_start(self, module, *, scoped=False, failure=None, before_socket=False, plan=None):
        """Use an isolated child instead of GPU inference, including scope separation."""
        spawned = []
        units = []
        def spawn(command, **_kwargs):
            if '--unit' in command:
                units.append(command[command.index('--unit') + 1])
            server, _ = self.launch(mode='cpu' if '--gpu-layers' in command and command[command.index('--gpu-layers') + 1] == '0' else 'auto')
            launcher = server
            if scoped:
                launcher = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                            start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.children.append(launcher)
            spawned.extend([server, launcher])
            return launcher
        def recovered(*_args):
            return ownership.inspect_llama(self.root, spawned[-2].pid, self.pins, self.profile) if spawned and not before_socket else None
        def stop_scope(command, **_kwargs):
            self.assertEqual(command, ['systemctl', '--user', 'kill', '--kill-whom=all', '--signal=SIGKILL', units[0] + '.scope'])
            entry = ownership.inspect_llama(self.root, spawned[0].pid, self.pins, self.profile)
            ownership.stop_llama(self.root, entry, self.pins, self.profile)
        native_path = module.Path
        memory_info = unittest.mock.Mock()
        memory_info.read_text.return_value = 'MemAvailable: 16777216 kB\n'
        with patch.object(module, 'recover_llama', side_effect=recovered), \
             patch.object(module, 'socket', wraps=socket), \
             patch.object(module.socket, 'socket') as probe, \
             patch.object(module, 'Path', side_effect=lambda path: memory_info if path == '/proc/meminfo' else native_path(path)), \
             patch.object(module.shutil, 'which', return_value='/usr/bin/systemd-run'), \
             patch.object(module, 'request', side_effect=lambda url, data=None: {'data': [{'id': self.alias}]} if url.endswith('/v1/models') else {'models': []}), \
             patch.object(module.subprocess, 'Popen', side_effect=spawn), \
             patch.object(module.subprocess, 'run', side_effect=stop_scope), \
             patch.object(module, 'verify_inference', side_effect=failure, return_value=1), \
             patch.object(module, 'runtime_policy', side_effect=lambda root, action, **payload: (plan or {'attempts': [{'device': None, 'environment': {}, 'args': ['--device', 'none', '--gpu-layers', '0', '--fit', 'off', '--fit-ctx', '8192', '--fit-target', '1024']}]}) if action == 'plan' else {'evidence': {'offloadedLayers': 20, 'totalLayers': 33}, 'reason': 'gpu-memory', 'key': 'fixture-device-key'}), \
             patch.object(sys, 'argv', ['runner', 'start', '--model', self.alias, '--context', '8192']), redirect_stdout(io.StringIO()):
            probe.return_value.__enter__.return_value.connect_ex.return_value = 1
            module.main()
        return spawned

    def test_cold_start_records_actual_server_pid_in_a_separate_scope(self):
        module = self.runner()
        # Patch only the module's subprocess namespace; fixture creation stays real.
        with patch.object(module, 'subprocess', wraps=subprocess):
            server, launcher = self.cold_start(module, scoped=True)
        state = json.loads((self.root / 'runtime/owned-processes.json').read_text())
        self.assertEqual(state['llama']['pid'], server.pid)
        self.assertNotEqual(server.pid, launcher.pid)
        self.assertIsNone(server.poll())

    def test_cancelled_cold_start_stops_server_and_separate_launcher(self):
        module = self.runner()
        with patch.object(module, 'subprocess', wraps=subprocess):
            with self.assertRaises(KeyboardInterrupt):
                self.cold_start(module, scoped=True, failure=KeyboardInterrupt)
        self.assertTrue(all(child.poll() is not None for child in self.children))
        self.assertNotIn('llama', json.loads((self.root / 'runtime/owned-processes.json').read_text()))

    def test_failed_cold_start_stops_its_created_model(self):
        module = self.runner()
        with patch.object(module, 'subprocess', wraps=subprocess):
            with self.assertRaisesRegex(RuntimeError, 'fixture load failed'):
                self.cold_start(module, failure=RuntimeError('fixture load failed'))
        self.assertTrue(all(child.poll() is not None for child in self.children))
        self.assertNotIn('llama', json.loads((self.root / 'runtime/owned-processes.json').read_text()))

    def test_cancelled_35b_start_cleans_only_its_scope_before_server_opens_a_socket(self):
        module = self.runner()
        self.alias = 'fixture-35b:latest'
        self.pins[0]['alias'] = self.alias
        (self.root / 'docs/community-models.json').write_text(json.dumps(self.pins))
        foreign, _ = self.launch(foreign=True)
        with patch.object(module, 'subprocess', wraps=subprocess):
            with self.assertRaises(KeyboardInterrupt):
                self.cold_start(module, scoped=True, before_socket=True, failure=KeyboardInterrupt)
        self.assertIsNone(foreign.poll())
        self.assertTrue(all(child.poll() is not None for child in self.children if child is not foreign))
        self.assertNotIn('llama', json.loads((self.root / 'runtime/owned-processes.json').read_text()))

    def test_gpu_startup_failure_cleans_the_first_worker_then_prepares_cpu(self):
        module = self.runner()
        device = {'id': 'CUDA0', 'backend': 'cuda', 'name': 'Fixture GPU', 'freeMiB': 7000, 'totalMiB': 8192}
        plan = {'devices': [device], 'attempts': [
            {'device': device, 'environment': {}, 'args': ['--device', 'CUDA0', '--gpu-layers', 'auto', '--fit', 'on', '--fit-ctx', '8192', '--fit-target', '1024']},
            {'device': None, 'environment': {}, 'args': ['--device', 'none', '--gpu-layers', '0', '--fit', 'off', '--fit-ctx', '8192', '--fit-target', '1024']} ]}
        with patch.object(module, 'subprocess', wraps=subprocess):
            self.cold_start(module, failure=[module.RuntimeFailure('Fixture GPU startup failed', 'exit'), 1], plan=plan)
        state = json.loads((self.root / 'runtime/owned-processes.json').read_text())
        self.assertIsNotNone(self.children[0].poll())
        self.assertIsNone(self.children[-1].poll())
        self.assertEqual(state['llama']['requested'], 'auto')
        self.assertEqual(state['llama']['acceleration']['backend'], 'cpu')
        self.assertEqual(state['llama']['acceleration']['offloadedLayers'], 0)
        self.assertEqual(state['llama']['acceleration']['attempts'], 2)
        self.assertEqual(state['llama']['acceleration']['fallbackReason'], 'gpu-memory')
        self.assertEqual(state['accelerator']['blocked'], ['fixture-device-key'])

    def test_changed_full_context_never_starts_a_cpu_retry(self):
        module = self.runner()
        device = {'id': 'CUDA0', 'backend': 'cuda'}
        plan = {'attempts': [{'device': device, 'environment': {}, 'args': []}, {'device': None, 'environment': {}, 'args': []}]}
        with patch.object(module, 'subprocess', wraps=subprocess):
            with self.assertRaisesRegex(module.RuntimeFailure, 'changed context'):
                self.cold_start(module, failure=module.RuntimeFailure('changed context', 'invariant'), plan=plan)
        self.assertEqual(len(self.children), 1)
        self.assertIsNotNone(self.children[0].poll())
        self.assertNotIn('llama', json.loads((self.root / 'runtime/owned-processes.json').read_text()))

    def test_public_inference_requires_full_context_and_valid_output(self):
        module = self.runner()
        with patch.object(module, 'request', return_value={'default_generation_settings': {'n_ctx': 4096}}) as request:
            with self.assertRaises(module.RuntimeFailure) as failed:
                module.verify_inference(8192)
            self.assertEqual(failed.exception.kind, 'invariant')
            self.assertEqual(request.call_count, 1)
        for result in [{'content': 'test', 'tokens_predicted': True}, {'content': 'test', 'tokens_predicted': 0}, {'tokens_predicted': 1}]:
            with patch.object(module, 'request', side_effect=[{'default_generation_settings': {'n_ctx': 8192}}, result]):
                with self.assertRaises(module.RuntimeFailure) as failed:
                    module.verify_inference(8192)
                self.assertEqual(failed.exception.kind, 'inference')
        with patch.object(module, 'request', side_effect=[{'default_generation_settings': {'n_ctx': 8192}}, {'content': 'test', 'tokens_predicted': 1}]) as request:
            self.assertGreaterEqual(module.verify_inference(8192), 0)
            body = request.call_args.args[1]
            self.assertEqual(body['n_predict'], 1)
            self.assertFalse(body['cache_prompt'])

    def test_python_bridge_inventories_devices_using_the_shared_javascript_policy(self):
        root = Path(__file__).resolve().parents[1]
        probe = self.root / 'probe.py'
        probe.write_text("print('CUDA0: GPU (8192 MiB, 7000 MiB free)\\nVulkan0: GPU (8192 MiB, 7000 MiB free)')")
        plan = runtime_policy(root, 'plan', options={
            'command': {'executable': sys.executable, 'prefix': [str(probe)]},
            'library': str(self.binary.parent), 'platform': 'linux',
            'context': 24576, 'environment': {'GGML_VK_VISIBLE_DEVICES': '-1'}})
        self.assertEqual([item['device']['backend'] if item['device'] else 'cpu' for item in plan['attempts']], ['cuda', 'vulkan', 'cpu'])
        for item in plan['attempts']:
            self.assertNotIn('GGML_VK_VISIBLE_DEVICES', item['environment'])
            self.assertEqual(item['args'][item['args'].index('--fit-ctx') + 1], '24576')
        result = runtime_policy(root, 'result', log='cudaErrorMemoryAllocation: failed to load model', failure='exit', device=plan['attempts'][0]['device'])
        self.assertEqual(result['reason'], 'gpu-memory')
        retry = runtime_policy(root, 'plan', options={
            'command': {'executable': 'unused'}, 'devices': plan['devices'],
            'library': str(self.binary.parent), 'platform': 'linux',
            'context': 24576, 'environment': {}, 'blocked': [result['key']]})
        self.assertEqual([item['device']['backend'] if item['device'] else 'cpu' for item in retry['attempts']], ['vulkan', 'cpu'])

    def test_cancelling_the_python_bridge_reaps_its_hung_device_probe(self):
        root = Path(__file__).resolve().parents[1]
        probe = self.root / 'hung_probe.py'
        record = self.root / 'probe_pid'
        # Publish readiness atomically after the intended signal behavior is
        # installed. Merely creating the file can expose an empty PID to readers.
        probe.write_text("import os,signal,time\nfrom pathlib import Path\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nrecord=Path(os.environ['FIXTURE_PID'])\nstaged=record.with_suffix('.tmp')\nstaged.write_text(str(os.getpid()))\nos.replace(staged,record)\ntime.sleep(60)\n")
        source = """import signal,sys
from pathlib import Path
from accelerator_bridge import runtime_policy
def cancel(*_):raise KeyboardInterrupt
signal.signal(signal.SIGTERM,cancel)
runtime_policy(Path(sys.argv[1]), 'plan', options={'command': {'executable': sys.executable, 'prefix': [sys.argv[2]]}, 'library': sys.argv[3], 'platform': 'linux', 'context': 24576, 'environment': {'FIXTURE_PID': sys.argv[4]}})
"""
        child = subprocess.Popen([sys.executable, '-c', source, str(root), str(probe), str(self.binary.parent), str(record)],
                                 cwd=root / 'scripts', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(child)
        deadline = time.monotonic() + 5
        while not record.exists() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(record.exists(), 'Owned device probe did not start')
        pid = int(record.read_text())
        child.terminate()
        child.wait(timeout=5)
        self.assertIsNone(ownership.identity(pid), 'Cancelled probe must not remain running')

    def test_registry_writes_are_atomic_for_concurrent_readers(self):
        path = self.root / 'runtime/owned-processes.json'
        ownership.save_state(path, {'version': 0, 'data': 'initial'})
        errors = []
        done = threading.Event()
        def read():
            while not done.is_set():
                try:
                    self.assertIn('version', json.loads(path.read_text()))
                except Exception as error:
                    errors.append(error)
        reader = threading.Thread(target=read)
        reader.start()
        try:
            for n in range(20):
                ownership.save_state(path, {'version': n, 'data': 'payload' * 100})
        finally:
            done.set()
            reader.join()
        self.assertEqual(errors, [])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
