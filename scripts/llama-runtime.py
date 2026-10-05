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
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
RUNTIME = ROOT / 'runtime'
RUNTIME.mkdir(exist_ok=True)
RUNTIME_PROFILE = 'responsive-prefix-v1'
parser = argparse.ArgumentParser()
parser.add_argument('command', choices=['start', 'stop'])
parser.add_argument('--model', default='bambi-qwen35-9b-hauhau:q4_k_m')
parser.add_argument('--context', type=int, choices=[4096, 8192, 16384, 24576], default=16384)
parser.add_argument('--cpu-moe', type=int, default=30)
args = parser.parse_args()

def identity(pid):
    try:
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (FileNotFoundError, ProcessLookupError):
        return None

def request(path, data=None):
    try:
        payload = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(path, data=payload, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=12) as response:
            return json.load(response)
    except Exception:
        return None

with (RUNTIME / 'lifecycle.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    statepath = RUNTIME / 'owned-processes.json'
    state = json.loads(statepath.read_text()) if statepath.exists() else {}
    entry = state.get('llama')
    alive = entry and entry.get('root') == str(ROOT) and identity(entry['pid']) == entry['starttime']
    if alive and args.command == 'start' and entry.get('runtimeProfile') == RUNTIME_PROFILE and entry.get('model') == args.model and entry.get('context') == args.context and request('http://127.0.0.1:8080/health'):
        print('Owned llama.cpp ready', flush=True)
        raise SystemExit(0)
    if alive:
        if os.getpgid(entry['pid']) != entry['pid']:
            raise RuntimeError('Owned runner process group changed')
        os.killpg(entry['pid'], signal.SIGTERM)
        until = time.monotonic() + 5
        while identity(entry['pid']) == entry['starttime'] and time.monotonic() < until:
            time.sleep(.1)
        if identity(entry['pid']) == entry['starttime']:
            os.killpg(entry['pid'], signal.SIGKILL)
    state.pop('llama', None)
    statepath.write_text(json.dumps(state, indent=2))
    if args.command == 'stop':
        print('Owned llama.cpp stopped', flush=True)
        raise SystemExit(0)
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', 8080)) == 0:
            raise RuntimeError('Port 8080 belongs to a different service')
    pins = json.loads((ROOT / 'docs/community-models.json').read_text())
    for extra in [ROOT / 'docs/qwen36-model.json', ROOT / 'docs/comparison-models.json']:
        if extra.exists():
            entries = json.loads(extra.read_text())
            pins.extend(entries if isinstance(entries, list) else [entries])
    model = next((model for model in pins if model['alias'] == args.model), None)
    if not model:
        raise RuntimeError('Model is not in the pinned local registry')
    weight = ROOT / 'models/community' / model['file']
    if not weight.exists() or weight.stat().st_size != model['bytes']:
        raise RuntimeError('Verified GGUF is not installed; run its explicit setup first')
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
    command = [str(binary), '-m', str(weight), '--alias', args.model,
        '--host', '127.0.0.1', '--port', '8080', '--ctx-size', str(args.context),
        '--parallel', '1', '--threads', '6', '--threads-batch', '6', '--batch-size', '512', '--ubatch-size', '128',
        '--poll', '0', '--poll-batch', '0',
        '--ctx-checkpoints', '16', '--checkpoint-min-step', '512', '--cache-ram', '256',
        '--gpu-layers', 'all', '--flash-attn', 'on', '--jinja', '--reasoning', 'off',
        '--no-webui',
        '--temp', '1', '--top-p', '.95', '--top-k', '50', '--min-p', '.05',
        '--repeat-penalty', '1', '--presence-penalty', '0', '--frequency-penalty', '0',
        '--dry-multiplier', '.8', '--dry-base', '1.75', '--dry-allowed-length', '2',
        '--xtc-probability', '.4', '--xtc-threshold', '.1', '--n-predict', '8192']
    memory_limit = None
    unit = None
    if '35b' in args.model:
        command += ['--n-cpu-moe', str(args.cpu_moe)]
        available = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
        memory_limit = min(8 * 1024**3, available - 1536 * 1024**2)
        if memory_limit < 3 * 1024**3 or not shutil.which('systemd-run'):
            raise RuntimeError('35B requires at least 4.5 GiB available RAM and a user memory scope')
        unit = 'bambi-local-llama-' + str(time.time_ns())
        command = ['systemd-run', '--user', '--quiet', '--scope', '--unit', unit,
            '--property=MemoryMax=' + str(memory_limit), '--property=MemorySwapMax=0', *command]
    cache = model.get('runtime', {}).get('cache_type', 'f16')
    if cache not in ['f16', 'q8_0']:
        raise RuntimeError('Unsupported local cache profile')
    command += ['--cache-type-k', cache, '--cache-type-v', cache]
    log = (RUNTIME / 'llama.log').open('ab', buffering=0)
    load_start = time.perf_counter()
    process = subprocess.Popen(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
        stdout=log, stderr=log, start_new_session=True)
    state['llama'] = {'root': str(ROOT), 'pid': process.pid, 'starttime': identity(process.pid),
        'command': command, 'model': args.model, 'context': args.context,
        'memoryLimitBytes': memory_limit, 'scope': unit, 'cpuMoeLayers': args.cpu_moe if unit else 0,
        'cacheType': cache, 'runtimeProfile': RUNTIME_PROFILE}
    statepath.write_text(json.dumps(state, indent=2))
    until = time.monotonic() + 110
    while time.monotonic() < until and process.poll() is None:
        if request('http://127.0.0.1:8080/health'):
            state['llama']['loadSeconds'] = time.perf_counter() - load_start
            statepath.write_text(json.dumps(state, indent=2))
            print(json.dumps({'ready': True, **state['llama']}), flush=True)
            raise SystemExit(0)
        time.sleep(.3)
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
    state.pop('llama', None)
    statepath.write_text(json.dumps(state, indent=2))
    raise RuntimeError('Vulkan runner did not become ready; see runtime/llama.log')
