# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Keep the existing private HyperAI tunnel connected; never start provider compute."""
import json
import os
import signal
import subprocess
import time
from pathlib import Path

root=Path(__file__).resolve().parents[2]
os.chdir(root)
directory=root/'.runtime/hyperai-access'
statefile=directory/'tunnel-state.json'
state=json.loads(statefile.read_text())
if state.get('host')!='ssh.hyper.ai' or not 1 <= int(state['port']) <= 65535:
    raise SystemExit('Invalid private HyperAI connection configuration')
if state.get('localPort')!=8085 or state.get('remotePort')!=8080:
    raise SystemExit('Unexpected HyperAI forwarding ports')
key=directory/'id_ed25519'
forward='127.0.0.1:8085:127.0.0.1:8080'
token_forward='127.0.0.1:8086:127.0.0.1:8082'
target='root@ssh.hyper.ai'
active_pid=None
stopping=False

def owned(pid):
    try:
        args=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        return (Path(args[0].decode()).name=='ssh' and str(key).encode() in args
                and forward.encode() in args and target.encode() in args
                and str(state['port']).encode() in args)
    except (OSError,UnicodeError,IndexError):return False

def stop(_signal,_frame):
    global stopping
    stopping=True
    if active_pid and owned(active_pid):
        try:os.kill(active_pid,signal.SIGTERM)
        except ProcessLookupError:pass

signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
if owned(state.get('pid',0)):
    active_pid=state['pid']
    args=Path(f'/proc/{active_pid}/cmdline').read_bytes().split(b'\0')
    if token_forward.encode() not in args:
        # Migrate only the verified application-owned legacy tunnel.
        os.kill(active_pid,signal.SIGTERM)
        for _ in range(50):
            if not owned(active_pid):break
            time.sleep(.1)
        if owned(active_pid):raise SystemExit('Existing cloud tunnel did not stop')
        active_pid=None
delay=1
while not stopping:
    if active_pid and owned(active_pid):
        time.sleep(1)
        continue
    print('Connecting the private cloud tunnel.',flush=True)
    args=['ssh','-N','-i',str(key),'-o','IdentitiesOnly=yes','-o','BatchMode=yes',
          '-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=15',
          '-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',
          '-o','UserKnownHostsFile='+str(directory/'known_hosts'),'-L',forward,'-L',token_forward,'-p',str(state['port']),target]
    proc=subprocess.Popen(args,stdin=subprocess.DEVNULL)
    active_pid=proc.pid
    state['pid']=active_pid
    statefile.write_text(json.dumps(state,indent=2)+'\n')
    statefile.chmod(0o600)
    started=time.monotonic()
    while not stopping and proc.poll() is None:time.sleep(1)
    if stopping:break
    if time.monotonic()-started>60:delay=1
    else:delay=min(30,delay*2)
    print('Cloud tunnel disconnected; retrying while the local app runs.',flush=True)
    for _ in range(delay):
        if stopping:break
        time.sleep(1)
