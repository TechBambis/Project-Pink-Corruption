// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCharacterDocument,buildCharacterPrefix,buildEventNarrationPrefix,eventNarrationMessages} from '../packages/ai/character';
import {ChatRequestSchema} from '../packages/ai/request';
import {buildFixedReplyPrompt,buildReplyPrompt} from '../packages/ai/prompt';
import {bambiVoiceDirection} from '../packages/content/voice';
import {interactionDirection} from '../packages/content/interaction';
import {buildRuntimePrompt} from '../packages/content';
import {buildSituationalBase} from '../packages/content/situational';
import {snapshotSession} from '../packages/ai/session-state';
import {fitContext,ContextOverflowError,checkpointContextMessages} from '../packages/ai/context';
import {createReferenceProgram} from '../packages/session-director/events/program';
import {compileEvent} from '../packages/session-director/events/runtime';
import {EventSpeechRequestSchema,renderEventSpeech} from '../packages/session-director/events/speech';
import {resolveReplyIntent} from '../packages/ai/intent';
import {replyTaskContract,replyTaskDirection} from '../packages/ai/response';

test('unchanged reply rules are cached once while current task and evidence follow heard history',()=>{
 const input=ChatRequestSchema.parse({type:'chat',text:'Explain the difference.',collar:true,collarName:'Chosen collar wording',selectedTriggers:['BAMBI SLEEP']});
 const base=buildCharacterDocument(input).core,prefix=buildFixedReplyPrompt(base);
 const history=[{role:'user' as const,content:'A correction.'},{role:'assistant' as const,content:'The heard answer.'}];
 for(const narration of [false,true]){
  const request=narration?'Continue the session.':'In one sentence, explain the difference.';
  const system=buildReplyPrompt(base,request,false,'',undefined,'Current quoted evidence.',true,narration);
  assert.ok(system.startsWith(prefix));assert.ok(prefix.includes(replyTaskContract));
  assert.equal(system.split(replyTaskContract).length-1,1);
  for(const rule of replyTaskContract.split('\n').slice(1))assert.ok(system.includes(rule));
  const messages=checkpointContextMessages([{role:'system',content:system},...history,{role:'user',content:request}],prefix);
  assert.ok(system.includes(base));assert.ok(system.includes(replyTaskDirection(request,narration,false)));
  assert.ok(!system.slice(prefix.length).includes(replyTaskContract));
  assert.deepEqual(messages.slice(2,-2),history);
  assert.ok(messages[0].content.includes(replyTaskContract));
  assert.ok(messages.at(-2)!.content.includes('Current quoted evidence.'));
  assert.ok(messages.at(-2)!.content.includes(replyTaskDirection(request,narration,false)));
  assert.equal(messages.at(-1)!.content,request);
 }
});

test('English conversation is selectable across reply, preparation and event contracts and preserves its complete optional sections',()=>{
 const input=ChatRequestSchema.parse({type:'chat',text:'Hi',promptId:'english-conversation',username:'Explorer',collar:true,collarName:'Silver constellation',selectedTriggers:['BAMBI SLEEP']});
 const authored=buildCharacterDocument(input).core;
 assert.match(authored,/speaking with Explorer/);assert.match(authored,/Silver constellation/);assert.match(authored,/BAMBI SLEEP/);
 assert.match(authored,/Address the strongest relevant objection directly/);assert.match(authored,/acknowledge it and improve your answer/);
 assert.doesNotMatch(authored,/FALSE MEMORY|CHANGE THE SUBJECT|STRATEGY ENGINE/);
 assert.ok(buildReplyPrompt(authored,'Explain that objection.',false,'',undefined,'',true,false).startsWith(authored));
 assert.ok(buildFixedReplyPrompt(authored).startsWith(authored));assert.ok(buildEventNarrationPrefix(input).startsWith(authored));
 assert.equal(resolveReplyIntent('Hi','english-conversation',true),'conversation');
 assert.equal(resolveReplyIntent('Continue','english-conversation',true,undefined,'conversation'),'conversation');
 assert.equal(resolveReplyIntent('Guide me through a relaxation session','english-conversation',true),'narration');
 assert.equal(resolveReplyIntent('Start','bambisleep-classic',true),'narration');
});

test('shared delivery does not impose a character on Gentle or a custom personality',()=>{
 for(const promptId of ['gentle-induction','custom'] as const){
  const request=ChatRequestSchema.parse({type:'chat',text:'Hi',promptId,persona:'A cheerful botanical storyteller who calls the listener explorer.'});
  const authored=buildCharacterDocument(request).core;
  for(const mode of ['reactive','situational'] as const){
   const base=mode==='situational'?buildSituationalBase(request,authored):authored;
   const prompt=buildReplyPrompt(base,request.text,false,'Devices off',undefined,'',true,false,mode);
   assert.ok(prompt.startsWith(authored));
   assert.doesNotMatch(prompt,/I own this|I don.t need your permission|40% tender|20-50 short sentences|Good girl.*only endearment|You .remember. things that never happened/);
   if(promptId==='custom')assert.ok(prompt.includes(request.persona));
  }
 }
 assert.doesNotMatch(bambiVoiceDirection,/possessive|punishment|gaslighting|ALWAYS explicit|Never hedge|20-50/);
});

test('Classic keeps its complete authored character while real recall and limits have explicit precedence',()=>{
 const request=ChatRequestSchema.parse({type:'chat',text:'What did I actually tell you?',collar:true,collarName:'Chosen collar wording',selectedTriggers:['BAMBI SLEEP']});
 const authored=buildRuntimePrompt(request.promptId,request.username,request.selectedTriggers,true,request.collarName).core;
 const document=buildCharacterDocument(request);
 assert.equal(document.core,authored);
 for(const mode of ['reactive','situational'] as const){
  const base=mode==='situational'?buildSituationalBase(request,authored):authored;
  const prompt=buildReplyPrompt(base,request.text,false,'Devices off',undefined,'',true,false,mode);
  assert.ok(prompt.includes(authored));assert.ok(prompt.indexOf(interactionDirection)>prompt.indexOf(authored));
  assert.match(prompt,/Fictional scene memories may belong to that story/);
  assert.match(prompt,/never present them as actual past listener statements, visits, promises, consent or confirmed preferences/);
  assert.match(prompt,/Use actual recorded conversation evidence for factual recall/);
  assert.match(prompt,/latest real listener request or correction.*take precedence/);
 }
});

test('chat preparation and event narration retain the same complete selected character and evidence contract',()=>{
 for(const promptId of ['bambisleep-classic','gentle-induction','custom'] as const){
  const input=ChatRequestSchema.parse({type:'chat',text:'Continue',promptId,persona:'Curious storyteller',username:'Explorer',selectedTriggers:['BAMBI SLEEP'],collar:true,collarName:'Chosen collar wording'});
  const authored=buildCharacterDocument(input).core,prefix=buildCharacterPrefix(authored);
  assert.ok(buildFixedReplyPrompt(authored).startsWith(prefix));
  const state=snapshotSession({elapsedSeconds:0,totalSeconds:300,scene:'Soft Pink',intensityPercent:20,activeTriggers:input.selectedTriggers,lastTrigger:null});
  assert.ok(buildReplyPrompt(authored,'Continue',false,'',state,'',false,true).startsWith(prefix));
  const messages=eventNarrationMessages(input,'FINAL OUTPUT CONTRACT: At most 8 words. No markers.','Authorized local context fixture');
  assert.ok(messages[0].content.startsWith(prefix));assert.equal(messages[1].content,'FINAL OUTPUT CONTRACT: At most 8 words. No markers.');
  assert.ok(messages[0].content.indexOf('EVENT OUTPUT CONTRACT')>messages[0].content.indexOf(authored));
  assert.match(messages[0].content,/take precedence over conflicting character examples, marker protocols and passage-length targets/);
  assert.match(messages[0].content,/You cannot schedule events, control devices, change settings or decide repetitions/);
  assert.match(messages[0].content,/Authorized local context fixture/);
 }
});

test('legacy event requests keep custom persona text and character options are validated',()=>{
 const event=createReferenceProgram(300000).events.find(e=>e.speech?.mode==='narrate')!;
 const raw={event,payloadId:compileEvent(event).speech[0].payloadId,allowedTriggers:[],persona:'Legacy warm narrator'};
 const legacy=EventSpeechRequestSchema.parse(raw);
 assert.equal(legacy.promptId,'custom');assert.ok(eventNarrationMessages(legacy,'Short passage')[0].content.includes(raw.persona));
 const selected=EventSpeechRequestSchema.parse({...raw,promptId:'gentle-induction',selectedTriggers:['BAMBI SLEEP'],collar:true,collarName:'Chosen collar wording',narrationStyle:'Connected sentences'});
 assert.ok(eventNarrationMessages(selected,'Short passage')[0].content.startsWith(buildRuntimePrompt('gentle-induction',selected.username,selected.selectedTriggers,true,selected.collarName).core));
 for(const change of [{promptId:'missing'},{collar:'true'},{selectedTriggers:[7]},{narrationStyle:'x'.repeat(301)}])assert.equal(EventSpeechRequestSchema.safeParse({...raw,...change}).success,false);
});

test('full event character context fails clearly when it cannot fit instead of dropping character sections',async()=>{
 const input=ChatRequestSchema.parse({type:'chat',text:'Continue',promptId:'gentle-induction'});
 const messages=eventNarrationMessages(input,'At most 8 words.');
 await assert.rejects(fitContext(messages[0].content,[],messages[1].content,async()=>2100,2048,64,256,64),ContextOverflowError);
 const plan=await fitContext(messages[0].content,[],messages[1].content,async()=>2100,4096,64,256,64);
 assert.equal(plan.messages[0].content,messages[0].content);assert.equal(plan.maxTokens,64);
});

test('native event checkpoints keep changing context outside the reusable complete character prefix',async()=>{
 const input=ChatRequestSchema.parse({type:'chat',text:'Continue',promptId:'gentle-induction'}),prefix=buildEventNarrationPrefix(input);
 for(const context of ['Authorized clock: 12:00','Authorized clock: 12:01']){
  const messages=eventNarrationMessages(input,'At most 8 words.',context),counted:unknown[]=[];
  const plan=await fitContext(messages[0].content,[],messages[1].content,async candidate=>{counted.push(candidate);return 2100;},4096,64,256,64,'',{checkpointPrefix:prefix});
  assert.ok(plan.messages[0].content.startsWith(prefix));assert.ok(!plan.messages[0].content.includes(context));
  assert.match(plan.messages.at(-2)!.content,/APPLICATION CONTEXT/);assert.ok(plan.messages.at(-2)!.content.includes(context));
  assert.equal(plan.messages.at(-1)!.content,'At most 8 words.');assert.ok(counted.length>0);
 }
});

test('event character and delivery preference cannot bypass text and cue validation',async()=>{
 const event=createReferenceProgram(300000).events.find(e=>e.type==='mantra')!,slot=compileEvent(event).speech[0];
 const input=EventSpeechRequestSchema.parse({event,payloadId:slot.payloadId,allowedTriggers:[],promptId:'custom',persona:'Fixture narrator',narrationStyle:'Use connected sentences'});
 let attempts=0,renders=0;
 await assert.rejects(renderEventSpeech(input,{
  knownTriggers:['Unplanned Cue'],
  generate:async instruction=>{attempts++;assert.match(instruction,/Narration delivery preference/);assert.match(instruction,/FINAL OUTPUT CONTRACT/);assert.doesNotMatch(instruction,/Persona: "Fixture narrator"/);return 'Unplanned Cue.';},
  render:async()=>{renders++;throw Error('Invalid speech must not reach the renderer');},
 },new AbortController().signal),/Unscheduled trigger/);
 assert.equal(attempts,2);assert.equal(renders,0);
});
