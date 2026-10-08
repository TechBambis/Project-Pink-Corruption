// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {existsSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {acceleratorMode,acceleratorDevices,acceleratorCandidates,acceleratorArguments} from './accelerator-policy.mjs';

/** Only known in-package directories; never use a caller's loader overrides. */
export function backendLibraries(library,platform){
 const suffix=platform==='win32'?'.dll':platform==='darwin'?'.dylib':'.so',prefix=platform==='win32'?'':'lib';
 const names=platform==='darwin'?['metal']:['vulkan','cuda','cuda_v12','cuda_v13','hip','rocm','sycl'];
 return names.flatMap(name=>{
  const backend=name.startsWith('cuda')?'cuda':name==='rocm'?'hip':name;
  const path=resolve(library,name,`${prefix}ggml-${backend}${suffix}`);
  if(!existsSync(path))return [];
  const root=realpathSync(library),real=realpathSync(path);
  if(!real.startsWith(root+'/')&&!real.startsWith(root+'\\'))throw Error('Accelerator library escapes the owned runtime.');
  return [path];
 });
}
export function acceleratorEnvironment(source,{library,platform,backendPath}){
 const env={...source};
 // Windows names are case-insensitive. Remove alternate spellings as well.
 for(const key of Object.keys(env)){
  const upper=key.toUpperCase();
  if(upper.startsWith('LLAMA_ARG_')||upper.startsWith('GGML_')||['CUDA_VISIBLE_DEVICES','HIP_VISIBLE_DEVICES','ROCR_VISIBLE_DEVICES','ONEAPI_DEVICE_SELECTOR','SYCL_DEVICE_FILTER','LD_LIBRARY_PATH','DYLD_LIBRARY_PATH'].includes(upper)||platform==='win32'&&upper==='PATH')delete env[key];
 }
 const folders=[library,...(backendPath?[dirname(backendPath)]:[])];
 if(platform==='win32')env.PATH=[...folders,source.PATH??source.Path].filter(Boolean).join(';');
 else if(platform==='linux')env.LD_LIBRARY_PATH=folders.join(':');
 else if(platform==='darwin')env.DYLD_LIBRARY_PATH=folders.join(':');
 if(backendPath)env.GGML_BACKEND_PATH=backendPath;
 return {...env,VK_LOADER_LAYERS_DISABLE:'~implicit~',DISABLE_LSFG:'1',DISABLE_LSFGVK:'1'};
}
function enumerate(command,env,timeout,signal){
 signal.throwIfAborted();
 return new Promise((accept,reject)=>{
  const abort=()=>child.kill('SIGKILL');
  const child=execFile(command.executable,[...(command.prefix??[]),'--list-devices'],{env,windowsHide:true,killSignal:'SIGKILL',timeout,maxBuffer:65536,encoding:'utf8'},(error,stdout)=>{
   signal.removeEventListener('abort',abort);error?reject(error):accept(stdout);
  });
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
export async function acceleratorPlan({command,library,platform,environment,mode,context,blocked=[],devices:cachedDevices,probeTimeoutMs=8000,signal=new AbortController().signal}){
 const requested=acceleratorMode(mode),devices=[...(cachedDevices??[])],probeFailures=[];
 const cpuEnvironment=acceleratorEnvironment(environment,{library,platform});
 if(requested==='auto'&&!cachedDevices){
  const deadline=Date.now()+probeTimeoutMs;
  // Probe optional libraries individually: a broken vendor plugin cannot hide
  // another working backend. The entire inventory has one bounded deadline.
  for(const backendPath of [...backendLibraries(library,platform),undefined]){
   signal.throwIfAborted();const remaining=deadline-Date.now();if(remaining<=0){probeFailures.push('deadline');break;}
   try{
    const output=await enumerate(command,acceleratorEnvironment(environment,{library,platform,backendPath}),remaining,signal);
    for(const device of acceleratorDevices(output)){
     // Root/compiled-in devices may also appear in a plugin probe; re-enumerate
     // those without that plugin before using them as an independent fallback.
     const plugin=backendPath&&/ggml-(\w+)\./.exec(backendPath)?.[1];
     if(plugin&&device.backend!==plugin)continue;
     devices.push({...device,...(backendPath?{backendPath}:{})});
    }
   }catch{signal.throwIfAborted();probeFailures.push(backendPath??'builtin');}
  }
 }
 signal.throwIfAborted();
 const candidates=requested==='cpu'?[]:acceleratorCandidates(devices,platform,blocked);
 const attempts=[...candidates.map(device=>({device,args:acceleratorArguments(device,context),environment:acceleratorEnvironment(environment,{library,platform,backendPath:device.backendPath})})),
  {device:null,args:acceleratorArguments(null,context),environment:cpuEnvironment}];
 return {requested,devices,attempts,probeFailures,fallbackReason:requested==='cpu'||candidates.length?undefined:devices.length?'no-gpu-headroom':probeFailures.length?'gpu-probe-unavailable':'no-supported-gpu'};
}
