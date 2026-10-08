// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendModels} from '../packages/ai/recommendation';
import {baseHardwareProfile,parseNvidiaGPUs,parseWindowsGPUs,boundedGPUProbe} from '../packages/hardware';

const gib=1024**3;
test('a stalled GPU subprocess cannot hold hardware recommendations indefinitely',async()=>{
 let signal:AbortSignal|undefined;
 await assert.rejects(boundedGPUProbe(s=>{signal=s;return new Promise(()=>{});},20),/deadline/);
 assert.equal(signal?.aborted,true);
 assert.equal(await boundedGPUProbe(async()=> 'GPU found',20),'GPU found');
});
test('recommendation uses shared Apple memory without inventing discrete VRAM',()=>{
 const hardware=baseHardwareProfile('darwin','arm64','Apple M5',12,16*gib,12*gib);
 const result=recommendModels(hardware,[{id:'small',label:'Small',weightsBytes:4*gib,contextTokens:4096,backend:'ollama',installed:true,priority:1},{id:'large',label:'Large',weightsBytes:14*gib,contextTokens:16384,backend:'ollama',installed:true,priority:100}],{ollama:true,native:false});
 assert.equal(hardware.unifiedMemory,true);assert.equal(hardware.gpus[0].memoryTotal,null);assert.equal(result.recommended?.id,'small');assert.ok(result.recommended?.reasons.some(reason=>reason.includes('Apple Silicon')));assert.ok(result.warnings.some(warning=>warning.includes('operating system')));
});
test('recommendation does not claim a GPU fit from unknown GPU memory',()=>{
 const hardware=baseHardwareProfile('win32','x64','Test CPU',8,32*gib,24*gib);hardware.gpus=parseWindowsGPUs('[{"Name":"Test GPU"}]');
 const result=recommendModels(hardware,[{id:'model',label:'Model',weightsBytes:6*gib,contextTokens:4096,backend:'ollama',installed:true,priority:1}],{ollama:true,native:false});
 assert.equal(result.recommended?.execution,'cpu-or-partial');assert.equal(result.recommended?.runtime,'platform-pending');
});
test('GPU parser validates sizes and ignores malformed entries',()=>{
 const cards=parseNvidiaGPUs('RTX, 8192, 6144\nmalformed');assert.equal(cards.length,1);assert.equal(cards[0].memoryTotal,8192*1024**2);assert.equal(cards[0].memoryFree,6144*1024**2);
});
