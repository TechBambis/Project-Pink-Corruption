# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Recover project llama.cpp ownership using the listening socket and /proc."""
import json
import os
import re
from pathlib import Path
import signal
import tempfile
import time
import subprocess

RUNTIME_PROFILE = 'responsive-prefix-v4-accelerator'


def prompt_cache_mib(alias, pin=None):
    # A measured 9B recurrent state is ~862 MiB. Preserve it across listening
    # decisions; 256 MiB silently skips saving and causes a full prompt prefill.
    # Keep the separately memory-scoped 35B profile within its existing budget.
    return (pin or {}).get('runtime', {}).get('prompt_cache_mib', 1024 if 'anubis-mini' in alias.lower() else 2048 if '-9b' in alias.lower() or alias.startswith('bambi-qwen35-4b-hauhau') else 256)


def speculative_options(pin):
    setting = pin.get('runtime', {}).get('speculative')
    if setting is None:
        return []
    if setting != {'type': 'draft-mtp', 'draft_tokens': 3} or pin['alias'] != 'bambi-qwen35-4b-hauhau-mtp-experiment:q4_k_m':
        raise RuntimeError('Unsupported pinned speculative profile.')
    return ['--spec-type', 'draft-mtp', '--spec-draft-n-max', '3']


def dflash_asset(root, alias, mode):
    if mode == 'off':
        return None
    if mode != 'on' or alias != 'bambi-qwen35-4b-hauhau:q4_k_m':
        raise RuntimeError('DFlash testing is available for Hauhau 4B.')
    manifest = json.loads((root / 'config/speculative-4b-experiment.json').read_text())
    draft = manifest['draft']
    if manifest.get('status') != 'experiment-only' or not re.fullmatch(r'[\w.-]+\.gguf', draft['file']) or not re.fullmatch(r'[0-9a-f]{64}', draft['sha256']):
        raise RuntimeError('Invalid pinned DFlash helper.')
    return draft


def model_contexts(pin):
    return pin.get('allowed_contexts', [4096, 8192, 16384, 24576])


def context_cache_type(pin, context, override='default'):
    if override == 'q8_0':
        if pin['alias'] != 'bambi-qwen35-9b-hauhau:q4_k_m':
            raise RuntimeError('Experimental Q8 KV cache is available for Hauhau 9B.')
        return 'q8_0'
    if override != 'default':
        raise RuntimeError('Unsupported local cache setting')
    runtime = pin.get('runtime', {})
    cache = runtime.get('long_context_cache_type', runtime.get('cache_type', 'f16')) if context > runtime.get('long_context_threshold', context) else runtime.get('cache_type', 'f16')
    if cache not in ['f16', 'q8_0', 'q4_0']:
        raise RuntimeError('Unsupported local cache profile')
    return cache


def identity(pid):
    try:
        fields = Path(f'/proc/{int(pid)}/stat').read_text().rsplit(')', 1)[1].split()
        return None if fields[0] == 'Z' else fields[19]
    except (OSError, ValueError, IndexError, TypeError):
        return None


def save_state(path, state):
    """Readers must never observe a partially written process registry."""
    descriptor, temporary = tempfile.mkstemp(prefix='.processes-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(state, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def registry(root):
    pins = json.loads((root / 'docs/community-models.json').read_text())
    for name in ['qwen36-model.json', 'comparison-models.json', 'anubis-model.json']:
        path = root / 'docs' / name
        if path.exists():
            extra = json.loads(path.read_text())
            pins.extend(extra if isinstance(extra, list) else [extra])
    catalog = root / 'config/local-model-catalog.json'
    if catalog.exists():
        small = [pin for pin in json.loads(catalog.read_text()) if pin['alias'] in ['bambi-qwen35-2b-hauhau:q4_k_m', 'bambi-lfm25-1.2b:Q4_K_M']]
        if small:
            total = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:'))) * 1024
            result = subprocess.run([os.environ.get('BAMBI_RUNTIME_NODE', 'node'), '--experimental-strip-types', str(root / 'scripts/resource-plan.mjs')], input=json.dumps({'ramTotal': total, 'models': small}), text=True, capture_output=True, timeout=15, check=True)
            plans = {plan['alias']: plan for plan in json.loads(result.stdout)}
            for pin in small:
                plan = plans[pin['alias']]
                sampling = {key: value for key, value in pin['samplingProfile'].items() if not key.startswith('creative')}
                pin = {**pin, 'allowed_contexts': [pin['context']], 'resource_plan': plan,
                       'runtime': {'cache_type': 'f16', 'prompt_cache_mib': plan['promptCacheMiB'], 'checkpoints': plan['checkpoints'], 'batch_size': plan['batchSize'], 'ubatch_size': plan['microBatchSize'], 'sampling': {**sampling, 'dry_multiplier': 0, 'xtc_probability': 0}}}
                pins = [existing for existing in pins if existing['alias'] != pin['alias']]
                pins.append(pin)
    if catalog.exists():
        supported = {pin['alias'] for pin in json.loads(catalog.read_text()) if pin.get('desktopSupported') and pin.get('license') in ['apache-2.0', 'lfm1.0']}
        pins = [{**pin, 'calibration_supported': pin['alias'] in supported} for pin in pins]
    return pins


def option(arguments, name):
    if arguments.count(name) != 1:
        return None
    position = arguments.index(name) + 1
    return arguments[position] if position < len(arguments) else None


def inspect_llama(root, pid, pins, profile, *, port=8080):
    """An API response or stale PID alone never establishes ownership."""
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('Expected native port must be an explicit non-privileged TCP port')
    process = Path('/proc') / str(pid)
    started = identity(pid)
    if started is None:
        return None
    try:
        if process.stat().st_uid != os.getuid() or (process / 'cwd').resolve() != root.resolve():
            return None
        binary = root / '.runtime/lib/ollama/llama-server'
        same_binary = (process / 'exe').samefile(binary)
        if not same_binary:
            # An upgraded executable can leave the old project runner alive.
            # Verify the kernel's original path; it must then be restarted.
            executable = os.readlink(process / 'exe')
            if not executable.endswith(' (deleted)') or Path(executable[:-10]) != binary.resolve():
                return None
        arguments = [item.decode() for item in (process / 'cmdline').read_bytes().split(b'\0') if item]
        alias = option(arguments, '--alias')
        pin = next((pin for pin in pins if pin['alias'] == alias), None)
        if pin is None or option(arguments, '--host') != '127.0.0.1' or option(arguments, '--port') != str(port):
            return None
        weight = root / 'models/community' / pin['file']
        configured_weight = option(arguments, '-m')
        if configured_weight is None or Path(configured_weight).resolve() != weight.resolve():
            return None
        if not weight.is_file() or weight.stat().st_size != pin['bytes']:
            return None
        context = int(option(arguments, '--ctx-size') or '0')
        if context not in model_contexts(pin):
            return None
        required = {'--parallel': '1', '--ctx-checkpoints': str(pin.get('runtime', {}).get('checkpoints', 16)), '--checkpoint-min-step': '512',
                    '--cache-ram': str(prompt_cache_mib(alias, pin)), '--reasoning': 'off', '--flash-attn': 'on'}
        if pin.get('resource_plan'):
            required['--batch-size'] = str(pin['runtime']['batch_size'])
            required['--chat-template-kwargs'] = '{"enable_thinking":false}'
        if alias.startswith('bambi-qwen35-4b-hauhau'):
            required['--verbosity'] = '4'
        sampler_flags = {'temperature': '--temp', 'top_p': '--top-p', 'top_k': '--top-k', 'min_p': '--min-p', 'repeat_penalty': '--repeat-penalty', 'dry_multiplier': '--dry-multiplier', 'xtc_probability': '--xtc-probability'}
        if 'ubatch_size' in pin.get('runtime', {}):
            required['--ubatch-size'] = str(pin['runtime']['ubatch_size'])
        if pin.get('calibration_supported') or alias in ['bambi-lfm25-1.2b:Q4_K_M', 'bambi-qwen35-2b-hauhau:q4_k_m', 'bambi-qwen35-4b-hauhau:q4_k_m']:
            # Calibration changes bounded allocation settings, never identity,
            # full context, checkpoint budgets, sampling or ownership checks.
            for flag, allowed in [('--batch-size', ['128', '512', '1024']), ('--ubatch-size', ['32', '128', '256'])]:
                actual = option(arguments, flag)
                if actual in allowed:
                    required[flag] = actual
        for key, value in pin.get('runtime', {}).get('sampling', {}).items():
            if key in sampler_flags:
                required[sampler_flags[key]] = str(value)
        compatible = same_binary and all(option(arguments, key) == value for key, value in required.items())
        layers = option(arguments, '--gpu-layers')
        device = option(arguments, '--device') or ''
        acceleration = layers == '0' and device == 'none' and option(arguments, '--fit') == 'off' or layers == 'auto' and re.fullmatch(r'(?:CUDA|Vulkan|Metal|ROCm|HIP|SYCL)\d+|Metal', device) and option(arguments, '--fit') == 'on'
        compatible = compatible and bool(acceleration) and option(arguments, '--fit-ctx') == str(context) and option(arguments, '--fit-target') == '1024'
        compatible = compatible and '--jinja' in arguments and '--no-webui' in arguments
        cache = context_cache_type(pin, context)
        if pin['alias'] == 'bambi-qwen35-9b-hauhau:q4_k_m' and option(arguments, '--cache-type-k') == 'q8_0':
            cache = context_cache_type(pin, context, 'q8_0')
        compatible = compatible and option(arguments, '--cache-type-k') == cache and option(arguments, '--cache-type-v') == cache
        dflash = 'off'
        speculative = speculative_options(pin)
        if speculative:
            compatible = compatible and option(arguments, '--spec-type') == 'draft-mtp' and option(arguments, '--spec-draft-n-max') == '3' and '--spec-draft-model' not in arguments
            compatible = compatible and {flag for flag in arguments if flag.startswith('--spec-')} == {'--spec-type', '--spec-draft-n-max'}
        elif any(flag.startswith('--spec-') for flag in arguments):
            draft = dflash_asset(root, alias, 'on')
            draft_path = root / 'models/speculative' / draft['file']
            compatible = compatible and option(arguments, '--spec-type') == 'draft-dflash' and option(arguments, '--spec-draft-n-max') == '3' and option(arguments, '--spec-draft-model') == str(draft_path) and draft_path.is_file() and not draft_path.is_symlink() and draft_path.stat().st_size == draft['bytes']
            dflash = 'on'
        if identity(pid) != started:
            return None
        return {'root': str(root), 'pid': pid, 'starttime': started, 'command': arguments,
                'model': alias, 'context': context, 'port': port, 'cacheType': cache, 'dflash': dflash, 'mtp': bool(speculative and compatible),
                'cpuMoeLayers': int(option(arguments, '--n-cpu-moe') or '0'),
                'runtimeProfile': profile if compatible else 'recovered-incompatible', 'recovered': True}
    except (OSError, ValueError, UnicodeError, RuntimeError):
        return None


def listening_pids(port):
    inodes = set()
    for name in ['tcp', 'tcp6']:
        try:
            lines = Path('/proc/net/' + name).read_text().splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            fields = line.split()
            if fields[3] == '0A' and int(fields[1].rsplit(':', 1)[1], 16) == port:
                inodes.add(fields[9])
    if not inodes:
        return []
    found = set()
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid != os.getuid():
                continue
            for descriptor in (process / 'fd').iterdir():
                try:
                    target = os.readlink(descriptor)
                    if target.startswith('socket:[') and target[8:-1] in inodes:
                        found.add(int(process.name))
                except OSError:
                    pass
        except OSError:
            pass
    return sorted(found)


def recover_llama(root, pins, profile, *, port=8080):
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('Expected native port must be an explicit non-privileged TCP port')
    listeners = listening_pids(port)
    if len(listeners) != 1:
        return None
    return inspect_llama(root, listeners[0], pins, profile, port=port)


def stop_llama(root, entry, pins, profile, seconds=5, *, port=8080):
    current = inspect_llama(root, entry['pid'], pins, profile, port=port)
    if current is None or current['starttime'] != entry['starttime']:
        raise RuntimeError('Local model ownership changed; no process was stopped. Retry preparation.')
    # A recovered server can belong to a systemd scope. Only its verified PID
    # is stopped; unrelated members of a process group are never signalled.
    pid = current['pid']
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    until = time.monotonic() + seconds
    while identity(pid) == current['starttime'] and time.monotonic() < until:
        time.sleep(.05)
    if identity(pid) == current['starttime']:
        verified = inspect_llama(root, pid, pins, profile, port=port)
        if verified and verified['starttime'] == current['starttime']:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                return
            until = time.monotonic() + seconds
            while identity(pid) == current['starttime'] and time.monotonic() < until:
                time.sleep(.05)
    if identity(pid) == current['starttime']:
        raise RuntimeError('The previous local model did not stop. Check runtime/llama.log before retrying.')
