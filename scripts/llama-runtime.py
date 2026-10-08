# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Owned llama.cpp Vulkan runner; reuses verified local GGUFs without copying weights."""
import argparse
import fcntl
import json
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
from runtime_process import identity, inspect_llama, recover_llama, registry, save_state, stop_llama, prompt_cache_mib, model_contexts, context_cache_type, RUNTIME_PROFILE

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
RUNTIME = ROOT / 'runtime'
RUNTIME.mkdir(exist_ok=True)
def request(path, data=None):
    try:
        payload = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(path, data=payload, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=2) as response:
            return json.load(response)
    except Exception:
        return None

def ready(entry):
    if identity(entry['pid']) != entry['starttime'] or not request('http://127.0.0.1:8080/health'):
        return False
    models = request('http://127.0.0.1:8080/v1/models') or {}
    props = request('http://127.0.0.1:8080/props') or {}
    return any(item.get('id') == entry['model'] for item in models.get('data', [])) and props.get('default_generation_settings', {}).get('n_ctx') == entry['context']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['start', 'stop'])
    parser.add_argument('--model', default='bambi-qwen35-9b-hauhau:q4_k_m')
    parser.add_argument('--context', type=int, default=16384)
    parser.add_argument('--cpu-moe', type=int, default=30)
    args = parser.parse_args()

    pins = registry(ROOT)
    model = None
    weight = None
    memory_limit = None
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
        cache = context_cache_type(model, args.context)
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
        if alive and args.command == 'start' and entry.get('runtimeProfile') == RUNTIME_PROFILE and entry.get('model') == args.model and entry.get('context') == args.context and ('35b' not in args.model or entry.get('cpuMoeLayers') == args.cpu_moe) and ready(entry):
            print('Owned llama.cpp ready', flush=True)
            raise SystemExit(0)
        if args.command == 'start' and '35b' in args.model:
            available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
            memory_limit = min(8 * 1024**3, available - 1536 * 1024**2)
            if memory_limit < 3 * 1024**3 or not shutil.which('systemd-run'):
                raise RuntimeError('35B requires at least 4.5 GiB available RAM and a user memory scope')
        if alive:
            stop_llama(ROOT, entry, pins, RUNTIME_PROFILE)
        state.pop('llama', None)
        save_state(statepath, state)
        if args.command == 'stop':
            print('Owned llama.cpp stopped', flush=True)
            raise SystemExit(0)
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', 8080)) == 0:
                raise RuntimeError('Port 8080 is occupied by a service whose project ownership could not be verified. Stop it through its own controls, then retry preparation.')
        # A single GPU cannot hold both runners; unload only models served by this local Ollama.
        loaded = request('http://127.0.0.1:11434/api/ps') or {'models': []}
        for resident in loaded['models']:
            request('http://127.0.0.1:11434/api/generate', {'model': resident['name'], 'keep_alive': 0})
        binary = ROOT / '.runtime/lib/ollama/llama-server'
        library = binary.parent
        env = {**os.environ, 'GGML_BACKEND_PATH': str(library / 'vulkan/libggml-vulkan.so'),
               'LD_LIBRARY_PATH': str(library) + ':' + str(library / 'vulkan'),
               'GGML_VK_VISIBLE_DEVICES': '0', 'VK_LOADER_LAYERS_DISABLE': '~implicit~',
               'DISABLE_LSFG': '1', 'DISABLE_LSFGVK': '1'}
        sampling = model.get('runtime', {}).get('sampling', {})
        command = [str(binary), '-m', str(weight), '--alias', args.model,
            '--host', '127.0.0.1', '--port', '8080', '--ctx-size', str(args.context),
            '--parallel', '1', '--threads', '6', '--threads-batch', '6', '--batch-size', '512', '--ubatch-size', str(model.get('runtime', {}).get('ubatch_size', 128)),
            '--poll', '0', '--poll-batch', '0',
            '--ctx-checkpoints', '16', '--checkpoint-min-step', '512', '--cache-ram', str(prompt_cache_mib(args.model)),
            '--gpu-layers', 'all', '--flash-attn', 'on', '--jinja', '--reasoning', 'off',
            '--no-webui',
            '--temp', str(sampling.get('temperature', 1)), '--top-p', str(sampling.get('top_p', .95)), '--top-k', str(sampling.get('top_k', 50)), '--min-p', str(sampling.get('min_p', .05)),
            '--repeat-penalty', '1', '--presence-penalty', '0', '--frequency-penalty', '0',
            '--dry-multiplier', str(sampling.get('dry_multiplier', .8)), '--dry-base', '1.75', '--dry-allowed-length', '2',
            '--xtc-probability', str(sampling.get('xtc_probability', .4)), '--xtc-threshold', '.1', '--n-predict', '8192']
        unit = None
        if '35b' in args.model:
            command += ['--n-cpu-moe', str(args.cpu_moe)]
            unit = 'bambi-local-llama-' + str(time.time_ns())
            command = ['systemd-run', '--user', '--quiet', '--scope', '--unit', unit,
                '--property=MemoryMax=' + str(memory_limit), '--property=MemorySwapMax=0', *command]
        cache = context_cache_type(model, args.context)
        command += ['--cache-type-k', cache, '--cache-type-v', cache]
        log = (RUNTIME / 'llama.log').open('ab', buffering=0)
        load_start = time.perf_counter()
        process = None
        prepared = False
        try:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                stdout=log, stderr=log, start_new_session=True)
            state['llama'] = {'root': str(ROOT), 'pid': process.pid, 'starttime': identity(process.pid),
                'command': command, 'model': args.model, 'context': args.context,
                'memoryLimitBytes': memory_limit, 'scope': unit, 'cpuMoeLayers': args.cpu_moe if unit else 0,
                'cacheType': cache, 'runtimeProfile': RUNTIME_PROFILE}
            save_state(statepath, state)
            until = time.monotonic() + 110
            while time.monotonic() < until and process.poll() is None:
                if ready(state['llama']):
                    actual = recover_llama(ROOT, pins, RUNTIME_PROFILE)
                    if actual:
                        state['llama'].update(actual)
                    state['llama']['loadSeconds'] = time.perf_counter() - load_start
                    save_state(statepath, state)
                    prepared = True
                    print(json.dumps({'ready': True, **state['llama']}), flush=True)
                    return
                time.sleep(.3)
            raise RuntimeError('The local model did not become ready within 110 seconds. See runtime/llama.log and retry preparation.')
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
