// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {readFileSync,readdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';

export interface GPUInfo {
 name:string;
 memoryTotal:number|null;
 memoryFree:number|null;
 source:'linux-sysfs'|'nvidia-smi'|'windows-cim'|'apple-unified';
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
 if(!total)return [];
 let name='Graphics device';try{const vendor=readFileSync(path+'vendor','utf8').trim();name=vendor==='0x1002'?'AMD GPU':vendor==='0x10de'?'NVIDIA GPU':vendor==='0x8086'?'Intel GPU':name;}catch{}
 return [{name,memoryTotal:total,memoryFree:used!==null&&used<=total?total-used:null,source:'linux-sysfs' as const}];
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
  return [{name:value.Name.slice(0,200),memoryTotal:null,memoryFree:null,source:'windows-cim' as const}];
 });}catch{return [];}
}
const run=promisify(execFile);
async function probeGPUs(platform:string):Promise<GPUInfo[]>{
 if(platform==='darwin')return [];
 const probes=[run('nvidia-smi',['--query-gpu=name,memory.total,memory.free','--format=csv,noheader,nounits'],{timeout:2500,maxBuffer:65536,windowsHide:true}).then(result=>parseNvidiaGPUs(result.stdout))];
 if(platform==='win32')probes.push(run('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress'],{timeout:2500,maxBuffer:65536,windowsHide:true}).then(result=>parseWindowsGPUs(result.stdout)));
 const results=await Promise.allSettled(probes);
 const detected=results.flatMap(result=>result.status==='fulfilled'?result.value:[]);
 const names=new Set(detected.filter(gpu=>gpu.source==='nvidia-smi').map(gpu=>gpu.name));
 return [...detected.filter(gpu=>gpu.source!=='windows-cim'||!names.has(gpu.name)),...linuxGPUs().filter(gpu=>!detected.some(other=>other.source==='nvidia-smi'&&gpu.name==='NVIDIA GPU'))];
}
let gpuCache:Promise<GPUInfo[]>|undefined,gpuCacheTime=0;
export async function hardwareProfile():Promise<HardwareProfile>{
 const cpus=os.cpus(),platform=os.platform();
 const profile=baseHardwareProfile(platform,os.arch(),cpus[0]?.model??'Unknown CPU',cpus.length,os.totalmem(),availableRAM());
 if(!profile.unifiedMemory){
  if(!gpuCache||Date.now()-gpuCacheTime>60000){gpuCache=probeGPUs(platform);gpuCacheTime=Date.now();}
  profile.gpus=await gpuCache;
  if(!profile.gpus.some(gpu=>gpu.memoryTotal!==null))profile.warnings.push('Dedicated GPU memory could not be measured. GPU acceleration needs a real runtime test.');
 }
 return profile;
}
