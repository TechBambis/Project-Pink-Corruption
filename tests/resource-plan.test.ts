// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {resourcePlan} from '../packages/runtime/resource-plan';
import {baseHardwareProfile,parseDxgiGPUs,mergeGPUInventory,parseWindowsGPUs,parseNvidiaGPUs} from '../packages/hardware';
import {recommendModels} from '../packages/ai/recommendation';
import {modelInventory} from '../packages/ai/model-inventory';
import {communityQwen,communityQwen2B,liquidSmall,communityQwen4B} from '../packages/ai/models';
const GiB=2**30;
const catalog=modelInventory({models:[]},{desktop:true});

test('8 GB integrated, 16 GB laptop and large GPU hosts receive usable distinct plans',()=>{
 for(const [ram,expected,mode] of [[7.7,communityQwen2B,'compact'],[15.4,communityQwen4B,'balanced'],[64,communityQwen,'roomy']] as const){
  const host=baseHardwareProfile('win32','x64','Test CPU',8,ram*GiB,6*GiB);
  host.gpus=parseDxgiGPUs(JSON.stringify([{name:'Integrated graphics',dedicatedBytes:128*2**20,sharedBytes:Math.floor(ram*GiB/2),localBudgetBytes:Math.floor(ram*GiB/2)}]));
  const result=recommendModels(host,catalog,{native:true,ollama:false,platformReady:true});
  assert.equal(result.recommended?.id,expected);assert.equal(result.recommended?.resourcePlan.mode,mode);
  assert.equal(result.recommended?.resourcePlan.context,24576);assert.notEqual(result.recommended?.execution,'gpu');
  assert(result.recommended!.estimatedWorkingBytes!<=host.ramTotal-result.reserveBytes);
 }
 const gpuHost=baseHardwareProfile('linux','x64','CPU',16,32*GiB,24*GiB);
 gpuHost.gpus=parseNvidiaGPUs('Dedicated GPU, 24576, 22000');
 const result=recommendModels(gpuHost,catalog,{native:true,ollama:false,platformReady:true});
 assert.equal(result.recommended?.id,communityQwen);assert.equal(result.recommended?.execution,'gpu');
});

test('unknown architectures keep conservative estimates and unsuitable/short-context models stay excluded',()=>{
 const host=baseHardwareProfile('win32','x64','CPU',4,8*GiB,6*GiB);
 const unsupported=catalog.find(model=>model.id===communityQwen4B)!;
 const unknown={...unsupported,id:'unknown',memoryProfile:undefined};
 const result=recommendModels(host,[unknown,{...unsupported,id:'unsupported',desktopSupported:false},{...unsupported,id:'short-context',promptCompatible:false}],{native:true,ollama:false,platformReady:true});
 assert.equal(result.recommended,null);assert.equal(result.alternatives[0].resourcePlan.estimate,'generic');
 assert.equal(resourcePlan(host,{weightsBytes:null,contextTokens:24576}).estimatedWorkingBytes,null);
});

test('DXGI preserves dedicated and shared capacities separately without fabricating globally free memory',()=>{
 const cards=parseDxgiGPUs(JSON.stringify([{name:'AMD Radeon',dedicatedBytes:128*2**20,sharedBytes:8*GiB,localBudgetBytes:6*GiB,sharedBudgetBytes:4*GiB},{name:'Broken',dedicatedBytes:-1,sharedBytes:8*GiB}]));
 assert.equal(cards.length,1);assert.equal(cards[0].memoryTotal,128*2**20);assert.equal(cards[0].sharedMemoryTotal,8*GiB);assert.equal(cards[0].memoryFree,null);
 assert.equal(parseDxgiGPUs('{').length,0);assert.equal(parseDxgiGPUs('{}').length,0);
 const merged=mergeGPUInventory([cards,parseWindowsGPUs('[{"Name":"AMD Radeon"},{"Name":"Other adapter"}]')]);
 assert.equal(merged.length,2);assert.equal(merged[0].source,'windows-dxgi');
 const nvidia=mergeGPUInventory([parseDxgiGPUs('[{"name":"RTX","dedicatedBytes":8589934592,"sharedBytes":8589934592,"localBudgetBytes":6442450944}]'),parseNvidiaGPUs('RTX, 8192, 4096')]);
 assert.equal(nvidia.length,1);assert.equal(nvidia[0].memoryBudget,6*GiB);assert.equal(nvidia[0].memoryFree,4*GiB);
});

test('shared memory capacity and small driver budget cannot establish full GPU fit',()=>{
 const host=baseHardwareProfile('win32','x64','CPU',8,16*GiB,12*GiB);
 host.gpus=parseDxgiGPUs('[{"name":"GPU","dedicatedBytes":25769803776,"sharedBytes":8589934592,"localBudgetBytes":1073741824}]');
 const result=recommendModels(host,catalog,{native:true,ollama:false,platformReady:true});
 assert.equal(result.recommended?.id,communityQwen4B);assert.equal(result.recommended?.execution,'cpu-or-partial');
});

test('a small model fitting in an 8 GB GPU does not displace the 4B ordinary-laptop preference',()=>{
 const host=baseHardwareProfile('win32','x64','CPU',12,16*GiB,10*GiB);
 host.gpus=parseNvidiaGPUs('Dedicated GPU, 8192, 7000');
 const result=recommendModels(host,catalog,{native:true,ollama:false,platformReady:true});
 assert.equal(result.recommended?.id,communityQwen4B);
 assert(result.alternatives.some(model=>model.id===communityQwen2B&&model.execution==='gpu'));
});

test('tiny full-context alternatives have architecture-specific budgets and never add shared RAM',()=>{
 for(const [ram,expected] of [[6,liquidSmall],[8,communityQwen2B],[16,communityQwen4B]] as const){
  const host=baseHardwareProfile('linux','x64','CPU',4,ram*GiB,4*GiB);
  const result=recommendModels(host,catalog,{native:true,ollama:false,platformReady:true});
  assert.equal(result.recommended?.id,expected);assert.equal(result.recommended?.contextTokens,24576);
  assert(result.recommended!.estimatedWorkingBytes!<=ram*GiB-result.reserveBytes);
 }
 const small=catalog.find(model=>model.id===communityQwen2B)!;
 const plan=resourcePlan({ramTotal:8*GiB},small);
 assert.equal(plan.promptCacheMiB,512);assert.equal(plan.checkpoints,8);
 assert(plan.estimatedWorkingBytes!<4.3*GiB);
});
