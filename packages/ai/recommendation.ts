// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {HardwareProfile} from '../hardware';

export interface ModelCandidate {
 id:string;
 label:string;
 weightsBytes:number|null;
 contextTokens:number;
 backend:'ollama'|'llama.cpp';
 installed:boolean;
 priority:number;
 desktopSupported?:boolean;
 qualification?:'reference-tested'|'experimental'|'development-only';
 description?:string;
 sourceUrl?:string;
 downloadBytes?:number;
 canDownload?:boolean;
 promptCompatible?:boolean;
}
export interface ModelAssessment extends ModelCandidate {
 estimatedWorkingBytes:number|null;
 memoryFit:'fits'|'tight'|'too-large'|'unknown';
 execution:'unified-memory'|'gpu'|'cpu-or-partial'|'unknown';
 runtime:'available'|'setup-needed'|'platform-pending';
 reasons:string[];
}
export interface ModelRecommendation {
 hardware:HardwareProfile;
 recommended:ModelAssessment|null;
 alternatives:ModelAssessment[];
 reserveBytes:number;
 warnings:string[];
 method:'memory-estimate';
}
const GiB=1024**3;
export function recommendModels(hardware:HardwareProfile,candidates:ModelCandidate[],backends:{ollama:boolean;native:boolean;platformReady?:boolean}):ModelRecommendation {
 // Explicit estimates, not measured model requirements or speed guarantees.
 const reserveBytes=Math.max(4*GiB,hardware.ramTotal*.2);
 const ramBudget=Math.max(0,hardware.ramTotal-reserveBytes);
 const largestGPU=hardware.gpus.reduce((largest,gpu)=>Math.max(largest,gpu.memoryTotal??0),0);
 const gpuBudget=Math.max(0,largestGPU-1.5*GiB);
 const platformReady=backends.platformReady??(hardware.platform==='linux'&&hardware.architecture==='x64');
 const alternatives:ModelAssessment[]=candidates.map(candidate=>{
  const weights=candidate.weightsBytes;
  const estimatedWorkingBytes=weights!==null&&Number.isFinite(weights)&&weights>0&&Number.isFinite(candidate.contextTokens)&&candidate.contextTokens>0
   ?Math.ceil(weights+Math.max(2*GiB,weights*.2)+candidate.contextTokens*64*1024):null;
  const fitsRAM=estimatedWorkingBytes!==null&&estimatedWorkingBytes<=ramBudget;
  const fitsGPU=!hardware.unifiedMemory&&estimatedWorkingBytes!==null&&estimatedWorkingBytes<=gpuBudget;
  // Native large MoE profiles still use CPU memory; require RAM headroom too.
  const memoryFit=estimatedWorkingBytes===null?'unknown':fitsRAM?'fits':estimatedWorkingBytes<=ramBudget*1.1?'tight':'too-large';
  const runtime=!platformReady?'platform-pending':candidate.installed&&backends[candidate.backend==='ollama'?'ollama':'native']?'available':'setup-needed';
  const execution=hardware.unifiedMemory?'unified-memory':fitsGPU?'gpu':fitsRAM?'cpu-or-partial':'unknown';
  const reasons:string[]=[];
  if(memoryFit==='unknown')reasons.push('Model size is unknown; install metadata or a reviewed size record is needed before estimating fit.');
  else if(memoryFit==='fits')reasons.push(`Estimated working memory fits while reserving ${(reserveBytes/GiB).toFixed(1)} GiB for the OS, voice, microphone and browser.`);
  else if(memoryFit==='tight')reasons.push('Memory is close to the conservative limit. Start with a smaller model.');
  else reasons.push('Estimated working memory exceeds the conservative RAM budget.');
  if(hardware.unifiedMemory)reasons.push('Apple Silicon shares memory between CPU and GPU; RAM and GPU memory are counted once.');
  else if(fitsGPU)reasons.push('It may fit in one detected GPU. Drivers and actual offloading still need verification.');
  else if(fitsRAM)reasons.push('Full GPU offloading is not established; CPU or partial offloading may be slower.');
  if(runtime==='platform-pending')reasons.push('The app’s local AI start/stop integration is currently Linux x64 only. This is a hardware suggestion for a future platform test.');
  else if(runtime==='setup-needed')reasons.push(candidate.installed?'The local backend still needs setup or a runtime check.':'This model is not installed.');
  if(candidate.promptCompatible===false)reasons.push('The configured context is too short for the complete default companion prompt. It is not recommended for that session.');
  return {...candidate,estimatedWorkingBytes,memoryFit,execution,runtime,reasons};
 });
 const fit=alternatives.filter(model=>model.memoryFit==='fits'&&model.desktopSupported!==false&&model.promptCompatible!==false);
 fit.sort((a,b)=>Number(b.qualification==='reference-tested')-Number(a.qualification==='reference-tested')||Number(b.runtime==='available')-Number(a.runtime==='available')||Number(b.installed)-Number(a.installed)||Number(b.execution==='gpu')-Number(a.execution==='gpu')||b.priority-a.priority||(a.estimatedWorkingBytes??Infinity)-(b.estimatedWorkingBytes??Infinity));
 const warnings=[...hardware.warnings,'Memory fit is an estimate. A real first-run timing and memory check is still required.'];
 if(hardware.ramAvailable<Math.max(2*GiB,hardware.ramTotal*.15))warnings.push('Available RAM is low right now. Close other apps or account for an already loaded model before testing.');
 if(!platformReady)warnings.push('Local model launch on this operating system is not ready in this app yet.');
 if(!fit.length)warnings.push('No supported model with sufficient context fits the conservative memory budget. A smaller reviewed model or a different setup is needed.');
 return {hardware,recommended:fit[0]??null,alternatives,reserveBytes,warnings,method:'memory-estimate'};
}
