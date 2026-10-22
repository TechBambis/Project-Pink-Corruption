// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BAMBISLEEP_SAMPLING } from '../../config/sampling';
import {desktopAlpha} from '../runtime/paths';
import {desktopSetup} from '../runtime/desktop-setup';
import {desktopServices} from '../runtime/desktop-services';
import {randomUUID} from 'node:crypto';
import {validateKvCache,type KvCacheMode} from '../runtime/kv-cache';
const runtimeSession=randomUUID();
const run = promisify(execFile);
/** Inventory through the same owned policy as startup; never accept caller loader paths. */
export async function calibrationDevices(context:number,signal:AbortSignal):Promise<import('../runtime/accelerator-policy').AcceleratorDevice[]>{
 if(desktopAlpha)return desktopServices.calibrationDevices(context,signal);
 const {resolve}=await import('node:path'),{acceleratorPlan}=await import('../runtime/accelerator-runtime.mjs'),{acceleratorCandidates}=await import('../runtime/accelerator-policy');
 const plan=await acceleratorPlan({command:{executable:resolve('.runtime/lib/ollama/llama-server')},library:resolve('.runtime/lib/ollama'),platform:process.platform,environment:process.env,mode:'auto',context,signal});
 return acceleratorCandidates(plan.devices,process.platform,[],16);
}
async function command(args: string[], timeout: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    await run('/usr/bin/python3', ['scripts/llama-runtime.py', ...args], { timeout, signal, env:{...process.env,BAMBI_RUNTIME_NODE:process.execPath,BAMBI_RUNTIME_SESSION:runtimeSession} });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const failure=error as {stderr?:string;killed?:boolean};
    for(const line of (failure.stderr??'').trim().split('\n').reverse()){
      let data;
      try {data=JSON.parse(line);}catch {continue;}
      if(data&&typeof data.message==='string'&&data.message.length<1000)throw new Error(data.message);
    }
    throw Error(failure.killed?'Local model preparation timed out. Check runtime/llama.log and try again.':'Local model preparation failed. Check runtime/llama.log and the model installation.');
  }
}
export async function prepareNativeModel(model: string, context: number = BAMBISLEEP_SAMPLING.context, signal?: AbortSignal, kvCache:KvCacheMode='default',dflash:import('../runtime/dflash').DFlashMode='off',tuning?:import('../runtime/runtime-tuning.mjs').RuntimeTuning) {
  signal?.throwIfAborted();validateKvCache(kvCache,model,process.platform);
  const {validateDFlash}=await import('../runtime/dflash');validateDFlash(dflash,model,process.platform);
  if(desktopAlpha&&dflash==='on')throw Error('DFlash testing is available in the Linux local app.');
  if(desktopAlpha){if(model!==desktopSetup!.model||context!==desktopSetup!.context)throw Error('Select and verify this model in Local AI setup first.');await desktopSetup!.prepare(signal,kvCache,tuning);return;}
  // Allow three bounded GPU attempts and CPU preparation, including cleanup.
  const {validateRuntimeTuning}=await import('../runtime/runtime-tuning.mjs');
  await command(['start', '--model', model, '--context', String(context),'--kv-cache',kvCache,'--dflash',dflash,...(tuning?['--tuning',JSON.stringify(validateRuntimeTuning(tuning))]:[])],660000,signal);
}
export async function stopNativeModel(signal?: AbortSignal) {
  if(desktopAlpha){await desktopServices.stop();return;}
  await command(['stop'],15000,signal);
}
