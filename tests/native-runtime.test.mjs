// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('native ownership, recovery and process registry use isolated OS processes', {skip:process.platform!=='linux'},()=>{
 const result=spawnSync('/usr/bin/python3',['tests/native_runtime_test.py'],{encoding:'utf8',timeout:25000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});

test('native starter exposes a readable error instead of subprocess commands and traceback', {skip:process.platform!=='linux'},async()=>{
 const {prepareNativeModel}=await import('../packages/ai/runtime.ts');
 await assert.rejects(prepareNativeModel('not-a-pinned-native-model',24576),error=>{
  assert.equal(error.message,'The selected model is not in the pinned local registry.');
  assert.ok(!error.message.includes('Command failed'));assert.ok(!error.message.includes('Traceback'));return true;
 });
});

test('already cancelled native start and stop never touch a running model',async()=>{
 const {prepareNativeModel,stopNativeModel}=await import('../packages/ai/runtime.ts');
 const controller=new AbortController();controller.abort();
 await assert.rejects(prepareNativeModel('bambi-qwen35-9b-hauhau:q4_k_m',24576,controller.signal),{name:'AbortError'});
 await assert.rejects(stopNativeModel(controller.signal),{name:'AbortError'});
});
