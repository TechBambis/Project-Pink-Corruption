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
const runtimeSession=randomUUID();
const run = promisify(execFile);
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
export async function prepareNativeModel(model: string, context: number = BAMBISLEEP_SAMPLING.context, signal?: AbortSignal) {
  if(desktopAlpha){if(model!==desktopSetup!.model||context!==desktopSetup!.context)throw Error('Select and verify this model in Local AI setup first.');await desktopSetup!.prepare(signal);return;}
  // Allow three bounded GPU attempts and CPU preparation, including cleanup.
  await command(['start', '--model', model, '--context', String(context)],660000,signal);
}
export async function stopNativeModel(signal?: AbortSignal) {
  if(desktopAlpha){await desktopServices.stop();return;}
  await command(['stop'],15000,signal);
}
