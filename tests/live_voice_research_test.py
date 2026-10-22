# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Offline boundary tests; no models, network, device output or service mutation."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import wave
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
from live_voice_metrics import PcmObservation, summarize, interval_coverage
from live_voice_pipewire import MonitorWindows, validate_links


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


setup = module('live_setup', 'setup-live-voice.py')
benchmark = module('live_benchmark', 'live-voice-benchmark.py')
listening = module('live_listening', 'live-voice-listening.py')


class SetupBoundaryTests(unittest.TestCase):
    def asset(self, content=b'public fixture'):
        return {'repo': 'owner/research', 'revision': 'a'*40, 'sha256': hashlib.sha256(content).hexdigest(),
                'file': 'src/model.py', 'path': 'src/model.py', 'bytes': len(content)}

    def test_manifest_has_pinned_assets_and_preserves_access_gate(self):
        manifest = json.loads((ROOT/'config/live-voice-experiment.json').read_text())
        for provider in manifest['providers']:
            for group in ['assets', 'sources']:
                for asset in provider.get(group, []):
                    setup.validate_asset(asset)
        pocket = next(p for p in manifest['providers'] if p['id'] == 'pocket')
        self.assertEqual(pocket['status'], 'access-required')

    def test_rejects_path_escape_and_unpinned_revision(self):
        for change in [{'path': '../outside'}, {'file': '/etc/hosts'}, {'path': 'src\\outside'},
                       {'revision': 'main'}, {'sha256': 'unverified'}, {'bytes': True}, {'bytes': -1}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                setup.validate_asset(self.asset() | change)

    def test_symlink_parent_and_target_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            base = root/'base'; base.mkdir()
            outside = root/'outside'; outside.mkdir()
            (base/'src').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                setup.destination(base, self.asset())
            (base/'src').unlink(); (base/'src').mkdir()
            (base/'src/model.py').symlink_to(outside/'file')
            with self.assertRaises(ValueError):
                setup.destination(base, self.asset())

    def test_failed_download_never_replaces_previous_file_or_leaves_partials(self):
        for content in [b'truncated', b'x'*100, b'wrong! fixture']:
            with tempfile.TemporaryDirectory() as folder:
                base = Path(folder)
                target = base/'src/model.py'; target.parent.mkdir(); target.write_bytes(b'old')
                with patch.object(setup.urllib.request, 'urlopen', return_value=io.BytesIO(content)):
                    with self.assertRaises(ValueError):
                        setup.install(base, self.asset(), source=True)
                self.assertEqual(target.read_bytes(), b'old')
                self.assertEqual(list(base.rglob('*.part')), [])

    def test_only_verified_download_is_installed_and_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            with patch.object(setup.urllib.request, 'urlopen', return_value=io.BytesIO(b'public fixture')) as network:
                self.assertEqual(setup.install(base, self.asset()), 'installed')
                self.assertEqual(setup.install(base, self.asset()), 'verified')
                network.assert_called_once()

    def test_empty_python_package_file_is_valid(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(setup.urllib.request, 'urlopen', return_value=io.BytesIO(b'')):
                self.assertEqual(setup.install(Path(folder), self.asset(b'')), 'installed')


class PcmBoundaryTests(unittest.TestCase):
    def frame(self, samples, seq=0, offset=0, at=50):
        import numpy as np
        samples = np.asarray(samples, dtype='<f4')
        channels = 1 if samples.ndim == 1 else samples.shape[1]
        return {'type': 'frame', 'id': 'current', 'seq': seq, 'offset': offset, 'sampleRate': 24000,
                'channels': channels, 'samples': len(samples), 'atMs': at,
                'pcm': base64.b64encode(samples.tobytes()).decode()}

    def end(self, count, frames=1, at=100):
        return {'type': 'end', 'id': 'current', 'samples': count, 'frames': frames, 'fullRenderMs': at}

    def test_silent_first_frame_does_not_win_non_silent_ttfa(self):
        observer = PcmObservation('current')
        observer.accept(self.frame([0]*480), 55)
        observer.accept(self.frame([.0002]*480, seq=1, offset=480, at=90), 95)
        result = observer.finish(self.end(960, 2))
        self.assertEqual(result['firstValidPcmMs'], 50)
        self.assertEqual(result['firstNonSilent']['nativeMs'], 90)
        self.assertEqual(result['firstNonSilent']['sampleOffset'], 480)
        self.assertIsNone(result['physicalOutputMs'])

    def test_phase_opposed_stereo_is_audible_and_partial_window_survives_eos(self):
        observer = PcmObservation('current')
        observer.accept(self.frame([[.0002, -.0002]]*100), 55)
        result = observer.finish(self.end(100))
        self.assertIsNotNone(result['firstNonSilent'])
        self.assertEqual(result['firstNonSilent']['sampleOffset'], 0)
        self.assertEqual(result['firstNonSilent']['nativeMs'], 50)
        self.assertEqual(result['firstNonSilent']['receivedMs'], 55)

    def test_all_silent_job_has_no_first_non_silent_time(self):
        observer = PcmObservation('current')
        observer.accept(self.frame([0]*960), 55)
        result = observer.finish(self.end(960))
        self.assertIsNone(result['firstNonSilent'])
        self.assertEqual(summarize([{'status': 'ok', 'measurement': result}])['allSilentJobs'], 1)

    def test_stale_duplicate_missing_and_bad_payload_are_rejected(self):
        frame = self.frame([.1]*480)
        for change in [{'id': 'old'}, {'seq': 1}, {'seq': True}, {'offset': 12}, {'samples': 1},
                       {'pcm': 'broken'}, {'atMs': float('nan')}, {'sampleRate': True}]:
            with self.subTest(change=change), self.assertRaises((ValueError, TypeError)):
                PcmObservation('current').accept(frame | change, 55)
        observer = PcmObservation('current'); observer.accept(frame, 55)
        with self.assertRaises(ValueError):
            observer.accept(frame, 56)
        with self.assertRaises(ValueError):
            observer.finish(self.end(479))

    def test_non_finite_samples_and_in_job_format_changes_are_rejected(self):
        with self.assertRaises(ValueError):
            PcmObservation('current').accept(self.frame([float('nan')]), 55)
        observer = PcmObservation('current'); observer.accept(self.frame([.1]*480), 55)
        with self.assertRaises(ValueError):
            observer.accept(self.frame([.1]*480, seq=1, offset=480, at=80) | {'sampleRate': 48000}, 85)


class PipeWireMonitorTests(unittest.TestCase):
    def test_rms_windows_span_stdio_reads_and_preserve_phase_opposed_channels(self):
        import numpy as np
        windows = MonitorWindows()
        pcm = np.tile([.0002, -.0002], (960, 1)).astype('<f4').tobytes()
        self.assertEqual(len(windows.accept(pcm[:7])), 0)
        observed = windows.accept(pcm[7:]+bytes(7680))
        self.assertAlmostEqual(observed[0], .0002)
        self.assertEqual(observed[1], 0)
        self.assertEqual(windows.pending, b'')
        broken = np.full((960, 2), float('nan'), dtype='<f4').tobytes()
        with self.assertRaises(ValueError):
            windows.accept(broken)

    def test_output_graph_rejects_missing_foreign_inactive_and_reused_nodes(self):
        def node(identifier, name):
            return {'type': 'PipeWire:Interface:Node', 'id': identifier,
                    'info': {'props': {'node.name': name, 'object.serial': 10+identifier}}}
        nodes = {'own-play': node(1, 'own-play'), 'own-sink': node(2, 'own-sink')}
        link = {'type': 'PipeWire:Interface:Link', 'info': {
            'output-node-id': 1, 'output-port-id': 11, 'input-node-id': 2, 'input-port-id': 22, 'state': 'active'}}
        objects = list(nodes.values())+[link]
        expected = [(1, 11, 2, 22)]
        self.assertEqual(validate_links(objects, nodes, expected), [link])
        for changed in [list(nodes.values()), objects+[link],
                        list(nodes.values())+[link | {'info': link['info'] | {'state': 'paused'}}],
                        list(nodes.values())+[link | {'info': link['info'] | {'input-node-id': 99}}]]:
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                validate_links(changed, nodes, expected)
        reused = copy.deepcopy(objects)
        reused[0]['info']['props']['object.serial'] += 1
        with self.assertRaises(RuntimeError):
            validate_links(reused, nodes, expected)

    def test_stale_native_frame_cannot_reach_output_and_monitor_does_not_claim_physical_time(self):
        from unittest.mock import Mock
        boundary = PcmBoundaryTests()
        def measure(stale=False):
            worker = benchmark.Worker.__new__(benchmark.Worker)
            worker.process = SimpleNamespace(stdin=io.StringIO())
            sink = Mock()
            sink.info = {'outputClock': 'Monitor receipt upper bound'}
            sink.finish.return_value = {'firstNonSilentMonitorDeliveryMs': 60, 'physicalOutputMs': None}
            frame = boundary.frame([.1]*480) | {'id': 'old' if stale else 'current', '_receivedNs': 1_055_000_000}
            messages = iter([{'type': 'admission', 'id': 'current', 'monotonicNs': 1_000_000_000, '_receivedNs': 1_001_000_000},
                             frame, boundary.end(480) | {'id': 'current', '_receivedNs': 1_100_000_000, 'rssPeakMiB': 10}])
            worker.next = lambda timeout: next(messages)
            with patch.object(benchmark.time, 'monotonic_ns', return_value=1_000_000_000):
                if stale:
                    with self.assertRaises(ValueError):
                        worker.render('current', 'Public text.', 41, False, sink)
                    sink.frame.assert_not_called()
                    sink.finish.assert_not_called()
                else:
                    result = worker.render('current', 'Public text.', 41, False, sink)
                    self.assertIsNone(result['physicalOutputMs'])
                    self.assertIsNone(result['pipeWireOutputMs'])
                    self.assertEqual(result['pipeWireMonitor']['firstNonSilentMonitorDeliveryMs'], 60)
                    sink.begin.assert_called_once_with('current', 1_000_000_000)
        measure(); measure(stale=True)


class AppLoadGuardTests(unittest.TestCase):
    def test_requested_hardware_profile_rejects_software_or_lost_visual_context(self):
        with tempfile.TemporaryDirectory() as folder:
            app = benchmark.AppLoad.__new__(benchmark.AppLoad)
            app.output = Path(folder); app.started = 'owned'; app.graphics = 'vulkan'
            app.process = SimpleNamespace(pid=123, poll=lambda: None)
            graphics = {'backend': 'webgl', 'contextLost': False, 'renderer': 'ANGLE (AMD, Vulkan Radeon)'}
            latest = {'audioState': 'running', 'visualEnabled': True, 'sessionActive': True, 'mic': 'listening',
                      'observedAt': 1000, 'lastVadFrameAt': 900, 'lastRecognitionAt': 800,
                      'publicInputPeriod': 8.625, 'visualGraphics': graphics}
            base = {'status': 'ready', 'errors': [], 'executionContext': 'native-host',
                    'graphicsRequested': 'vulkan', 'updatedMonotonicNs': '10000000000', 'initial': latest}
            path = app.output/'result.json'
            with patch.object(benchmark, 'identity', return_value='owned'), \
                    patch.object(benchmark.time, 'monotonic_ns', return_value=10_000_000_000):
                path.write_text(json.dumps(base)); app.assert_healthy()
                for change in [{'renderer': 'ANGLE (Google, Vulkan SwiftShader)'}, {'renderer': 'Vulkan llvmpipe'},
                               {'renderer': None}, {'contextLost': True}, {'backend': 'canvas2d'}]:
                    path.write_text(json.dumps(base | {'initial': latest | {'visualGraphics': graphics | change}}))
                    with self.assertRaises(RuntimeError): app.assert_healthy()
                path.write_text(json.dumps(base | {'graphicsRequested': 'default'}))
                with self.assertRaises(RuntimeError): app.assert_healthy()

    def test_stalled_or_inactive_resource_load_cannot_qualify_combined_measurement(self):
        with tempfile.TemporaryDirectory() as folder:
            app = benchmark.AppLoad.__new__(benchmark.AppLoad)
            app.output = Path(folder)
            app.started = 'owned'
            app.process = SimpleNamespace(pid=123, poll=lambda: None)
            observed = {'audioState': 'running', 'visualEnabled': True, 'sessionActive': True, 'mic': 'listening',
                        'observedAt': 1000, 'lastVadFrameAt': 900, 'lastRecognitionAt': 800, 'publicInputPeriod': 8.625}
            result = {'status': 'ready', 'executionContext': 'native-host', 'updatedMonotonicNs': '10000000000',
                      'initial': observed, 'latest': observed, 'errors': []}
            def save(value):
                (app.output/'result.json').write_text(json.dumps(value))
            with patch.object(benchmark, 'identity', return_value='owned'), \
                    patch.object(benchmark.time, 'monotonic_ns', return_value=10_000_000_000):
                save(result); app.assert_healthy()
                for change in [{'updatedMonotonicNs': '1'}, {'executionContext': 'flatpak-control'},
                               {'status': 'incomplete-or-invalid'}, {'errors': ['VAD failed']},
                               {'latest': observed | {'mic': 'muted'}}, {'latest': observed | {'audioState': 'suspended'}},
                               {'latest': observed | {'speechError': 'ASR deadline'}},
                               {'latest': observed | {'lastVadFrameAt': -5000}},
                               {'latest': observed | {'lastRecognitionAt': -30000}}]:
                    with self.subTest(change=change), self.assertRaises(RuntimeError):
                        save(result | change); app.assert_healthy()
            save(result)
            with patch.object(benchmark, 'identity', return_value='reused'), self.assertRaises(RuntimeError):
                app.assert_healthy()


class ModelGuardTests(unittest.TestCase):
    def test_foreign_process_outline_reports_executable_but_never_arguments(self):
        pid = os.getpid()
        started = benchmark.identity(pid)
        detail = benchmark.process_outline({'pid': pid, 'starttime': started})
        self.assertTrue(detail['available'])
        self.assertEqual(detail['pid'], pid)
        self.assertEqual(detail['starttime'], started)
        self.assertIn('executable', detail)
        self.assertNotIn('command', detail)
        self.assertNotIn('cmdline', detail)
        self.assertLessEqual(len(detail['parents']), 2)

    def test_reused_or_exited_process_cannot_gain_another_incarnation_outline(self):
        owner = {'pid': os.getpid(), 'starttime': benchmark.identity(os.getpid())}
        for observations in [['new'], [owner['starttime'], 'new']]:
            with patch.object(benchmark, 'identity', side_effect=observations):
                detail = benchmark.process_outline(owner)
            self.assertFalse(detail['available'])
            self.assertNotIn('executable', detail)
            self.assertEqual(detail['parents'], [])

    def test_brief_foreign_inference_observation_invalidates_cell_before_next_job(self):
        target = {'pid': 21, 'starttime': 'target'}
        with tempfile.TemporaryDirectory() as folder:
            for native, valid in [([target], True), ([target, {'pid': 22, 'starttime': 'fixture'}], False)]:
                sampler = benchmark.ResourceSampler(Path(folder)/'resources.ndjson', {}, [target])
                sampler.stop.wait = lambda seconds: sampler.stop.set()
                outline = {'available': False, 'reason': 'already-exited'}
                with patch.object(benchmark, 'system_sample', return_value={'nativeInferenceProcesses': native}), \
                        patch.object(benchmark, 'process_outline', return_value=outline):
                    sampler.run()
                if valid:
                    sampler.assert_healthy()
                else:
                    with self.assertRaises(RuntimeError):
                        sampler.assert_healthy()
                self.assertEqual(json.loads(sampler.path.read_text())['nativeInferenceProcesses'], native)
                details = json.loads(sampler.path.read_text()).get('competingNativeInferenceDetails', [])
                self.assertEqual(details, [] if valid else [outline])

    def test_stale_startup_acceleration_cannot_be_attached_to_current_owner(self):
        owner = {'pid': 21, 'starttime': 'current', 'model': '9b', 'context': 4096, 'runtimeProfile': 'owned'}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'registry.json'
            entry = owner | {'acceleration': {'backend': 'vulkan', 'offloadedLayers': 32}, 'loadSeconds': 9}
            path.write_text(json.dumps({'llama': entry}))
            self.assertEqual(benchmark.startup_evidence(owner, path)['acceleration']['offloadedLayers'], 32)
            for change in [{'starttime': 'previous'}, {'context': 8192}, {'pid': 22}, {'model': '4b'}]:
                path.write_text(json.dumps({'llama': entry | change}))
                self.assertIsNone(benchmark.startup_evidence(owner, path))

    def test_coverage_counts_gaps_and_overlaps_without_double_counting(self):
        self.assertAlmostEqual(interval_coverage(100, 200, [(0, 120), (110, 150), (180, 220)]), .7)
        self.assertEqual(interval_coverage(100, 200, [(0, 300)]), 1)
        self.assertEqual(interval_coverage(100, 200, [(0, 100), (200, 300)]), 0)

    def test_extended_decode_budget_fits_real_four_k_context_count(self):
        owner = {'context': 4096}
        with patch.object(benchmark, 'request', return_value={'tokens': [0] * 2473}):
            _, count = benchmark.filled_prompt(owner, .6, 1536)
        self.assertEqual(count, 2473)
        self.assertLessEqual(count + 1536 + 64, owner['context'])

    def test_output_reserve_rejects_tokenizer_overshoot_and_keeps_old_default(self):
        owner = {'context': 4096}
        with patch.object(benchmark, 'request', return_value={'tokens': [0] * 3000}):
            self.assertEqual(benchmark.filled_prompt(owner, .6)[1], 3000)
            with self.assertRaisesRegex(ValueError, 'insufficient output reserve'):
                benchmark.filled_prompt(owner, .6, 1536)

    def test_impossible_fill_and_unbounded_output_are_rejected_before_tokenizing(self):
        with patch.object(benchmark, 'request') as network:
            for fraction, tokens in [(.8, 1536), (.6, 1537), (.6, True), (.6, 127)]:
                with self.subTest(fraction=fraction, tokens=tokens), self.assertRaises(ValueError):
                    benchmark.filled_prompt({'context': 4096}, fraction, tokens)
            network.assert_not_called()

    def test_fast_completion_is_observed_without_missing_first_content_signal(self):
        with tempfile.TemporaryDirectory() as folder:
            load = benchmark.ContinuousLlm({}, [], 'public fixture', Path(folder)/'llm.ndjson', 128)
            class Stream(io.BytesIO):
                def __exit__(self, *args):
                    load.stop.set()
                    return super().__exit__(*args)
            lines = [{'content': 'Public', 'stop': False}, {'content': ' text', 'stop': False},
                     {'content': '', 'stop': True, 'timings': {'predicted_n': 2, 'predicted_per_second': 30},
                      'tokens_predicted': 2, 'tokens_evaluated': 40, 'tokens_cached': 20}]
            raw = b''.join(b'data: '+json.dumps(line).encode()+b'\n\n' for line in lines)
            with patch.object(benchmark, 'assert_owner'), \
                    patch.object(benchmark.urllib.request, 'urlopen', return_value=Stream(raw)):
                load.start(); load.close()
            self.assertEqual(len(load.runs), 1)
            run = load.runs[0]
            self.assertEqual(run['tokensPredicted'], 2)
            self.assertEqual(run['tokensCached'], 20)
            self.assertEqual(run['rawTiming']['predicted_per_second'], 30)
            self.assertIsNone(run['visibleTokensPerSecond'])
            self.assertFalse(run['schedulerPauses'])

    def test_fixture_llama_on_another_port_invalidates_alone(self):
        with patch.object(benchmark, 'llama_processes', return_value=[{'pid': 21, 'starttime': 'fixture'}]):
            with self.assertRaises(RuntimeError):
                benchmark.assert_no_competing_llama()

    def test_only_the_expected_target_identity_is_allowed(self):
        owner = {'pid': 21, 'starttime': 'target'}
        with patch.object(benchmark, 'llama_processes', return_value=[owner]):
            benchmark.assert_no_competing_llama(owner)
        with patch.object(benchmark, 'llama_processes', return_value=[owner, {'pid': 22, 'starttime': 'fixture'}]):
            with self.assertRaises(RuntimeError):
                benchmark.assert_no_competing_llama(owner)
        with patch.object(benchmark, 'llama_processes', return_value=[owner | {'starttime': 'reused'}]):
            with self.assertRaises(RuntimeError):
                benchmark.assert_no_competing_llama(owner)

    def test_changed_owner_prevents_any_request(self):
        owner = {'pid': 123, 'starttime': 'old', 'model': '9b', 'context': 4096, 'runtimeProfile': 'pinned'}
        with patch.object(benchmark, 'inspect_llama', return_value=owner | {'starttime': 'new'}), \
                patch.object(benchmark, 'request') as network:
            with self.assertRaises(RuntimeError):
                benchmark.assert_owner(owner, [], idle=True)
            network.assert_not_called()

    def test_busy_slot_is_rejected_without_cancellation(self):
        owner = {'pid': 123, 'starttime': 'same', 'model': '9b', 'context': 4096, 'runtimeProfile': 'pinned'}
        with patch.object(benchmark, 'inspect_llama', return_value=owner), \
                patch.object(benchmark, 'request', return_value=[{'is_processing': True}]) as network:
            with self.assertRaises(RuntimeError):
                benchmark.assert_owner(owner, [], idle=True)
            network.assert_called_once_with('/slots')


class ListeningBoundaryTests(unittest.TestCase):
    def run_fixture(self, root, name, provider, reference='reference', arm='synthetic-control'):
        import numpy as np
        run = root/name; run.mkdir()
        audio = run/'unit-01-r0.wav'
        with wave.open(str(audio), 'wb') as stream:
            stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(24000)
            stream.writeframes((np.sin(np.arange(4800)*.2)*3200).astype('<i2').tobytes())
        manifest = {'status': 'measured-partial; no qualification',
                    'config': {'reference_arm': arm, 'voice': 'test'}, 'host': {'executionContext': 'native-host'},
                    'worker': {'provider': provider, 'referenceSha256': reference if provider != 'kokoro' else None}}
        record = {'id': 'unit-01-r0', 'status': 'ok', 'text': 'Take your time.', 'seed': 41,
                  'measurement': {'rawWav': {'file': audio.name, 'sha256': hashlib.sha256(audio.read_bytes()).hexdigest()}}}
        (run/'manifest.json').write_text(json.dumps(manifest))
        (run/'records.ndjson').write_text(json.dumps(record)+'\n')
        return run

    def test_pack_hides_labels_preserves_raw_and_never_claims_qualification(self):
        listening.AUDIT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=listening.AUDIT, prefix='listening-test-') as folder:
            root = Path(folder)
            runs = [self.run_fixture(root, 'one', 'kokoro'), self.run_fixture(root, 'two', 'sopro')]
            pack = root/'pack'
            study = listening.build(runs, pack, 41)
            self.assertFalse(study['qualification'])
            self.assertIsNone(study['participants'])
            page = (pack/'index.html').read_text()
            self.assertNotIn('kokoro', page)
            self.assertNotIn('sopro', page)
            key = json.loads((pack/'private-provider-key.json').read_text())
            self.assertEqual({entry['provider'] for entry in key}, {'kokoro', 'sopro'})
            for entry in key:
                original = Path(entry['run'])/(entry['take']+'.wav')
                raw = pack/(entry['id']+'-'+entry['label']+'-raw.wav')
                self.assertEqual(original.read_bytes(), raw.read_bytes())

    def test_reference_mismatch_and_mixed_arms_are_rejected(self):
        listening.AUDIT.mkdir(parents=True, exist_ok=True)
        for reference, arm in [('different-reference', 'synthetic-control'), ('reference', 'authorized-character')]:
            with tempfile.TemporaryDirectory(dir=listening.AUDIT, prefix='listening-test-') as folder:
                root = Path(folder)
                runs = [self.run_fixture(root, 'one', 'sopro'), self.run_fixture(root, 'two', 'moss', reference, arm)]
                with self.assertRaises(ValueError):
                    listening.build(runs, root/'pack', 41)
                self.assertFalse((root/'pack').exists())

    def test_changed_raw_audio_and_invalid_load_are_rejected(self):
        listening.AUDIT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=listening.AUDIT, prefix='listening-test-') as folder:
            root = Path(folder)
            run = self.run_fixture(root, 'one', 'kokoro')
            (run/'unit-01-r0.wav').write_bytes(b'changed')
            with self.assertRaises(ValueError):
                listening.load_run(run)
            manifest = json.loads((run/'manifest.json').read_text())
            manifest['status'] = 'invalid-load-cell'
            (run/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                listening.load_run(run)


if __name__ == '__main__':
    unittest.main()
