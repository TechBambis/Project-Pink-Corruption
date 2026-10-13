// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {HardwareProfile} from '../hardware';
import {resourcePlan,type ModelMemoryProfile,type ResourcePlan} from '../runtime/resource-plan';

export interface ModelCandidate {
 id:string;
 label:string;
 weightsBytes:number|null;
 contextTokens:number;
 memoryProfile?:ModelMemoryProfile;
 resourceProfile?:{promptCacheMinimumMiB:number;minimumCheckpoints:number};
 preferredFor?:'compact'|'balanced';
 backend:'ollama'|'llama.cpp';
 installed:boolean;
 /** Size-matching local files are candidates for verification, not proof of readiness. */
 availableForComparison?:boolean;
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
 resourcePlan:ResourcePlan;
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
 const reserveBytes=resourcePlan(hardware,{weightsBytes:null,contextTokens:1}).reserveBytes;
 const ramBudget=Math.max(0,hardware.ramTotal-reserveBytes);
 const largestGPU=hardware.gpus.reduce((largest,gpu)=>Math.max(largest,Math.min(gpu.memoryTotal??0,gpu.memoryBudget??gpu.memoryTotal??0,gpu.memoryFree??gpu.memoryTotal??0)),0);
 const gpuBudget=Math.max(0,largestGPU-1.5*GiB);
 const platformReady=backends.platformReady??(hardware.platform==='linux'&&hardware.architecture==='x64');
 const alternatives:ModelAssessment[]=candidates.map(candidate=>{
  const plan=resourcePlan(hardware,candidate),estimatedWorkingBytes=plan.estimatedWorkingBytes;
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
  if(runtime==='platform-pending')reasons.push('This build does not support local AI startup on this platform. Use an AI-enabled build qualified for your operating system.');
  else if(runtime==='setup-needed')reasons.push(candidate.installed?'The local backend still needs setup or a runtime check.':'This model is not installed.');
  if(candidate.promptCompatible===false)reasons.push('The configured context is too short for the complete default companion prompt. It is not recommended for that session.');
  if(plan.mode==='compact')reasons.push('Uses a smaller cache and processing batches while keeping the full companion instructions. Test conversation and voice on this computer.');
  return {...candidate,estimatedWorkingBytes,memoryFit,execution,runtime,reasons,resourcePlan:plan};
 });
 const fit=alternatives.filter(model=>model.memoryFit==='fits'&&model.desktopSupported!==false&&model.promptCompatible!==false);
 // A smaller dense model is a useful starting point on ordinary laptops when
 // full dedicated-GPU fit is not established. Explicit experimental consent
 // is still required; an existing verified selection is never switched here.
 const laptop=hardware.ramTotal<=20*GiB&&!fit.some(model=>model.execution==='gpu'&&model.qualification==='reference-tested');
 fit.sort((a,b)=>(laptop?Number(b.preferredFor===b.resourcePlan.mode)-Number(a.preferredFor===a.resourcePlan.mode)||(a.weightsBytes??Infinity)-(b.weightsBytes??Infinity):0)||Number(b.qualification==='reference-tested')-Number(a.qualification==='reference-tested')||Number(b.runtime==='available')-Number(a.runtime==='available')||Number(b.installed)-Number(a.installed)||Number(b.execution==='gpu')-Number(a.execution==='gpu')||b.priority-a.priority||(a.estimatedWorkingBytes??Infinity)-(b.estimatedWorkingBytes??Infinity));
 const warnings=[...hardware.warnings,'Memory fit is an estimate. A real first-run timing and memory check is still required.'];
 if(hardware.ramAvailable<Math.max(2*GiB,hardware.ramTotal*.15))warnings.push('Available RAM is low right now. Close other apps or account for an already loaded model before testing.');
 if(!platformReady)warnings.push('Local model launch on this operating system is not ready in this app yet.');
 if(!fit.length)warnings.push('No supported model with sufficient context fits the conservative memory budget. A smaller reviewed model or a different setup is needed.');
 return {hardware,recommended:fit[0]??null,alternatives,reserveBytes,warnings,method:'memory-estimate'};
}
