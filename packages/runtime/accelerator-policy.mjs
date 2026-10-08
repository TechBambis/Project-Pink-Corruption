// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

export const desktopMemoryReserveMiB=1024;
/** Leave CPU capacity for speech, capture and the renderer on small PCs. */
export function inferenceThreads(available){
 if(!Number.isSafeInteger(available)||available<1)throw Error('Invalid available CPU count.');
 return Math.max(1,Math.min(6,available-2));
}
export function acceleratorMode(value){
 if(value===undefined||value==='auto')return 'auto';
 if(value==='cpu')return 'cpu';
 throw Error('Choose Automatic or CPU acceleration.');
}
export function deviceBackend(id){
 const match=/^(CUDA|Vulkan|Metal|ROCm|HIP|SYCL)(\d*)$/.exec(id);
 if(!match||(!match[2]&&match[1]!=='Metal'))return null;
 return {CUDA:'cuda',Vulkan:'vulkan',Metal:'metal',ROCm:'hip',HIP:'hip',SYCL:'sycl'}[match[1]];
}
/** Accept only local device identifiers emitted by the owned llama runtime. */
export function acceleratorDevices(output,backend){
 const devices=new Map();
 for(const line of output.split(/\r?\n/)){
  const match=/^\s*([A-Za-z][\w]*):\s+(.+?)\s+\((\d+) MiB,\s*(\d+) MiB free\)\s*$/.exec(line);
  if(!match)continue;
  const kind=deviceBackend(match[1]);if(!kind||(backend&&kind!==backend))continue;
  const total=Number(match[3]),free=Number(match[4]);
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(free)||free>total)continue;
  // Some integrated/unified devices report 0/0 instead of a memory budget.
  const totalMiB=total===0?null:total,freeMiB=total===0?null:free;
  if(!devices.has(match[1]))devices.set(match[1],{id:match[1],backend:kind,name:match[2].slice(0,240),totalMiB,freeMiB});
 }
 return [...devices.values()].sort((a,b)=>(b.freeMiB??-1)-(a.freeMiB??-1)||(b.totalMiB??-1)-(a.totalMiB??-1)||a.id.localeCompare(b.id));
}
export function deviceKey(device){return JSON.stringify([device.backend,device.id,device.backendPath??null]);}
/** Bound preparation: try at most three GPU paths, then one CPU attempt. */
export function acceleratorCandidates(devices,platform,blocked=[]){
 const order=platform==='darwin'?['metal']:platform==='linux'||platform==='win32'?['cuda','vulkan','hip','sycl']:[];
 const excluded=new Set(blocked);
 const usable=devices.filter(d=>order.includes(d.backend)&&!excluded.has(deviceKey(d))&&(d.freeMiB===null||d.freeMiB>desktopMemoryReserveMiB));
 usable.sort((a,b)=>order.indexOf(a.backend)-order.indexOf(b.backend)||(b.freeMiB??-1)-(a.freeMiB??-1)||a.id.localeCompare(b.id));
 // Give another backend a chance before another device on a failed backend.
 const first=order.map(backend=>usable.find(d=>d.backend===backend)).filter(Boolean);
 return [...first,...usable.filter(d=>!first.includes(d))].slice(0,3);
}
export function acceleratorArguments(device,context){
 if(!Number.isSafeInteger(context)||context<=0)throw Error('Use a positive full model context.');
 if(device&&!deviceBackend(device.id))throw Error('Invalid local accelerator device.');
 return ['--device',device?.id??'none','--gpu-layers',device?'auto':'0',
  '--fit',device?'on':'off','--fit-ctx',String(context),'--fit-target',String(desktopMemoryReserveMiB)];
}
export function offloadEvidence(log){
 const matches=[...log.matchAll(/offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers to GPU/gi)],last=matches.at(-1);
 if(!last)return null;
 const offloadedLayers=Number(last[1]),totalLayers=Number(last[2]);
 return Number.isSafeInteger(totalLayers)&&totalLayers>0&&Number.isSafeInteger(offloadedLayers)&&offloadedLayers<=totalLayers?{offloadedLayers,totalLayers}:null;
}
/** Never retry damaged models or changed application protocol/context. */
export function gpuFailureReason(log,failure){
 if(/invalid (?:model|magic)|failed to open (?:model|gguf)|unknown model architecture|unsupported model architecture|tensor .*?(?:missing|not found|wrong)|model.*checksum/i.test(log))return null;
 if(/out of memory|not enough (?:memory|vram)|failed to allocate|VK_ERROR_OUT_OF_(?:DEVICE|HOST)_MEMORY|cudaErrorMemoryAllocation|hipErrorOutOfMemory/i.test(log))return 'gpu-memory';
 if(/VK_ERROR|(?:vulkan|ggml_vulkan|metal|cuda|hip|rocm|sycl).*?(?:failed|error)|device (?:lost|removed)|failed to (?:initialize|initialise).*?(?:gpu|vulkan|metal|cuda|hip|sycl)/i.test(log))return 'gpu-driver';
 if(/failed to load model|error loading model/i.test(log))return null;
 return failure==='timeout'?'gpu-timeout':failure==='exit'?'gpu-startup-failed':null;
}
