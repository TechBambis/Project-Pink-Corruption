# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Explicit Linux experiment: verified local assets, owned workers, public prompts.

Does not download models, change app settings, or use cloud. An explicit option
temporarily suspends and restores only a verified idle compatible app runner.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request

from accelerator_bridge import runtime_policy
from runtime_process import identity, listening_pids, prompt_cache_mib, save_state, registry, recover_llama, stop_llama, RUNTIME_PROFILE

ROOT = Path(__file__).resolve().parent.parent


def verified(path, asset):
    if path.is_symlink() or not path.is_file() or path.stat().st_size != asset['bytes']:
        raise RuntimeError('Missing or wrong-sized experiment asset: ' + str(path))
    with path.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if digest != asset['sha256']:
        raise RuntimeError('Experiment asset checksum mismatch: ' + str(path))


def host_snapshot(pid=None):
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemTotal:', 'MemAvailable:', 'SwapFree:'))}
    gpu = {}
    for path in Path('/sys/class/drm').glob('card*/device/mem_info_vram_*'):
        if path.name.endswith(('used', 'total')):
            with contextlib.suppress(OSError, ValueError):
                gpu[str(path)] = int(path.read_text().strip())
    rss = None
    if pid:
        with contextlib.suppress(OSError):
            match = re.search(r'^VmRSS:\s+(\d+) kB', Path(f'/proc/{pid}/status').read_text(), re.M)
            if match:
                rss = int(match[1]) * 1024
    return {'at': time.time(), 'memoryBytes': memory, 'vramBytes': gpu, 'workerRssBytes': rss}


def request(url, data=None, timeout=5):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def completion(url, data, timeout=180):
    started = time.perf_counter()
    req = urllib.request.Request(url + '/completion', data=json.dumps({**data, 'stream': True}).encode(), headers={'Content-Type': 'application/json'})
    text = ''
    first_ms = sentence_ms = None
    final = None
    with urllib.request.urlopen(req, timeout=min(timeout, 60)) as response:
        for raw in response:
            elapsed = (time.perf_counter() - started) * 1000
            if elapsed > timeout * 1000:
                raise TimeoutError('Experiment generation exceeded its deadline.')
            if not raw.startswith(b'data: '):
                continue
            value = raw[6:].strip()
            if value == b'[DONE]':
                break
            event = json.loads(value)
            if event.get('error'):
                raise RuntimeError(str(event['error']))
            chunk = event.get('content', '')
            if chunk and first_ms is None:
                first_ms = elapsed
            text += chunk
            visible = re.sub(r'\[[^\]]*\]', '', text)
            if sentence_ms is None and re.search(r'[.!?](?:["\u201d\u2019]?)(?:\s|$)', visible):
                sentence_ms = elapsed
            if event.get('stop'):
                final = event
    if final is None:
        raise RuntimeError('Stream ended without a confirmed final completion.')
    if not text.strip():
        raise RuntimeError('Empty experiment completion.')
    return {'text': text, 'firstTokenMs': first_ms, 'firstSentenceMs': sentence_ms,
            'wallMs': (time.perf_counter() - started) * 1000, 'timings': final.get('timings'),
            'tokensPredicted': final.get('tokens_predicted'), 'tokensEvaluated': final.get('tokens_evaluated'),
            'tokensCached': final.get('tokens_cached'), 'truncated': final.get('truncated'),
            'stoppedLimit': final.get('stopped_limit'), 'stopType': final.get('stop_type')}


class Worker:
    """One directly spawned child; terminate only that PID with matching starttime."""
    def __init__(self, command, env, directory, timeout=120):
        self.command, self.env, self.directory, self.timeout = command, env, directory, timeout
        self.process = None
        self.starttime = None
        self.log = None

    def __enter__(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        self.log = (self.directory / 'worker.log').open('wb', buffering=0)
        try:
            self.process = subprocess.Popen(self.command, cwd=ROOT, env=self.env, stdin=subprocess.DEVNULL,
                                            stdout=self.log, stderr=self.log, start_new_session=True)
            self.starttime = identity(self.process.pid)
            if self.starttime is None:
                raise RuntimeError('Experiment child did not start.')
            return self
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.process is not None and self.process.poll() is None:
            if identity(self.process.pid) == self.starttime:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if identity(self.process.pid) == self.starttime:
                        self.process.kill()
                    self.process.wait(timeout=5)
        if self.log is not None:
            self.log.close()

    def __exit__(self, *exc):
        self.close()

    def ready(self, url, port, context):
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError('Experiment worker exited during load; inspect ' + str(self.directory / 'worker.log'))
            # An HTTP response alone never establishes that this is our worker.
            if listening_pids(port) == [self.process.pid]:
                try:
                    props = request(url + '/props', timeout=1)
                except (OSError, ValueError):
                    props = None
                if props:
                    if props.get('default_generation_settings', {}).get('n_ctx') != context:
                        raise RuntimeError('Experiment runtime changed the required full context.')
                    return props
            time.sleep(.2)
        raise TimeoutError('Experiment worker did not become ready within the bounded load deadline.')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def offloads(log):
    return [{'offloadedLayers': int(a), 'totalLayers': int(b)} for a, b in re.findall(r'offloaded\s+(\d+)\s*/\s*(\d+)\s+layers to GPU', log)]


def experiment_config(profile):
    filenames = {'9b': 'speculative-experiments.json', '4b': 'speculative-4b-experiment.json', '4b-mtp': 'speculative-4b-mtp-experiment.json'}
    if profile not in filenames:
        raise ValueError('Unknown experiment profile.')
    config = json.loads((ROOT / 'config' / filenames[profile]).read_text())
    if config.get('status') != 'experiment-only':
        raise RuntimeError('Only explicit experiment manifests are accepted.')
    target = config.get('target') or next(p for p in json.loads((ROOT / 'config/local-model-catalog.json').read_text()) if p['alias'] == config['targetAlias'])
    if target['alias'] != config['targetAlias']:
        raise RuntimeError('Experiment target alias mismatch.')
    for asset in [target, config['draft']]:
        if not re.fullmatch(r'[\w.-]+\.gguf', asset['file']) or not re.fullmatch(r'[0-9a-f]{64}', asset['sha256']):
            raise RuntimeError('Invalid pinned experiment asset.')
    return config, target


def mode_options(mode, draft, draft_tokens):
    cache = 'q8_0' if mode in ['kv-q8', 'dflash-q8'] else 'f16'
    arguments = []
    if mode in ['dflash', 'dflash-cpu', 'dflash-q8']:
        arguments = ['--spec-type', 'draft-dflash', '--spec-draft-model', str(draft), '--spec-draft-n-max', str(draft_tokens)]
        if mode == 'dflash-cpu':
            arguments += ['--spec-draft-device', 'none', '--spec-draft-ngl', '0', '--spec-draft-threads', '2']
    elif mode == 'ngram':
        arguments = ['--spec-type', 'ngram-simple', '--spec-draft-n-max', str(draft_tokens)]
    elif mode == 'mtp':
        arguments = ['--spec-type', 'draft-mtp', '--spec-draft-n-max', str(draft_tokens)]
    elif mode not in ['baseline', 'kv-q8']:
        raise ValueError('Unknown isolated experiment mode.')
    return cache, arguments


@contextlib.contextmanager
def suspend_idle_runner(allowed, output):
    """Explicit experiment option; preserve the compatible idle app runner."""
    entry = None
    stopped = False
    requested = 'auto'
    # Native launchers use this same owner lock. Acquire before the idle audit
    # and retain through the measurement, preventing an app warmup race.
    lease = (ROOT / 'runtime/lifecycle.lock').open('a')
    try:
        fcntl.flock(lease, fcntl.LOCK_EX)
        if listening_pids(8080):
            if not allowed:
                raise RuntimeError('An existing local runner is listening; use --suspend-idle-owned only for an authorized comparison.')
            pins = registry(ROOT)
            statepath = ROOT / 'runtime/owned-processes.json'
            entry = recover_llama(ROOT, pins, RUNTIME_PROFILE)
            if entry is None or entry['runtimeProfile'] != RUNTIME_PROFILE:
                raise RuntimeError('Existing runner ownership/profile is not compatible; nothing stopped.')
            slots = request('http://127.0.0.1:8080/slots')
            if not isinstance(slots, list) or not slots or any(slot.get('is_processing') is not False for slot in slots):
                raise RuntimeError('Existing local runner is busy or cannot report idle state; nothing stopped.')
            state = json.loads(statepath.read_text()) if statepath.exists() else {}
            if not isinstance(state, dict):
                raise RuntimeError('Invalid application process registry; nothing stopped.')
            saved = state.get('llama', {})
            if saved.get('pid') == entry['pid'] and saved.get('starttime') == entry['starttime']:
                requested = saved.get('requested', 'auto')
            if requested not in ['auto', 'cpu']:
                raise RuntimeError('Unknown original accelerator mode; nothing stopped.')
            stop_llama(ROOT, entry, pins, RUNTIME_PROFILE)
            stopped = True
            if saved.get('pid') == entry['pid']:
                state.pop('llama', None)
                save_state(statepath, state)
            print('Suspended verified idle application runner for isolated experiment.', flush=True)
        yield
    finally:
        fcntl.flock(lease, fcntl.LOCK_UN)
        lease.close()
        if stopped:
            print('Restoring the original application model/context through its normal launcher.', flush=True)
            env = dict(os.environ)
            env['BAMBI_ACCELERATOR'] = requested
            cache = 'q8_0' if entry.get('cacheType') == 'q8_0' and entry['model'] == 'bambi-qwen35-9b-hauhau:q4_k_m' else 'default'
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/llama-runtime.py'), 'start',
                                     '--kv-cache', cache,
                                     '--dflash', entry.get('dflash', 'off'),
                                     '--model', entry['model'], '--context', str(entry['context'])],
                                    cwd=ROOT, env=env, capture_output=True, text=True)
            restored = result.returncode == 0
            path = output / 'report.json'
            if path.exists():
                report = json.loads(path.read_text())
                report['applicationRunner'] = {'model': entry['model'], 'context': entry['context'], 'requested': requested, 'restored': restored}
                save_state(path, report)
            if not restored:
                raise RuntimeError('Application runner restore failed: ' + result.stdout[-1200:] + result.stderr[-1200:])
            print('Original application runner restored.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='Explicitly authorize local fixture inference (no download).')
    parser.add_argument('--output', default='runtime/speculative-experiment')
    parser.add_argument('--modes', default='baseline,dflash')
    parser.add_argument('--profile', choices=['9b', '4b', '4b-mtp'], default='9b', help='Pinned experiment assets; never changes the app catalog/selection.')
    parser.add_argument('--batch-size', type=int, choices=[512, 1024, 2048], default=512)
    parser.add_argument('--ubatch-size', type=int, choices=[64, 128, 256, 512], default=128)
    parser.add_argument('--draft-tokens', type=int, default=3)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--request-timeout', type=int, default=180)
    parser.add_argument('--verbosity', type=int, default=4, help='Include native model/offload evidence (upstream trace level 4).')
    parser.add_argument('--cases', help='Optional comma-separated fixture IDs for a focused follow-up.')
    parser.add_argument('--reserve-mib', type=int, default=1024, help='Device fitting reserve; larger values can simulate less available headroom.')
    parser.add_argument('--suspend-idle-owned', action='store_true', help='Temporarily suspend and restore only a verified idle compatible app runner.')
    parser.add_argument('--allow-idle-ollama', action='store_true', help='Permit an idle Ollama daemon only when /api/ps confirms no loaded models; the native lifecycle lease stays held.')
    args = parser.parse_args()
    if not args.run:
        parser.error('Use --run for the explicit local benchmark, after setup and fixture generation.')
    modes = args.modes.split(',')
    if len(modes) != len(set(modes)) or any(m not in ['baseline', 'dflash', 'dflash-cpu', 'dflash-q8', 'ngram', 'kv-q8', 'mtp'] for m in modes):
        parser.error('Unknown isolated experiment mode.')
    if 'mtp' in modes and args.profile != '4b-mtp':
        parser.error('MTP requires the reviewed head-bearing 4b-mtp experiment profile.')
    if not 1 <= args.repeats <= 10 or not 1 <= args.draft_tokens <= 15 or not 30 <= args.request_timeout <= 600 or args.verbosity not in [3, 4] or not 1024 <= args.reserve_mib <= 2048:
        parser.error('Experiment bounds: repeats 1–10, draft tokens 1–15, request timeout 30–600 seconds, verbosity 3/4, reserve 1024–2048 MiB.')
    directory = Path(args.output).resolve()
    if not directory.is_relative_to((ROOT / 'runtime').resolve()):
        parser.error('Keep generated experiment data under ignored runtime/.')
    if not (directory / 'fixtures.json').is_file():
        parser.error('Generate public fixtures in the output directory first.')
    with suspend_idle_runner(args.suspend_idle_owned, directory):
        run_benchmark(args, modes, directory)


def run_benchmark(args, modes, directory):
    config, target = experiment_config(args.profile)
    weight = ROOT / 'models/community' / target['file']
    draft = ROOT / 'models/speculative' / config['draft']['file']
    verified(weight, target)
    if any(m.startswith('dflash') for m in modes):
        verified(draft, config['draft'])
    fixtures = json.loads((directory / 'fixtures.json').read_text())
    if args.cases:
        requested = args.cases.split(',')
        selected = [f for f in fixtures['fixtures'] if f['id'] in requested]
        if len(requested) != len(set(requested)) or len(selected) != len(requested):
            raise RuntimeError('Unknown or duplicate requested fixture IDs.')
        fixtures['fixtures'] = selected
    # Respect the production single-local-runner policy; do not evict active workers.
    for port in [8080, 11434]:
        if listening_pids(port):
            if port == 11434 and getattr(args, 'allow_idle_ollama', False):
                loaded = request('http://127.0.0.1:11434/api/ps')
                if isinstance(loaded, dict) and loaded.get('models') == []:
                    continue
            raise RuntimeError(f'An existing local inference service listens on {port}; no service was stopped.')
    binary = ROOT / '.runtime/lib/ollama/llama-server'
    plan = runtime_policy(ROOT, 'plan', options={'command': {'executable': str(binary)}, 'library': str(binary.parent),
                                               'platform': 'linux', 'environment': dict(os.environ), 'mode': 'auto', 'context': config['context']})
    attempt = next((a for a in plan['attempts'] if a['device'] and a['device']['backend'] == 'vulkan'), None)
    if attempt is None:
        raise RuntimeError('No owned Vulkan device available for this hardware experiment.')
    attempt['args'][attempt['args'].index('--fit-target') + 1] = str(args.reserve_mib)
    version = subprocess.run([str(binary), '--version'], capture_output=True, text=True, timeout=10, check=True)
    report = {'scope': fixtures['scope'], 'qualification': 'diagnostic-local-inference-only; no speech or human quality certification',
              'profile': args.profile, 'target': target, 'draft': config['draft'], 'context': config['context'], 'device': attempt['device'],
              'runtimeVersion': (version.stdout + version.stderr).strip(),
              'hostBefore': host_snapshot(), 'draftTokens': args.draft_tokens, 'repeats': args.repeats,
              'fixtureIds': [f['id'] for f in fixtures['fixtures']], 'verbosity': args.verbosity,
              'reserveMiB': args.reserve_mib, 'runs': []}
    save_state(directory / 'report.json', report)
    for mode in modes:
        run = {'mode': mode, 'results': [], 'status': 'loading'}
        cache, speculative_arguments = mode_options(mode, draft, args.draft_tokens)
        run['cacheType'] = cache
        report['runs'].append(run)
        port = free_port()
        url = f'http://127.0.0.1:{port}'
        command = [str(binary), '-m', str(weight), '--alias', target['alias'], '--host', '127.0.0.1', '--port', str(port),
                   '--ctx-size', str(config['context']), '--parallel', '1', '--batch-size', str(args.batch_size), '--ubatch-size', str(args.ubatch_size),
                   '--poll', '0', '--poll-batch', '0', '--ctx-checkpoints', '16', '--checkpoint-min-step', '512',
                   '--cache-ram', str(config.get('promptCacheMiB', prompt_cache_mib(target['alias']))), '--cache-type-k', cache, '--cache-type-v', cache,
                   '--flash-attn', 'on', '--jinja', '--reasoning', 'off', '--no-webui', '--verbosity', str(args.verbosity), *attempt['args']]
        command += speculative_arguments
        run['command'] = command
        started = time.perf_counter()
        try:
            with Worker(command, attempt['environment'], directory / mode) as worker:
                worker.ready(url, port, config['context'])
                run['loadMs'] = (time.perf_counter() - started) * 1000
                request(url + '/completion', {'prompt': 'A public runtime test.', 'n_predict': 1, 'temperature': 0, 'cache_prompt': False}, timeout=30)
                run['hostLoaded'] = host_snapshot(worker.process.pid)
                for repeat in range(args.repeats):
                    for fixture in fixtures['fixtures']:
                        formatted = request(url + '/apply-template', {'messages': fixture['messages']}, timeout=15)['prompt']
                        input_tokens = len(request(url + '/tokenize', {'content': formatted, 'add_special': False}, timeout=15)['tokens'])
                        if input_tokens + fixture['nPredict'] + 256 > config['context']:
                            raise RuntimeError('Complete fixture exceeds full context with output and safety reserve.')
                        payload = {**fixture['params'], 'prompt': formatted, 'n_predict': fixture['nPredict'],
                                   'cache_prompt': True, 'seed': 104 + repeat}
                        result = completion(url, payload, args.request_timeout)
                        if result['truncated']:
                            raise RuntimeError('Runtime truncated a fixture.')
                        result.update({'case': fixture['id'], 'sampling': fixture['sampling'], 'repeat': repeat,
                                       'seed': 104 + repeat, 'inputTokens': input_tokens, 'hostAfter': host_snapshot(worker.process.pid)})
                        run['results'].append(result)
                        save_state(directory / 'report.json', report)
                        print(json.dumps({'mode': mode, 'case': fixture['id'], 'repeat': repeat,
                                          'firstTokenMs': result['firstTokenMs'], 'timings': result['timings']}), flush=True)
                run['status'] = 'completed'
        except (OSError, ValueError, RuntimeError, TimeoutError) as error:
            run.update({'status': 'failed', 'error': str(error)})
            print(json.dumps({'mode': mode, 'status': 'failed', 'error': str(error)}), flush=True)
        finally:
            logpath = directory / mode / 'worker.log'
            log = logpath.read_text(errors='replace') if logpath.exists() else ''
            run['offloads'] = offloads(log)
            run['speculativeLogSummary'] = [line[-1000:] for line in log.splitlines() if re.search(r'drafted|accepted|draft.*(?:time|token|rate)', line, re.I)][-30:]
            run['hostAfterStop'] = host_snapshot()
            save_state(directory / 'report.json', report)
    baseline = next((r for r in report['runs'] if r['mode'] == 'baseline' and r['status'] == 'completed'), None) or next((r for r in report['runs'] if r['mode'] == 'kv-q8' and r['status'] == 'completed'), None)
    if baseline:
        report['pairedOutputEquality'] = []
        for run in report['runs']:
            if run is baseline:
                continue
            for item in run['results']:
                original = next((r for r in baseline['results'] if (r['case'], r['repeat']) == (item['case'], item['repeat'])), None)
                if original:
                    report['pairedOutputEquality'].append({'mode': run['mode'], 'case': item['case'], 'repeat': item['repeat'],
                                                          'equal': original['text'] == item['text'], 'sampling': item['sampling']})
    report['hostAfter'] = host_snapshot()
    save_state(directory / 'report.json', report)
    print('Saved diagnostic report: ' + str(directory / 'report.json'), flush=True)
    if any(run['status'] != 'completed' for run in report['runs']):
        raise SystemExit(1)


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Experiment interrupted; owned worker cleanup follows.')
    signal.signal(signal.SIGTERM, interrupted)
    main()
