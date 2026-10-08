# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Recover project llama.cpp ownership using the listening socket and /proc."""
import json
import os
from pathlib import Path
import signal
import tempfile
import time

RUNTIME_PROFILE = 'responsive-prefix-v3'


def prompt_cache_mib(alias):
    # A measured 9B recurrent state is ~862 MiB. Preserve it across listening
    # decisions; 256 MiB silently skips saving and causes a full prompt prefill.
    # Keep the separately memory-scoped 35B profile within its existing budget.
    return 1024 if 'anubis-mini' in alias.lower() else 2048 if '-9b' in alias.lower() else 256


def model_contexts(pin):
    return pin.get('allowed_contexts', [4096, 8192, 16384, 24576])


def context_cache_type(pin, context):
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
    return pins


def option(arguments, name):
    if arguments.count(name) != 1:
        return None
    position = arguments.index(name) + 1
    return arguments[position] if position < len(arguments) else None


def inspect_llama(root, pid, pins, profile):
    """An API response or stale PID alone never establishes ownership."""
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
        if pin is None or option(arguments, '--host') != '127.0.0.1' or option(arguments, '--port') != '8080':
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
        required = {'--parallel': '1', '--ctx-checkpoints': '16', '--checkpoint-min-step': '512',
                    '--cache-ram': str(prompt_cache_mib(alias)), '--reasoning': 'off', '--gpu-layers': 'all', '--flash-attn': 'on'}
        sampler_flags = {'temperature': '--temp', 'top_p': '--top-p', 'top_k': '--top-k', 'min_p': '--min-p', 'dry_multiplier': '--dry-multiplier', 'xtc_probability': '--xtc-probability'}
        if 'ubatch_size' in pin.get('runtime', {}):
            required['--ubatch-size'] = str(pin['runtime']['ubatch_size'])
        for key, value in pin.get('runtime', {}).get('sampling', {}).items():
            if key in sampler_flags:
                required[sampler_flags[key]] = str(value)
        compatible = same_binary and all(option(arguments, key) == value for key, value in required.items())
        compatible = compatible and '--jinja' in arguments and '--no-webui' in arguments
        cache = context_cache_type(pin, context)
        compatible = compatible and option(arguments, '--cache-type-k') == cache and option(arguments, '--cache-type-v') == cache
        if identity(pid) != started:
            return None
        return {'root': str(root), 'pid': pid, 'starttime': started, 'command': arguments,
                'model': alias, 'context': context, 'cacheType': cache,
                'cpuMoeLayers': int(option(arguments, '--n-cpu-moe') or '0'),
                'runtimeProfile': profile if compatible else 'recovered-incompatible', 'recovered': True}
    except (OSError, ValueError, UnicodeError):
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


def recover_llama(root, pins, profile):
    listeners = listening_pids(8080)
    if len(listeners) != 1:
        return None
    return inspect_llama(root, listeners[0], pins, profile)


def stop_llama(root, entry, pins, profile, seconds=5):
    current = inspect_llama(root, entry['pid'], pins, profile)
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
        verified = inspect_llama(root, pid, pins, profile)
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
