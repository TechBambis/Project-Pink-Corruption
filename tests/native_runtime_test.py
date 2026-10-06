# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Ownership tests never use production weights, GPU processes or port 8080."""
import importlib.util
import io
import json
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


class NativeRuntimeTests(unittest.TestCase):
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

    def launch(self, foreign=False, cwd=None, weight=None, ignore_term=False, cache_mib=None):
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        arguments = [str(self.binary if not foreign else Path('/proc/self/exe').resolve()), str(self.server),
                     '-m', str(weight or self.root / 'models/community/fixture.gguf'), '--alias', self.alias,
                     '--host', '127.0.0.1', '--port', '8080', '--ctx-size', '8192', '--parallel', '1',
                     '--ctx-checkpoints', '16', '--checkpoint-min-step', '512', '--cache-ram', str(ownership.prompt_cache_mib(self.alias) if cache_mib is None else cache_mib),
                     '--reasoning', 'off', '--gpu-layers', 'all', '--flash-attn', 'on', '--jinja', '--no-webui',
                     '--cache-type-k', 'f16', '--cache-type-v', 'f16', '--test-port', str(port)]
        if ignore_term:
            arguments.append('--test-ignore-term')
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

    def cold_start(self, module, *, scoped=False, failure=None, before_socket=False):
        """Use an isolated child instead of GPU inference, including scope separation."""
        spawned = []
        units = []
        def spawn(command, **_kwargs):
            if '--unit' in command:
                units.append(command[command.index('--unit') + 1])
            server, _ = self.launch()
            launcher = server
            if scoped:
                launcher = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                            start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.children.append(launcher)
            spawned.extend([server, launcher])
            return launcher
        def recovered(*_args):
            return ownership.inspect_llama(self.root, spawned[0].pid, self.pins, self.profile) if spawned and not before_socket else None
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
             patch.object(module, 'request', return_value={'models': []}), \
             patch.object(module.subprocess, 'Popen', side_effect=spawn), \
             patch.object(module.subprocess, 'run', side_effect=stop_scope), \
             patch.object(module, 'ready', side_effect=failure, return_value=True), \
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
