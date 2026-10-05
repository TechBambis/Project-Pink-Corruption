# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Restart only this setup's Cydonia process with validated, persistent settings."""
import argparse
import fcntl
import importlib.util
import json
import os
import signal
import subprocess
import time
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[2]
os.chdir(root)
runtime = root/'.runtime'
runtime.mkdir(exist_ok=True)
spec = importlib.util.spec_from_file_location('server_config',root/'scripts/cloud/server-config.py')
settings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(settings)
binary = runtime/'cloud-llama/build/bin/llama-server'
keyfile = runtime/'cloud-api.key'
pidfile = runtime/'cydonia-server.pid'
profilefile = runtime/'server-profile.json'

def api(path):
    key = keyfile.read_text().strip()
    request = urllib.request.Request('http://127.0.0.1:8080'+path,headers={'Authorization':'Bearer '+key})
    with urllib.request.urlopen(request,timeout=5) as response:
        return json.load(response)

def status():
    props = api('/props')
    query = subprocess.run(['nvidia-smi','--query-gpu=memory.used,memory.total,power.draw,temperature.gpu,utilization.gpu',
                            '--format=csv,noheader,nounits'],capture_output=True,text=True,check=True)
    numbers = query.stdout.strip().splitlines()[0].split(',')
    return dict(context=props['default_generation_settings']['n_ctx'],slots=props['total_slots'],
                gpu=dict(zip(['usedMiB','totalMiB','powerW','temperatureC','utilization'],[float(n.strip()) for n in numbers])),
                configuration=json.loads(profilefile.read_text()) if profilefile.exists() else settings.DEFAULTS)

def stop_owned(require_running=False):
    if not pidfile.exists():
        if require_running:raise RuntimeError('Running server is not registered with this controller; restart it manually')
        return
    pid = int(pidfile.read_text())
    proc = Path(f'/proc/{pid}')
    cmdline = proc/'cmdline'
    if not cmdline.exists() or not cmdline.read_bytes():
        if require_running:raise RuntimeError('Recorded server is not running; no replacement started')
        return
    arguments = cmdline.read_bytes().split(b'\0')
    if Path(arguments[0].decode()).resolve() != binary.resolve() or os.getpgid(pid) != pid or (proc/'cwd').resolve() != root.resolve():
        raise RuntimeError('Refusing to stop a process not owned by this Cydonia setup')
    os.killpg(pid,signal.SIGTERM)
    for _ in range(100):
        if not cmdline.exists() or not cmdline.read_bytes():return
        time.sleep(.1)
    raise RuntimeError('Owned server did not stop; no replacement started')

def wait_idle():
    # Never cancel a user's active reply just to measure another profile.
    deadline=time.monotonic()+180
    while True:
        slots=api('/slots')
        if not any(slot.get('is_processing') for slot in slots):return
        if time.monotonic()>deadline:
            raise RuntimeError('Inference is still active; profile change postponed')
        time.sleep(1)

def start(config):
    if not binary.is_file() or not keyfile.is_file():
        raise RuntimeError('Prepare the CUDA binary and private key before changing profiles')
    temp = profilefile.with_suffix('.tmp')
    temp.write_text(json.dumps(config,indent=2)+'\n')
    temp.replace(profilefile)
    env = {k:v for k,v in os.environ.items() if not k.startswith('BAMBI_CLOUD_')}
    env.update(BAMBI_LLAMA_SERVER=str(binary),BAMBI_CLOUD_PROFILE_FILE=str(profilefile))
    with (runtime/'cydonia-server.log').open('ab',buffering=0) as log:
        proc = subprocess.Popen(['bash','scripts/cloud/serve-cydonia.sh'],stdout=log,stderr=log,
                                stdin=subprocess.DEVNULL,start_new_session=True,env=env)
    pidfile.write_text(str(proc.pid)+'\n')
    for _ in range(120):
        if proc.poll() is not None:raise RuntimeError('Server exited; inspect .runtime/cydonia-server.log')
        try:
            value = status()
            if value['context'] == config['context']:return value
        except (OSError,ValueError,KeyError):pass
        time.sleep(1)
    raise RuntimeError('Server did not become ready within 120 seconds')

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('action',choices=['status','restart'])
args=parser.parse_args()
with (runtime/'cloud-control.lock').open('w') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    if args.action=='status':print(json.dumps(status()))
    else:
        selected=settings.validate(json.load(__import__('sys').stdin))
        previous=settings.validate(json.loads(profilefile.read_text()) if profilefile.exists() else {})
        wait_idle()
        stop_owned(require_running=True)
        try:print(json.dumps(start(selected)))
        except Exception:
            stop_owned()
            start(previous)
            raise RuntimeError('Candidate failed; previous configuration restored') from None
