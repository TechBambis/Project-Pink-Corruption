# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

import fcntl, hashlib, json, os, pathlib, shutil, signal, subprocess, sys, time, urllib.request
from runtime_process import identity, recover_llama, registry, save_state, stop_llama, RUNTIME_PROFILE
root=pathlib.Path(__file__).resolve().parents[1];os.chdir(root)
runtime=root/'runtime';runtime.mkdir(exist_ok=True)
lock=open(runtime/'lifecycle.lock','w');fcntl.flock(lock,fcntl.LOCK_EX)
statepath=runtime/'owned-processes.json'
try: state=json.loads(statepath.read_text())
except (FileNotFoundError,json.JSONDecodeError): state={}
def save():save_state(statepath,state)

# A server can survive an interrupted launcher or a lost registry entry.
llama_pins=registry(root)
recovered_llama=recover_llama(root,llama_pins,RUNTIME_PROFILE)
if recovered_llama:
 state['llama']={**(state.get('llama',{}) if state.get('llama',{}).get('pid')==recovered_llama['pid'] else {}),**recovered_llama}
 save()

def request(path,method='GET'):
 try:
  with urllib.request.urlopen(urllib.request.Request(path,method=method),timeout=3) as r:
   body=r.read()
   try:return json.loads(body)
   except json.JSONDecodeError:return {'ok':True}
 except Exception:return None

def server_fingerprint():
 h=hashlib.sha256()
 for directory in ['apps/server','packages','config']:
  for path in sorted((root/directory).rglob('*.ts')):h.update(path.read_bytes())
 for path in sorted((root/'packages/runtime').glob('*.mjs')):h.update(path.read_bytes())
 for name in ['accelerator-plan.mjs','accelerator_bridge.py','llama-runtime.py','runtime_process.py']:
  h.update((root/'scripts'/name).read_bytes())
 for path in sorted((root/'presets/audio').glob('*.json')):h.update(path.read_bytes())
 h.update((root/'packages/content/session-phases-neutral.json').read_bytes())
 h.update((root/'packages/content/script-direction.json').read_bytes())
 h.update((root/'packages/content/bambicloud-triggers.json').read_bytes())
 for path in sorted((root/'packages/content/stable-2.0/workers/prompts').glob('*.json')):h.update(path.read_bytes())
 h.update((root/'package-lock.json').read_bytes())
 cloud_config=root/'.env.cloud'
 if cloud_config.exists():h.update(cloud_config.read_bytes())
 return h.hexdigest()

def tts_fingerprint():
 h=hashlib.sha256()
 for directory,pattern in [('packages/speech/local','*'),('presets/audio','*.json'),('voices','*')]:
  for path in sorted((root/directory).glob(pattern)):
   if path.is_file():h.update(path.read_bytes())
 profile=root/'runtime/tts-cpu-profile.json'
 if profile.is_file():h.update(profile.read_bytes())
 for path in [root/'config/tts-supertonic-experiment.json',root/'.runtime/supertonic3/helper.py',
              root/'config/tts-qwen3-experiment.json',root/'.runtime/qwen3tts/build-provenance.json']:
  if path.is_file():h.update(path.read_bytes())
 for name in ['BAMBI_TTS_THREADS','BAMBI_TTS_DYNAMIC_BLOCK']:h.update((name+'='+os.environ.get(name,'')).encode())
 return h.hexdigest()

def restart_owned(name,fingerprint,force=False):
 entry=state.get(name)
 if not entry or (not force and entry.get('fingerprint')==fingerprint) or not entry.get('starttime') or identity(entry['pid'])!=entry['starttime']:return
 if entry.get('root')!=str(root) or os.getpgid(entry['pid'])!=entry['pid']:
  raise RuntimeError('Refusing to restart unowned process')
 if name=='server':request('http://127.0.0.1:6969/api/panic','POST')
 os.killpg(entry['pid'],signal.SIGTERM)
 end=time.monotonic()+5
 while identity(entry['pid'])==entry['starttime'] and time.monotonic()<end:time.sleep(.1)
 if identity(entry['pid'])==entry['starttime']:
  try:os.killpg(entry['pid'],signal.SIGKILL)
  except ProcessLookupError:pass
 state.pop(name,None);save()

def launch(name,args):
 existing=state.get(name)
 if existing and existing.get('starttime') and identity(existing['pid'])==existing['starttime']:return
 log=open(runtime/(name+'.log'),'ab',buffering=0)
 p=subprocess.Popen(args,cwd=root,stdout=log,stderr=log,stdin=subprocess.DEVNULL,start_new_session=True,env=os.environ.copy())
 state[name]={'fingerprint':server_fingerprint() if name=='server' else tts_fingerprint() if name=='tts' else None,'pid':p.pid,'starttime':identity(p.pid),'command':args,'root':str(root)};save()
def wait(url,seconds):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if request(url):return True
  time.sleep(.3)
 return False
def node_executable():
 # An editor-provided wrapper can exist on the host but point inside Flatpak.
 # Validate the executable before recording an owned server launch.
 for candidate in dict.fromkeys([shutil.which('node'),'/usr/bin/node']):
  if not candidate:continue
  try:
   if subprocess.run([candidate,'--version'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5).returncode==0:return candidate
  except (OSError,subprocess.TimeoutExpired):pass
 raise RuntimeError('No working Node.js executable found; install Node.js 22.13+ and retry.')
def container_owned():
 if not shutil.which('podman'):return False
 p=subprocess.run(['podman','inspect','bambi-local-kokoro'],capture_output=True,text=True)
 if p.returncode:return False
 return json.loads(p.stdout)[0]['Config']['Labels'].get('io.bambi-local.owner')==str(root)
def ensure_cloud_tunnel():
 if (root/'.runtime/hyperai-access/tunnel-state.json').exists() and (root/'.env.cloud').exists():
  import re
  if re.search(r'^BAMBI_CLOUD_URL=http://127\.0\.0\.1:8085\s*$',(root/'.env.cloud').read_text(),re.M):
   launch('cloud-tunnel',[sys.executable,'scripts/cloud/tunnel-hyperai.py'])
command=sys.argv[1] if len(sys.argv)>1 else 'start'
if command=='restart-server':
 ensure_cloud_tunnel()
 restart_owned('server',server_fingerprint(),force=True)
 if not request('http://127.0.0.1:6969/api/health'):
  node_binary=node_executable()
  launch('server',[node_binary,'--import','tsx','apps/server/index.ts'])
  if not wait('http://127.0.0.1:6969/api/health',15):print('Server failed. See runtime/server.log.');sys.exit(1)
 print('Bambi Local server READY\nhttp://127.0.0.1:6969');sys.exit(0)
if command in ['stop','panic']:
 request('http://127.0.0.1:6969/api/panic','POST')
 for name in ['server','tts','llama','whisper','ollama','cloud-tunnel']:
  entry=state.get(name)
  if name=='llama':
   if recovered_llama:
    stop_llama(root,recovered_llama,llama_pins,RUNTIME_PROFILE)
   state.pop(name,None)
   continue
  if entry and entry.get('starttime') and entry.get('root')==str(root) and identity(entry['pid'])==entry['starttime']:
   try:
    if os.getpgid(entry['pid'])==entry['pid']:os.killpg(entry['pid'],signal.SIGTERM)
   except ProcessLookupError:pass
   deadline=time.monotonic()+4
   while identity(entry['pid'])==entry['starttime'] and time.monotonic()<deadline:time.sleep(.1)
   if identity(entry['pid'])==entry['starttime']:
    try:os.killpg(entry['pid'],signal.SIGKILL)
    except ProcessLookupError:pass
  state.pop(name,None)
 if container_owned():subprocess.run(['podman','stop','-t','3','bambi-local-kokoro'],stdout=subprocess.DEVNULL)
 save();print('Bambi Local stopped. Only application-owned services were stopped.');sys.exit(0)
ensure_cloud_tunnel()
if not request('http://127.0.0.1:11434/api/version'):
 binary=root/'.runtime/bin/ollama'
 if binary.exists():launch('ollama',[str(binary),'serve']);wait('http://127.0.0.1:11434/api/version',15)
 else:print('Ollama missing. Run ./scripts/setup.sh for local AI. Media-only mode remains available.')
models=request('http://127.0.0.1:11434/api/tags')
if models and not any(m['name']=='qwen3.5:4b' for m in models['models']):print('Default model missing. Run .runtime/bin/ollama pull qwen3.5:4b with scripts/env.sh loaded.')
# New ONNX service: resident CPU model with no network inference.
restart_owned('tts',tts_fingerprint())
if not request('http://127.0.0.1:8882/health'):
 binary=root/'.runtime/tts-venv/bin/python'
 if binary.exists() and (root/'models/kokoro/kokoro-v1.0.onnx').exists():
  launch('tts',[str(binary),'-m','packages.speech.local.server'])
  if not wait('http://127.0.0.1:8882/health',15):print('Offline TTS failed; see runtime/tts.log. Text remains available.')
 else:print('Offline ONNX voice not set up. Run ./scripts/setup-local-tts.sh once online. Text remains available.')
# The legacy Kokoro container is only needed by the separate STABLE-2.0 services caller.
if command=='services' and shutil.which('podman') and not request('http://127.0.0.1:8880/v1/audio/voices'):
 image='ghcr.io/remsky/kokoro-fastapi-cpu@sha256:7f9a256919eff7a84e9a77b757de0f3fe95c48fcf4fbe1e008deacbc7d9f2985'
 if container_owned():subprocess.run(['podman','start','bambi-local-kokoro'],stdout=subprocess.DEVNULL)
 else:
  p=subprocess.run(['podman','image','exists',image])
  if p.returncode==0:subprocess.run(['podman','run','-d','--name','bambi-local-kokoro','--label',f'io.bambi-local.owner={root}','-p','127.0.0.1:8880:8880','-e','OMP_NUM_THREADS=4','-e','MKL_NUM_THREADS=4',image],stdout=subprocess.DEVNULL)
  else:print('Kokoro image missing. Run ./scripts/setup.sh. Text companion remains available.')
 if not wait('http://127.0.0.1:8880/v1/audio/voices',40):print('Kokoro unavailable; continuing in text mode.')

candidates=[root/f'.runtime/{kind}/bin/whisper-server' for kind in ['whisper-host-vulkan','whisper-host','whisper-vulkan','whisper-cpu']]
binary=next((candidate for candidate in candidates if candidate.exists() and subprocess.run([str(candidate),'--help'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0),None)
whisper_entry=state.get('whisper')
if binary and whisper_entry and whisper_entry.get('command',[None])[0]!=str(binary):
 restart_owned('whisper','binary:'+str(binary))
if not request('http://127.0.0.1:8081/'):
 model=root/'models/ggml-base.bin'
 if binary and model.exists():
  launch('whisper',[str(binary),'-m',str(model),'--host','127.0.0.1','--port','8081','-t','4','-l','auto']+(['--no-gpu'] if not binary.parent.parent.name.endswith('vulkan') else []))
  wait('http://127.0.0.1:8081/',8)


if command=='services':
 print('Project-local Ollama, Kokoro and Whisper services initialized.');sys.exit(0)

restart_owned('server',server_fingerprint())

if not request('http://127.0.0.1:6969/api/health'):
 node_binary=node_executable()
 launch('server',[node_binary,'--import','tsx','apps/server/index.ts'])
 if not wait('http://127.0.0.1:6969/api/health',15):print('Server failed. See runtime/server.log.');sys.exit(1)
print('Bambi Local READY\nhttp://127.0.0.1:6969')
if '--browser' in sys.argv:subprocess.Popen(['xdg-open','http://127.0.0.1:6969'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
