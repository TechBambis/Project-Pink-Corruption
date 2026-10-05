// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {isSessionNarration,replyTokenBudget,narrationPassageComplete,spokenWordCount,replyTaskDirection,requestedWordRange} from '../packages/ai/response';
import {buildReplyPrompt,buildFixedReplyPrompt} from '../packages/ai/prompt';
import {snapshotSession} from '../packages/ai/session-state';
import {phaseConfig} from '../packages/content/phases';

const session=snapshotSession({elapsedSeconds:0,totalSeconds:1200,scene:'Minimal Dark',intensityPercent:0,activeTriggers:[],lastTrigger:null});
test('greetings and full passage requests use session length while interjections remain conversation',()=>{
 for(const text of ['Hello!','Hi Bambi.','continue','new script','Please guide me through a relaxation session.','Starte die Session.'])assert.ok(isSessionNarration(text,'bambisleep-classic',true),text);
 for(const text of ['Why do you say hello?','Please speak more slowly.','What does that word mean?','I can hear you.','Please stop.'])assert.equal(isSessionNarration(text,'bambisleep-classic',true),false,text);
 assert.equal(isSessionNarration('Hello!','custom',true),false);
 assert.equal(isSessionNarration('Current phase guidance','bambisleep-classic',false),true);
});
test('passages finish at a complete sentence after their phase word limit, excluding markers',()=>{
 const words='Rest gently. [pause:normal] '.repeat(200);
 assert.equal(spokenWordCount(words),400);assert.equal(narrationPassageComplete(words,'induction'),true);
 assert.equal(narrationPassageComplete(words+'The next sentence has started','induction'),false);
 assert.equal(narrationPassageComplete('Rest. [pause:normal] '.repeat(399),'induction'),false);
 assert.equal(narrationPassageComplete('Rest. '.repeat(250),'awakening'),true);
});
test('a session passage cannot be clipped by short length or latency preferences',()=>{
 for(const selected of [120,220,600,1024,2048])for(const latency of [true,false])assert.equal(replyTokenBudget(selected,latency,true),2048);
 assert.equal(replyTokenBudget(8192,true,true),8192);
 assert.equal(replyTokenBudget(600,false,false),600);assert.equal(replyTokenBudget(8192,true,false),8192);
});
test('continuation follows the preceding task and explicit brevity overrides full passage targets',()=>{
 assert.equal(isSessionNarration('continue','bambisleep-classic',true,'Explain why changing volume does not change pitch.'),false);
 assert.equal(isSessionNarration('continue','bambisleep-classic',true,'Start a relaxation session.'),true);
 for(const request of ['In one sentence, describe relaxation.','Keep it short.','In einem Satz bitte.']){
  assert.equal(isSessionNarration(request,'bambisleep-classic',false),false,request);
  assert.ok(replyTaskDirection(request,false).includes('Do not apply a minimum passage length'));
 }
 assert.equal(replyTokenBudget(600,true,false),600,'Latency cannot silently clip a requested explanation');
});
test('explicit word targets have room to finish and replace the default phase ceiling',()=>{
 assert.deepEqual(requestedWordRange('Use 180-220 words.'),{min:180,max:220});
 assert.deepEqual(requestedWordRange('About 200 words.'),{min:180,max:220});
 assert.deepEqual(requestedWordRange('Genau 100 Wörter.'),{min:100,max:100});
 assert.equal(requestedWordRange('400-200 words.'),undefined);
 assert.equal(replyTokenBudget(220,true,false,'Explain this in 180-220 words.'),880);
 assert.equal(narrationPassageComplete('Rest. '.repeat(400),'induction','Use 500 words.'),false);
 assert.equal(narrationPassageComplete('Rest. '.repeat(220),'induction','Use 180-220 words.'),true);
});
test('full narration and brief conversation get separate instructions after the same cached prefix',()=>{
 const base='Gentle nonsexual relaxation narrator.';
 const full=buildReplyPrompt(base,'Hello',false,'Devices off',session,'',true,true);
 const short=buildReplyPrompt(base,'Please speak more slowly.',false,'Devices off',session,'',true,false);
 for(const prompt of [full,short])assert.ok(prompt.startsWith(buildFixedReplyPrompt(base)));
 assert.ok(full.includes('Induction 300-400 words'));assert.ok(full.includes('Current response is a complete session passage'));
 assert.ok(full.includes('Never open an induction with Hello or Hi'));assert.ok(full.includes('Do not claim to see the listener'));
 assert.ok(!full.includes('continue a long script only when the user requests it'));
 assert.ok(short.includes('this describes each sentence, not the total answer length'));
 assert.ok(!short.includes('naturally and concisely'));
 assert.ok(full.includes(phaseConfig.phases.induction));
 assert.ok(!short.includes(phaseConfig.phases.induction),'A factual or conversational reply must not inherit the extra phase passage directive');
});
test('conversational greetings acknowledge presence in-character without starting a session',()=>{
 for(const greeting of ['Hi Bambi','Hello!','Hey sweetie.','Hallo']){
  const direction=replyTaskDirection(greeting,false);
  const immediate=direction.split('\n').find(line=>line.startsWith('Immediate task:'));
  assert.ok(immediate,greeting);
  assert.match(immediate,/one or two short in-character sentences/);
  assert.match(immediate,/Acknowledge her presence/);
  assert.match(immediate,/possessive, certain, quiet/);
  assert.match(immediate,/A session has not been requested/);
  assert.match(immediate,/Do not give instructions to relax, breathe, sit, lie down or close eyes/);
  assert.match(immediate,/Do not describe the listener's body, surroundings, voice or prior visits/);
  assert.ok(!replyTaskDirection(greeting,true).split('\n').some(line=>line.startsWith('Immediate task:')));
 }
 assert.ok(!replyTaskDirection('Explain volume.',false).split('\n').some(line=>line.startsWith('Immediate task:')));
});
