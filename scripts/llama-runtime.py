# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Owned llama.cpp runner with shared acceleration policy; reuses verified local GGUFs without copying weights."""
import argparse
import fcntl
import json
import hashlib
import os
from pathlib import Path
import signal
import sys
import traceback
import shutil
import socket
import subprocess
import time
import urllib.request
from accelerator_bridge import runtime_policy
from runtime_process import identity, inspect_llama, recover_llama, registry, save_state, stop_llama, prompt_cache_mib, model_contexts, context_cache_type, dflash_asset, speculative_options, RUNTIME_PROFILE

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
RUNTIME = ROOT / 'runtime'
RUNTIME.mkdir(exist_ok=True)
def request(path, data=None, timeout=2):
    try:
        payload = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(path, data=payload, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except Exception:
        return None

def ready(entry):
    if identity(entry['pid']) != entry['starttime'] or not request('http://127.0.0.1:8080/health'):
        return False
    models = request('http://127.0.0.1:8080/v1/models') or {}
    props = request('http://127.0.0.1:8080/props') or {}
    return any(item.get('id') == entry['model'] for item in models.get('data', [])) and props.get('default_generation_settings', {}).get('n_ctx') == entry['context']


class RuntimeFailure(RuntimeError):
    def __init__(self, message, kind):
        super().__init__(message)
        self.kind = kind


def verify_inference(context):
    props = request('http://127.0.0.1:8080/props')
    if not props or props.get('default_generation_settings', {}).get('n_ctx') != context:
        raise RuntimeFailure('Local AI changed the selected full context. Preparation stopped.', 'invariant')
    started = time.perf_counter()
    result = request('http://127.0.0.1:8080/completion', {
        'prompt': 'A public runtime test.', 'n_predict': 1, 'stream': False,
        'temperature': 0, 'cache_prompt': False}, timeout=30)
    if not result or not isinstance(result.get('content'), str) or type(result.get('tokens_predicted')) is not int or result['tokens_predicted'] < 1:
        raise RuntimeFailure('Local AI failed its inference check. See runtime/llama.log.', 'inference')
    return round((time.perf_counter() - started) * 1000)


def current_log(start):
    with (RUNTIME / 'llama.log').open('rb') as stream:
        stream.seek(0, 2)
        stream.seek(max(start, stream.tell() - 65536))
        return stream.read().decode('utf-8', errors='replace')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['start', 'stop'])
    parser.add_argument('--model', default='bambi-qwen35-9b-hauhau:q4_k_m')
    parser.add_argument('--context', type=int, default=16384)
    parser.add_argument('--cpu-moe', type=int, default=30)
    parser.add_argument('--kv-cache', choices=['default', 'q8_0'], default='default')
    parser.add_argument('--dflash', choices=['off', 'on'], default='off')
    parser.add_argument('--tuning', help='Validated local calibration settings, never a command line')
    parser.add_argument('--require-empty-slot', action='store_true', help='Research admission: refuse to replace a live native or Ollama model')
    args = parser.parse_args()
    if args.require_empty_slot and args.command != 'start':
        parser.error('--require-empty-slot applies only to start')
    mode = os.environ.get('BAMBI_ACCELERATOR', 'auto')
    tuning = runtime_policy(ROOT, 'tuning', value=json.loads(args.tuning)) if args.tuning else None
    if tuning:
        catalog_path = ROOT / 'config/local-model-catalog.json'
        supported = [pin['alias'] for pin in json.loads(catalog_path.read_text()) if pin.get('desktopSupported') and pin.get('license') in ['apache-2.0', 'lfm1.0']] if catalog_path.is_file() else []
        if args.command != 'start' or args.model not in supported or args.dflash != 'off' or args.kv_cache != 'default':
            raise RuntimeError('Measured settings apply only to supported catalog models with their baseline cache and decoding.')
        if 'cpuMoeLayers' in tuning:
            if '35b' not in args.model:
                raise RuntimeError('CPU expert placement requires a matching MoE model.')
            args.cpu_moe = tuning['cpuMoeLayers']
        mode = tuning['accelerator']
    if args.command == 'start' and mode not in ['auto', 'cpu']:
        raise RuntimeError('Choose Automatic or CPU acceleration.')

    pins = registry(ROOT)
    model = None
    weight = None
    memory_limit = None
    draft_path = None
    if args.command == 'start':
        model = next((pin for pin in pins if pin['alias'] == args.model), None)
        if model is None:
            raise RuntimeError('The selected model is not in the pinned local registry.')
        if args.context not in model_contexts(model):
            raise RuntimeError('The selected context is not supported by this model runtime profile.')
        weight = ROOT / 'models/community' / model['file']
        if not weight.is_file() or weight.stat().st_size != model['bytes']:
            raise RuntimeError('The selected GGUF is not installed. Run its model setup first, then retry preparation.')
        if not (ROOT / '.runtime/lib/ollama/llama-server').is_file():
            raise RuntimeError('The local llama.cpp runner is not installed. Run the documented Linux setup first.')
        cache = context_cache_type(model, args.context, args.kv_cache)
        speculative = speculative_options(model)
        draft = dflash_asset(ROOT, args.model, args.dflash)
        if draft:
            if mode != 'auto':
                raise RuntimeError('Choose Automatic GPU acceleration to test DFlash.')
            draft_path = ROOT / 'models/speculative' / draft['file']
            if not draft_path.resolve().is_relative_to((ROOT / 'models').resolve()) or draft_path.is_symlink() or not draft_path.is_file() or draft_path.stat().st_size != draft['bytes']:
                raise RuntimeError('The verified DFlash helper is missing. Run the explicit 4B experiment setup first.')
            with draft_path.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            if digest != draft['sha256']:
                raise RuntimeError('DFlash helper checksum mismatch. Existing AI was not stopped.')
    with (RUNTIME / 'lifecycle.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        statepath = RUNTIME / 'owned-processes.json'
        try:
            state = json.loads(statepath.read_text()) if statepath.exists() else {}
        except json.JSONDecodeError:
            raise RuntimeError('Process registry is invalid. Check runtime/owned-processes.json before retrying.') from None
        if not isinstance(state, dict):
            raise RuntimeError('Process registry is invalid; check runtime/owned-processes.json.')
        entry = state.get('llama')
        verified = inspect_llama(ROOT, entry.get('pid'), pins, RUNTIME_PROFILE) if isinstance(entry, dict) and identity(entry.get('pid')) == entry.get('starttime') else None
        recovered = recover_llama(ROOT, pins, RUNTIME_PROFILE)
        if recovered:
            entry = {**(entry if isinstance(entry, dict) and entry.get('pid') == recovered['pid'] else {}), **recovered}
            state['llama'] = entry
            save_state(statepath, state)
        elif verified:
            entry = {**entry, **verified}
        alive = bool(recovered or verified)
        if args.require_empty_slot and alive:
            raise RuntimeError('Research requires an empty inference slot. No existing native model was stopped.')
        if alive and args.command == 'start' and entry.get('runtimeProfile') == RUNTIME_PROFILE and entry.get('model') == args.model and entry.get('context') == args.context and entry.get('cacheType') == cache and entry.get('dflash', 'off') == args.dflash and ('35b' not in args.model or entry.get('cpuMoeLayers') == args.cpu_moe) and entry.get('requested', 'auto') == mode and entry.get('tuning') == tuning and ready(entry):
            print('Owned llama.cpp ready', flush=True)
            raise SystemExit(0)
        if args.command == 'start' and '35b' in args.model:
            available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
            memory_limit = min((32 if tuning else 8) * 1024**3, available - 1536 * 1024**2)
            if memory_limit < 3 * 1024**3 or not shutil.which('systemd-run'):
                raise RuntimeError('35B requires at least 4.5 GiB available RAM and a user memory scope')
        if args.command == 'start' and ('-mtp-' in args.model or model.get('resource_plan')):
            if weight.is_symlink() or not weight.resolve().is_relative_to((ROOT / 'models').resolve()):
                raise RuntimeError('MTP model must be a verified local model file.')
            with weight.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            if digest != model.get('sha256'):
                raise RuntimeError('Model checksum mismatch. Existing AI was not stopped.')
            notice = model.get('licenseNotice')
            if notice:
                path = ROOT / 'models' / notice['path']
                if path.is_symlink() or not path.is_file() or path.stat().st_size != notice['bytes'] or not path.resolve().is_relative_to((ROOT / 'models').resolve()):
                    raise RuntimeError('The pinned model license notice is missing. Run the small-model setup first.')
                with path.open('rb') as source:
                    if hashlib.file_digest(source, 'sha256').hexdigest() != notice['sha256']:
                        raise RuntimeError('Model license notice checksum mismatch. Existing AI was not stopped.')
        if args.command == 'start' and model.get('resource_plan'):
            total = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:'))) * 1024
            profile = model['resource_plan']
            if profile['estimatedWorkingBytes'] > total - profile['reserveBytes']:
                raise RuntimeError('This model exceeds the full-context memory budget. Existing AI was not stopped.')
        if alive:
            stop_llama(ROOT, entry, pins, RUNTIME_PROFILE)
        previous_acceleration = entry.get('acceleration', {}) if isinstance(entry, dict) else {}
        state.pop('llama', None)
        save_state(statepath, state)
        if args.command == 'stop':
            print('Owned llama.cpp stopped', flush=True)
            raise SystemExit(0)
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', 8080)) == 0:
                raise RuntimeError('Port 8080 is occupied by a service whose project ownership could not be verified. Stop it through its own controls, then retry preparation.')
        # A single GPU cannot hold both runners; unload only models served by this local Ollama.
        loaded = request('http://127.0.0.1:11434/api/ps')
        if args.require_empty_slot:
            if loaded is None:
                with socket.socket() as probe:
                    if probe.connect_ex(('127.0.0.1', 11434)) == 0:
                        raise RuntimeError('Ollama occupancy could not be verified. No model was unloaded.')
            elif loaded.get('models'):
                raise RuntimeError('Research requires an empty inference slot. No Ollama model was unloaded.')
        loaded = loaded or {'models': []}
        for resident in loaded['models']:
            request('http://127.0.0.1:11434/api/generate', {'model': resident['name'], 'keep_alive': 0})
        binary = ROOT / '.runtime/lib/ollama/llama-server'
        library = binary.parent
        session = os.environ.get('BAMBI_RUNTIME_SESSION', f'standalone:{os.getppid()}:{identity(os.getppid())}')
        accelerator = state.get('accelerator', {})
        same_session = accelerator.get('session') == session
        if not same_session:
            accelerator = {'session': session, 'blocked': []}
        previous = previous_acceleration
        if not alive and previous.get('inferenceVerified') and previous.get('deviceKey') and same_session:
            if previous['deviceKey'] not in accelerator['blocked']:
                accelerator['blocked'].append(previous['deviceKey'])
            accelerator['lastFailure'] = 'gpu-runtime-stopped'
        state['accelerator'] = accelerator
        save_state(statepath, state)
        plan = runtime_policy(ROOT, 'plan', options={
            'command': {'executable': str(binary)}, 'library': str(library),
            'platform': 'linux', 'environment': dict(os.environ), 'mode': mode,
            'context': args.context, 'blocked': accelerator['blocked'],
            **({'devices': accelerator['devices']} if 'devices' in accelerator else {}),
            **({'deviceId': tuning['deviceId']} if tuning and 'deviceId' in tuning else {})})
        if mode == 'auto':
            accelerator['devices'] = plan.get('devices', [])
        state['accelerator'] = accelerator
        save_state(statepath, state)
        fallback_reason = plan.get('fallbackReason')
        if mode == 'auto' and len(plan['attempts']) == 1 and accelerator['blocked']:
            fallback_reason = accelerator.get('lastFailure', fallback_reason)
        failures = []
        sampling = model.get('runtime', {}).get('sampling', {})
        command = [str(binary), '-m', str(weight), '--alias', args.model,
            '--host', '127.0.0.1', '--port', '8080', '--ctx-size', str(args.context),
            '--parallel', '1', '--batch-size', str(model.get('runtime', {}).get('batch_size', 512)), '--ubatch-size', str(model.get('runtime', {}).get('ubatch_size', 128)),
            '--poll', '0', '--poll-batch', '0',
            '--ctx-checkpoints', str(model.get('runtime', {}).get('checkpoints', 16)), '--checkpoint-min-step', '512', '--cache-ram', str(prompt_cache_mib(args.model, model)),
            '--flash-attn', 'on', '--jinja', '--reasoning', 'off',
            '--no-webui',
            '--temp', str(sampling.get('temperature', 1)), '--top-p', str(sampling.get('top_p', .95)), '--top-k', str(sampling.get('top_k', 50)), '--min-p', str(sampling.get('min_p', .05)),
            '--repeat-penalty', str(sampling.get('repeat_penalty', 1)), '--presence-penalty', '0', '--frequency-penalty', '0',
            '--dry-multiplier', str(sampling.get('dry_multiplier', .8)), '--dry-base', '1.75', '--dry-allowed-length', '2',
            '--xtc-probability', str(sampling.get('xtc_probability', .4)), '--xtc-threshold', '.1', '--n-predict', '8192']
        if '35b' in args.model:
            command += ['--n-cpu-moe', str(args.cpu_moe)]
        command += ['--cache-type-k', cache, '--cache-type-v', cache]
        if model.get('resource_plan'):
            command += ['--chat-template-kwargs', '{"enable_thinking":false}', '--verbosity', '4']
        if args.require_empty_slot or tuning or args.model.startswith('bambi-qwen35-4b-hauhau') or args.model.startswith('bambi-qwen35-9b-'):
            # Upstream level 3 omits model offload evidence; retain the measured
            # GPU configuration and report actual layers instead of guessing.
            # Explicit research admission needs this evidence for any model.
            command += ['--verbosity', '4']
        if draft_path:
            command += ['--spec-type', 'draft-dflash', '--spec-draft-model', str(draft_path), '--spec-draft-n-max', '3']
        command += speculative
        if tuning:
            for flag, value in [('--batch-size', tuning['batchSize']), ('--ubatch-size', tuning['microBatchSize'])]:
                command[command.index(flag) + 1] = str(value)
        for attempt_number, attempt in enumerate(plan['attempts'], 1):
            if tuning:
                for flag in ['--threads', '--threads-batch']:
                    attempt['args'][attempt['args'].index(flag) + 1] = str(tuning['threads'])
            device = attempt['device']
            if device is None and model.get('resource_plan'):
                available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
                if available < model['resource_plan']['estimatedWorkingBytes'] + 256 * 1024**2:
                    raise RuntimeError('Not enough available RAM for full-context CPU inference. Close other apps and retry; verified model files are kept.')
            env = attempt['environment']
            launch_command = [*command, *attempt['args']]
            unit = None
            if '35b' in args.model:
                unit = 'bambi-local-llama-' + str(time.time_ns())
                launch_command = ['systemd-run', '--user', '--quiet', '--scope', '--unit', unit,
                    '--property=MemoryMax=' + str(memory_limit), '--property=MemorySwapMax=0', *launch_command]
            log = (RUNTIME / 'llama.log').open('ab', buffering=0)
            log_start = log.tell()
            load_start = time.perf_counter()
            process = None
            prepared = False
            try:
                process = subprocess.Popen(launch_command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=log, start_new_session=True)
                state['llama'] = {'root': str(ROOT), 'pid': process.pid, 'starttime': identity(process.pid), 'tuning': tuning,
                    'command': launch_command, 'model': args.model, 'context': args.context,
                    'memoryLimitBytes': memory_limit, 'scope': unit, 'cpuMoeLayers': args.cpu_moe if unit else 0,
                    'cacheType': cache, 'dflash': args.dflash, 'runtimeProfile': RUNTIME_PROFILE, 'requested': mode}
                save_state(statepath, state)
                until = time.monotonic() + 110
                while time.monotonic() < until and process.poll() is None:
                    models = request('http://127.0.0.1:8080/v1/models') or {}
                    if any(item.get('id') == args.model for item in models.get('data', [])):
                        inference_ms = verify_inference(args.context)
                        actual = recover_llama(ROOT, pins, RUNTIME_PROFILE)
                        if actual:
                            state['llama'].update(actual)
                        if process.poll() is not None and not actual:
                            raise RuntimeFailure('Owned AI stopped after inference.', 'exit')
                        result = runtime_policy(ROOT, 'result', log=current_log(log_start), failure='inference', device=device)
                        evidence = result['evidence']
                        backend = 'cpu' if device is None else device['backend'] if evidence and evidence['offloadedLayers'] > 0 else 'cpu' if evidence else 'unverified'
                        if tuning and 'deviceId' in tuning and (not evidence or evidence['offloadedLayers'] == 0):
                            raise RuntimeError('The selected GPU path did not provide verified offloading. No CPU fallback was substituted.')
                        state['llama']['acceleration'] = {
                            'requested': mode, 'backend': backend, 'device': device['id'] if device else None, 'deviceKey': result.get('key') if device else None, 'deviceName': device.get('name') if device else None,
                            **({'cudaVersion': result['cudaVersion']} if backend == 'cuda' and result.get('cudaVersion') else {}),
                            'inferenceVerified': True, 'inferenceMs': inference_ms, 'attempts': attempt_number,
                            'failures': failures, 'fallbackReason': 'runtime-selected-cpu' if device and evidence and evidence['offloadedLayers'] == 0 else fallback_reason,
                            **(evidence or {}), **({'offloadedLayers': 0} if device is None else {})}
                        state['llama']['loadSeconds'] = time.perf_counter() - load_start
                        save_state(statepath, state)
                        prepared = True
                        print(json.dumps({'ready': True, **state['llama']}), flush=True)
                        return
                    time.sleep(.3)
                raise RuntimeFailure('The local model did not become ready. See runtime/llama.log and retry preparation.', 'exit' if process.poll() is not None else 'timeout')
            except RuntimeFailure as error:
                result = runtime_policy(ROOT, 'result', log=current_log(log_start), failure=error.kind, device=device) if device and error.kind != 'invariant' else None
                if not result or not result['reason']:
                    raise
                fallback_reason = result['reason']
                accelerator['blocked'].append(result['key'])
                accelerator['lastFailure'] = fallback_reason
                failures.append({'backend': device['backend'], 'device': device['id'], 'reason': fallback_reason})
                save_state(statepath, state)
            finally:
                try:
                    if process is not None and not prepared:
                        current = inspect_llama(ROOT, process.pid, pins, RUNTIME_PROFILE)
                        # systemd-run can put the actual server in a separate scope;
                        # its PID and process group differ from the launcher's.
                        if current is None:
                            current = recover_llama(ROOT, pins, RUNTIME_PROFILE)
                            if current and (current['model'] != args.model or current['context'] != args.context):
                                current = None
                        if current:
                            stop_llama(ROOT, current, pins, RUNTIME_PROFILE)
                        if process.poll() is None:
                            # The launcher was created by this invocation and is still its child.
                            try:
                                os.killpg(process.pid, signal.SIGTERM)
                                process.wait(timeout=5)
                            except subprocess.TimeoutExpired:
                                os.killpg(process.pid, signal.SIGKILL)
                                process.wait(timeout=5)
                            except ProcessLookupError:
                                pass
                        if unit:
                            # The scoped server may still be loading weights before it
                            # opens a socket. This unit was created by this invocation.
                            try:
                                subprocess.run(['systemctl', '--user', 'kill', '--kill-whom=all',
                                    '--signal=SIGKILL', unit + '.scope'], stdout=log, stderr=log, timeout=5)
                            except (OSError, subprocess.TimeoutExpired) as error:
                                raise RuntimeError('Could not clean up the cancelled model scope. Check runtime/llama.log before retrying.') from error
                        state.pop('llama', None)
                        save_state(statepath, state)
                finally:
                    log.close()


def cancelled(_signum, _frame):
    raise KeyboardInterrupt


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    try:
        main()
    except KeyboardInterrupt:
        print(json.dumps({'error':'cancelled','message':'Local model preparation was cancelled.'}),file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        with (RUNTIME / 'llama.log').open('a') as log:
            traceback.print_exc(file=log)
        print(json.dumps({'error':'native-runtime','message':str(error)}),file=sys.stderr)
        sys.exit(1)
