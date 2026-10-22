// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {SituationalTurnStream,SituationalConversation,expectsSituationalReply,situationalPassageComplete,situationalReplyDirection} from '../packages/ai/situational';
import {buildSituationalBase} from '../packages/content/situational';
import {buildFixedReplyPrompt,buildReplyPrompt} from '../packages/ai/prompt';
import {buildRuntimePrompt} from '../packages/content';
import {ChatRequestSchema} from '../packages/ai/request';
import {ScriptDisplayStream} from '../packages/speech/script';
import {NarrationFlow,narrationDirective} from '../packages/session-director/narration';
import {snapshotSession,type SessionState} from '../packages/ai/session-state';
import {defaultTriggerTiming} from '../packages/session-director/trigger-timing';
import {preflightReplyContext} from '../packages/ai/preflight';

test('split internal headers never appear in the contribution, and ask ends at its question',()=>{
 const source='  [turn:ask] Which image feels familiar? I will choose for you.';
 for(let cut=0;cut<=source.length;cut++){
  const stream=new SituationalTurnStream();
  const output=stream.push(source.slice(0,cut))+stream.push(source.slice(cut))+stream.flush();
  assert.equal(output,'Which image feels familiar?',`split ${cut}`);
  assert.equal(stream.action,'ask');assert.equal(stream.complete,true);
  assert.equal(stream.push(' Another question?'),'');
 }
 const stream=new SituationalTurnStream();let output='';
 for(const char of source)output+=stream.push(char);
 assert.equal(output+stream.flush(),'Which image feels familiar?');
});

test('ordinary output remains usable and malformed internal headers fail without opening a reply window',()=>{
 for(const [input,expected] of [['A plain response.','A plain response.'],['[turn:unknown] A plain response.','A plain response.'],['[turn:as',''],['[turn:ask','']]){
  const stream=new SituationalTurnStream();assert.equal(stream.push(input)+stream.flush(),expected);assert.equal(stream.action,'respond');
 }
 const stream=new SituationalTurnStream();assert.equal(stream.push('[turn:guide] Notice the color? You can let it rest.'),'Notice the color? You can let it rest.');
 assert.equal(expectsSituationalReply(stream.action,'Notice the color?'),false,'rhetorical invitations do not stall playback');
});

test('case, spacing and trailing-colon header variants remain private at every stream split',()=>{
 for(const header of ['[turn: ask]','[turn:ask]:','[Turn:Ask]','[ TURN : ASK ]']){
  const source=header+' Which image feels familiar? I will answer myself.';
  for(let cut=0;cut<=source.length;cut++){
   const stream=new SituationalTurnStream();
   const text=stream.push(source.slice(0,cut))+stream.push(source.slice(cut))+stream.flush();
   assert.equal(text,'Which image feels familiar?',`${header}, split ${cut}`);
   assert.equal(stream.action,'ask');assert.equal(stream.deliveredAction(text),'ask');
  }
 }
});

test('missing or invalid metadata infers a question only from completely delivered text',()=>{
 for(const prefix of ['','[turn:unknown] ','[Turn: invalid]: ']){
  const source=prefix+'Which image feels familiar?',stream=new SituationalTurnStream();let text='';
  for(const char of source)text+=stream.push(char);
  text+=stream.flush();assert.equal(text,'Which image feels familiar?');
  assert.equal(stream.action,'respond','draft punctuation must not assign a delivered action');
  assert.equal(stream.deliveredAction('Which image feels'),'respond');
  assert.equal(stream.deliveredAction(''),'respond');
  assert.equal(stream.deliveredAction(text),'ask');
  assert.equal(stream.deliveredAction(text,true),'respond','closing cannot infer a question');
  const state=new SituationalConversation();assert.equal(state.delivered(stream.deliveredAction(text),text),true);
  assert.match(state.context(),/"deliveredQuestion":"Which image feels familiar\?"/);
 }
 const stream=new SituationalTurnStream();
 const response=stream.push('Why use a lower volume? It preserves comfort.')+stream.flush();
 assert.equal(stream.deliveredAction(response),'respond','a question followed by an answer is not a reply request');
 const quoted=new SituationalTurnStream();quoted.push('Which color?');assert.equal(quoted.deliveredAction('Which color?” [pause:medium]'),'ask');
});

test('an explicit guide or response remains authoritative even when its final sentence ends in a question mark',()=>{
 for(const action of ['guide','respond','close'] as const){
  const stream=new SituationalTurnStream(),text=stream.push(`[turn:${action}] Notice the color?`)+stream.flush();
  assert.equal(stream.deliveredAction(text),action);assert.equal(expectsSituationalReply(stream.deliveredAction(text),text),false);
 }
});

test('only an actually delivered complete question waits; answers and new sessions have distinct evidence',()=>{
 const state=new SituationalConversation();state.observe('I prefer the garden.');
 assert.equal(state.delivered('ask','What is familiar about'),false);
 assert.match(state.context(),/"deliveredQuestion":null/);
 assert.equal(state.delivered('ask','What is familiar about the garden? [pause:medium]'),true);
 state.observe('The light through the leaves.');
 assert.match(state.context(),/light through the leaves/);assert.match(state.context(),/What is familiar about the garden/);
 assert.equal(state.delivered('guide','Imagine the light through those leaves.'),false);
 assert.match(state.context(),/"deliveredQuestion":null/);
 assert.equal(expectsSituationalReply('ask','Any other image?',true),false,'closing cannot wait for an answer');
 assert.doesNotMatch(new SituationalConversation().context(),/garden|leaves/);
 const flow=new NarrationFlow();flow.turnStarted();flow.completed(5,4,state.delivered('ask','Which color?'));
 assert.equal(flow.next(200,300,true),null);
 flow.turnStarted();flow.completed(201,4,state.delivered('guide','Use the color you selected.'));
 assert.notEqual(flow.next(205,300,true),null);
});

test('situational speech preserves valid pauses while hiding other cues and internal headers',()=>{
 const speech=new ScriptDisplayStream(true,true),display=new ScriptDisplayStream();
 const source='Stay with the image. [pause:medium] [SFX:SNAP] [vib:80] Then rest. [pause:invalid]';
 let voiced='',shown='';for(const char of source){voiced+=speech.push(char);shown+=display.push(char);}
 voiced+=speech.flush();shown+=display.flush();
 assert.match(voiced,/\[pause:medium\]/);assert.doesNotMatch(voiced,/SFX|vib|invalid/);assert.doesNotMatch(shown,/\[/);
 assert.equal(situationalPassageComplete('Which image?', 'ask'),true);
 assert.equal(situationalPassageComplete('Stay with this.', 'guide'),false);
});

test('mode has a separate, preflight-compatible prompt; old API requests retain their defaults',async()=>{
 const request=ChatRequestSchema.parse({type:'chat',text:'Hello'});assert.equal(request.interaction,'reactive');assert.equal(request.source,'user');
 const base=buildSituationalBase(request);
 const session=snapshotSession({elapsedSeconds:295,totalSeconds:300,scene:'Soft Pink',intensityPercent:90,activeTriggers:[],lastTrigger:null});
 const system=buildReplyPrompt(base,'Continue',false,'',session,'',false,true,'situational');
 assert.ok(system.startsWith(buildFixedReplyPrompt(base,'situational')));
 assert.match(system,/Choose \[turn:close\]/);assert.match(system,/do not ask a question/);
 assert.match(system,/No question quotas/);
 assert.match(system,/latest real listener request or correction/);
 const authored=buildRuntimePrompt(request.promptId,request.username,request.selectedTriggers,request.collar,request.collarName).core;
 assert.ok(base.startsWith(authored),'situational interaction must preserve the complete chosen character document');
 assert.ok(system.indexOf('REAL LISTENER & CONVERSATION EVIDENCE')>system.indexOf(authored),'conversation priority follows the authored content in every mode');
 assert.match(narrationDirective('deepening',false,100,true),/real answer/);
 assert.match(situationalReplyDirection('Please slow down.',false),/Incorporate corrections/);
 const budget=await preflightReplyContext(base,{context:4096,maxTokens:512,narration:true,interaction:'situational',safetyTokens:256,soundDesign:false,selectedTriggers:[],tokenCount:'exact'},async()=>1200);
 assert.ok(budget);
});

test('the prompt owner supplies one state, budget and active cue timing around turn choice',()=>{
 const session={...snapshotSession({elapsedSeconds:120,totalSeconds:300,scene:'Soft Pink',intensityPercent:60,activeTriggers:['GOOD GIRL'],lastTrigger:'GOOD GIRL'}),phase:'deepening' as const};
 const render=(request:string,narration:boolean,state:SessionState=session)=>buildReplyPrompt('=== BAMBI COMPANION ===\nFixture character.',request,false,'',state,'',!narration,narration,'situational');
 const conversation=render('Which scene is selected?',false);
 assert.match(conversation,/REAL LISTENER INPUT/);assert.match(conversation,/Questions need a useful direct answer/);
 assert.match(conversation,/Scene: "Soft Pink"/);assert.match(conversation,/Intensity: 3/);
 assert.doesNotMatch(conversation,/ENGINE CONTINUATION|gradual countdown|CURRENT TRIGGER TIMING/);
 const narration=render('Continue.',true);
 assert.match(narration,/ENGINE CONTINUATION, not a listener statement/);assert.match(narration,/gradual countdown/);
 assert.equal(narration.split('SESSION STATE (').length-1,1);
 assert.equal(narration.split('Current response length:').length-1,1);
 assert.match(narration,/60-100 spoken words TOTAL/);assert.doesNotMatch(narration,/80–160|phase word target|CURRENT SESSION \(read-only/);
 const timing=defaultTriggerTiming(),timed=render('Continue.',true,{...session,triggerTiming:timing});
 assert.match(timed,/CURRENT TRIGGER TIMING: deepening/);assert.match(timed,/SAFE AND SECURE/);
 assert.match(timed,/Intensity unlocks no other categories/);
 assert.doesNotMatch(render('Continue.',true,{...session,triggerTiming:{...timing,enabled:false}}),/CURRENT TRIGGER TIMING/);
 assert.match(render('Use exactly 12 words.',true),/12-12 spoken words TOTAL/);
 assert.match(render('In one sentence.',false),/Honor the requested number of sentences/);
 const unlimited=render('Continue.',true,{...session,phase:'awakening',continuous:true});
 assert.match(unlimited,/unlimited session continues/);assert.doesNotMatch(unlimited,/Choose \[turn:close\]/);
});
