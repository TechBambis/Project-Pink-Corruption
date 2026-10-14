// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {readFileSync,readdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import {win32} from 'node:path';
import {resourcePath} from '../runtime/paths';

export interface GPUInfo {
 name:string;
 memoryTotal:number|null;
 memoryFree:number|null;
 source:'linux-sysfs'|'nvidia-smi'|'windows-cim'|'windows-dxgi'|'apple-unified';
 /** DXGI budgets are process budgets, not globally free VRAM. */
 memoryBudget?:number|null;
 sharedMemoryTotal?:number|null;
 sharedMemoryBudget?:number|null;
 driverVersion?:string;
}
export interface HardwareProfile {
 platform:string;
 architecture:string;
 cpu:string;
 cpuThreads:number;
 ramTotal:number;
 ramAvailable:number;
 unifiedMemory:boolean;
 gpus:GPUInfo[];
 warnings:string[];
}
const number=(path:string)=>{try{const value=Number(readFileSync(path,'utf8').trim());return Number.isFinite(value)&&value>=0?value:null;}catch{return null;}};
function linuxCards(){try{return readdirSync('/sys/class/drm').filter(name=>/^card\d+$/.test(name));}catch{return [];}}
function linuxGPUs():GPUInfo[]{return linuxCards().flatMap(card=>{
 const path=`/sys/class/drm/${card}/device/`,total=number(path+'mem_info_vram_total'),used=number(path+'mem_info_vram_used');
 let name='Graphics device';try{const vendor=readFileSync(path+'vendor','utf8').trim();name=vendor==='0x1002'?'AMD GPU':vendor==='0x10de'?'NVIDIA GPU':vendor==='0x8086'?'Intel GPU':name;}catch{}
 return [{name,memoryTotal:total,memoryFree:total!==null&&used!==null&&used<=total?total-used:null,source:'linux-sysfs' as const}];
});}
function availableRAM(){
 if(os.platform()==='linux'){try{const match=/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo','utf8'));if(match)return Math.min(os.totalmem(),Number(match[1])*1024);}catch{}}
 return os.freemem();
}
export function performanceSnapshot(){
 const gpu=linuxGPUs().sort((a,b)=>(b.memoryTotal??0)-(a.memoryTotal??0))[0];
 const card=linuxCards().find(name=>number(`/sys/class/drm/${name}/device/mem_info_vram_total`)===gpu?.memoryTotal);
 return {ramTotal:os.totalmem(),ramFree:availableRAM(),cpuLoad:os.platform()==='win32'?null:os.loadavg()[0],
  vramUsed:gpu&&gpu.memoryTotal!==null&&gpu.memoryFree!==null?gpu.memoryTotal-gpu.memoryFree:null,
  vramTotal:gpu?.memoryTotal??null,gpuLoad:card?number(`/sys/class/drm/${card}/device/gpu_busy_percent`):null};
}
export function baseHardwareProfile(platform:string,architecture:string,cpu:string,cpuThreads:number,ramTotal:number,ramAvailable:number):HardwareProfile {
 const unifiedMemory=platform==='darwin'&&architecture==='arm64';
 return {platform,architecture,cpu,cpuThreads,ramTotal,ramAvailable,unifiedMemory,
  gpus:unifiedMemory?[{name:cpu.startsWith('Apple')?cpu+' GPU':'Apple Silicon GPU',memoryTotal:null,memoryFree:null,source:'apple-unified'}]:[],warnings:[]};
}
export function parseNvidiaGPUs(csv:string):GPUInfo[]{
 const mib=1024**2;
 const memory=(text:string)=>text.trim()!==''&&Number.isFinite(Number(text))&&Number(text)>=0?Number(text)*mib:null;
 return csv.trim().split('\n').flatMap(line=>{
  const parts=line.split(',');if(parts.length<3)return [];
  const name=parts.slice(0,-2).join(',').trim(),total=memory(parts.at(-2)!),free=memory(parts.at(-1)!);
  if(!name||!total)return [];
  return [{name,memoryTotal:total,memoryFree:free!==null&&free<=total?free:null,source:'nvidia-smi' as const}];
 });
}
export function parseWindowsGPUs(json:string):GPUInfo[]{
 try{const parsed=JSON.parse(json);return (Array.isArray(parsed)?parsed:[parsed]).flatMap(value=>{
  if(typeof value?.Name!=='string'||!value.Name.trim())return [];
  // CIM AdapterRAM is uint32 and cannot describe modern large GPUs reliably.
  return [{name:value.Name.slice(0,200),memoryTotal:null,memoryFree:null,source:'windows-cim' as const,...(typeof value.DriverVersion==='string'?{driverVersion:value.DriverVersion.slice(0,100)}:{})}];
 });}catch{return [];}
}
export function parseDxgiGPUs(json:string):GPUInfo[]{
 const bytes=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
 try{const values:unknown=JSON.parse(json);if(!Array.isArray(values))return [];
  return values.slice(0,32).flatMap(value=>{
   if(typeof value?.name!=='string'||!value.name.trim()||bytes(value.dedicatedBytes)===null||bytes(value.sharedBytes)===null)return [];
   return [{name:value.name.trim().slice(0,200),memoryTotal:bytes(value.dedicatedBytes),memoryFree:null,memoryBudget:bytes(value.localBudgetBytes),sharedMemoryTotal:bytes(value.sharedBytes),sharedMemoryBudget:bytes(value.sharedBudgetBytes),source:'windows-dxgi' as const}];
  });
 }catch{return [];}
}
export function mergeGPUInventory(groups:GPUInfo[][]):GPUInfo[]{
 const inventory=new Map<string,GPUInfo>();
 for(const group of groups)for(const gpu of group){const key=gpu.name.trim().replace(/\s+/g,' ').toLowerCase(),previous=inventory.get(key);
  if(!previous)inventory.set(key,gpu);
  else if(previous.source==='windows-dxgi'&&gpu.source==='nvidia-smi')inventory.set(key,{...previous,memoryFree:gpu.memoryFree});
  if(gpu.driverVersion)inventory.set(key,{...inventory.get(key)!,driverVersion:gpu.driverVersion});
 }
 return [...inventory.values()];
}
const run=promisify(execFile);
export function gpuProbeCommands(platform:string,environment:NodeJS.ProcessEnv=process.env){
 const system=win32.join(environment.SystemRoot||environment.WINDIR||'C:\\Windows','System32');
 return {
  nvidia:platform==='win32'?win32.join(system,'nvidia-smi.exe'):'nvidia-smi',
  powershell:win32.join(system,'WindowsPowerShell','v1.0','powershell.exe'),
  script:"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; try { @(Get-CimInstance Win32_VideoController -OperationTimeoutSec 6 | Select-Object Name,DriverVersion) | ConvertTo-Json -Compress } catch { @(Get-PnpDevice -Class Display -PresentOnly | Select-Object @{Name='Name';Expression={$_.FriendlyName}}) | ConvertTo-Json -Compress }",
 };
}
async function probeGPUs(platform:string,signal:AbortSignal):Promise<GPUInfo[]>{
 if(platform==='darwin')return [];
 const commands=gpuProbeCommands(platform);
 const probes:Promise<GPUInfo[]>[]=[];
 if(platform==='win32')probes.push(run(resourcePath('native/hardware/bambi-gpu.exe'),[],{timeout:8000,maxBuffer:65536,windowsHide:true,signal}).then(result=>parseDxgiGPUs(result.stdout.replace(/^\uFEFF/,''))));
 probes.push(run(commands.nvidia,['--query-gpu=name,memory.total,memory.free','--format=csv,noheader,nounits'],{timeout:2500,maxBuffer:65536,windowsHide:true,signal}).then(result=>parseNvidiaGPUs(result.stdout)));
 if(platform==='win32')probes.push(run(commands.powershell,['-NoProfile','-NonInteractive','-Command',commands.script],{timeout:7500,maxBuffer:65536,windowsHide:true,signal}).then(result=>parseWindowsGPUs(result.stdout.replace(/^\uFEFF/,''))));
 const results=await Promise.allSettled(probes);
 const detected=mergeGPUInventory(results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]));
 const names=new Set(detected.filter(gpu=>gpu.source==='nvidia-smi').map(gpu=>gpu.name));
 return [...detected.filter(gpu=>gpu.source!=='windows-cim'||!names.has(gpu.name)),...linuxGPUs().filter(gpu=>!detected.some(other=>other.source==='nvidia-smi'&&gpu.name==='NVIDIA GPU'))];
}
let gpuCache:Promise<GPUInfo[]>|undefined,gpuCacheTime=0,gpuProbing=false;
export async function hardwareProfile(refresh=false):Promise<HardwareProfile>{
 const cpus=os.cpus(),platform=os.platform();
 const profile=baseHardwareProfile(platform,os.arch(),cpus[0]?.model??'Unknown CPU',cpus.length,os.totalmem(),availableRAM());
 if(!profile.unifiedMemory){
  if(!gpuCache||!gpuProbing&&(refresh||Date.now()-gpuCacheTime>60000)){gpuProbing=true;gpuCacheTime=Date.now();gpuCache=boundedGPUProbe(signal=>probeGPUs(platform,signal),8000).catch(()=>[]).finally(()=>{gpuProbing=false;});}
  profile.gpus=await gpuCache;
  if(!profile.gpus.some(gpu=>gpu.memoryTotal!==null))profile.warnings.push('Dedicated GPU memory could not be measured. GPU acceleration needs a real runtime test.');
 }
 return profile;
}

export async function boundedGPUProbe<T>(probe:(signal:AbortSignal)=>Promise<T>,timeoutMs:number):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([probe(controller.signal),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('GPU discovery exceeded its deadline.'));},timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
