// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {preflightReplyContext} from '../packages/ai/preflight';
import {buildRuntimePrompt,defaultTriggers} from '../packages/content';
import {sessionPhases} from '../packages/session-director/phases';
import {darkRoast,roleplayQwenIQ4,defiantFableMtpBaseline,modelContext} from '../packages/ai/models';

const base=buildRuntimePrompt('bambisleep-classic','Bambi',defaultTriggers,false,'').core;
const settings={context:16384,maxTokens:2048,safetyTokens:256,soundDesign:false,selectedTriggers:defaultTriggers,narration:true,tokenCount:'exact' as const};
test('a successful tiny prefix warmup is insufficient when full narration cannot fit',async()=>{
 await assert.rejects(preflightReplyContext(base,settings,async messages=>messages[0].content.includes('=== SESSION NARRATION LENGTH ===')?14928:14607),/too little context for narration/);
 // The same model remains usable for shorter conversations when narration is disabled.
 const conversational=await preflightReplyContext(base,{...settings,narration:false},async()=>14607);
 assert.equal(conversational.length,1);assert.equal(conversational[0].maxTokens,1521);
});
test('preflight keeps the entire authored prompt and checks every narration phase',async()=>{
 const prompts:string[]=[];
 const budgets=await preflightReplyContext(base,{...settings,context:24576,soundDesign:true},async messages=>{prompts.push(messages[0].content);return 15000;});
 assert.deepEqual(budgets.filter(b=>b.mode==='narration').map(b=>b.phase),sessionPhases);
 assert.ok(prompts.every(prompt=>prompt.startsWith(base)));
 assert.ok(prompts.slice(1).every(prompt=>prompt.includes('=== SOUND CONTROL ===')));
 assert.ok(budgets.every(b=>b.maxTokens===2048&&b.historyRoomTokens===7272));
});
test('tokenizer outages and cancellations keep their original meaning',async()=>{
 for(const error of [Error('Local tokenizer HTTP 503'),new DOMException('Cancelled','AbortError')])
  await assert.rejects(preflightReplyContext(base,settings,async()=>{throw error;}),actual=>actual===error);
});
test('estimated budgets are identified rather than presented as exact model limits',async()=>{
 await assert.rejects(preflightReplyContext(base,{...settings,tokenCount:'estimate'},async()=>17000),/estimated budget/);
});

test('app 9B context accommodates the measured Classic trigger configuration without cutting the persona or narration reserve',async()=>{
 // Measured from the native tokenizer with four selected cues and sound metadata.
 const measuredInput=14223;
 await assert.rejects(preflightReplyContext(base,settings,async()=>measuredInput),/too little context for narration/);
 for(const model of [darkRoast,roleplayQwenIQ4,defiantFableMtpBaseline]){
  const budgets=await preflightReplyContext(base,{...settings,context:modelContext(model,'bambisleep-classic'),maxTokens:8192},async messages=>{
   assert(messages[0].content.startsWith(base));return measuredInput;
  });
  assert.equal(budgets.length,6);
  assert(budgets.every(b=>b.maxTokens===8192));
  assert(budgets.every(b=>b.inputTokens+b.maxTokens+settings.safetyTokens<=24576));
 }
});
