// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectionSchema,directionPreset} from '../packages/session-director/direction';
import {journeyBrief,journeyPreset,sessionJourneys} from '../packages/session-director/journeys';
import {directionPool,availableModules} from '../packages/session-director/regie/registry';
import {scenePlanningInstruction} from '../packages/session-director/regie/planner';
import {buildReplyPrompt} from '../packages/ai/prompt';
import {preflightReplyContext} from '../packages/ai/preflight';
import {ChatRequestSchema} from '../packages/ai/request';

const access={mainVoice:true,innerVoice:true,visuals:true,reducedMotion:false,sounds:{wiper:true,snap:true,rhythm:true},triggers:['BAMBI SLEEP']};
test('creative presets carry a distinct arc while preserving the user idea and enabled input policy',()=>{
 const previous={...directionPreset('balanced'),regie:{enabled:false,innerResponses:true,intent:'My unfinished work.',interactive:false,playfulRequests:false}};
 for(const journey of sessionJourneys){
  const result=DirectionSchema.parse(journeyPreset(journey.id,previous));
  assert.equal(result.regie!.intent,previous.regie.intent);assert.equal(result.regie!.interactive,false);assert.equal(result.regie!.playfulRequests,false);
  assert.equal(result.regie!.enabled,true);assert.notEqual(journeyBrief(journey.id,'induction')!.focus,journeyBrief(journey.id,'awakening')!.focus);
  const pool=directionPool(result,access);assert.equal(pool.playfulRequests,false);
  assert.equal(availableModules(pool,'conditioning').some(m=>m.id==='challenge'),false);
  const disabled=directionPool(result,{...access,visuals:false,innerVoice:false,sounds:{wiper:false,snap:false,rhythm:false}});
  const modules=availableModules(disabled,'conditioning').map(m=>m.id);assert.ok(!modules.includes('wipe')&&!modules.includes('sleep_return')&&!modules.includes('reply'));
 }
 assert.equal(new Set(sessionJourneys.map(j=>j.signature)).size,6);
});
test('the actual planner sees the canonical phase brief and uninterrupted participation',()=>{
 const direction=journeyPreset('clean-slate',directionPreset('balanced'));
 const context={phase:'conditioning' as const,windowMs:90000,intensity:.6,pool:directionPool(direction,access),userContext:'My unfinished work.',heardText:'',feedback:'',previousStrategy:'',openThreads:[],knownMotifs:[],participation:'uninterrupted' as const,journey:'clean-slate' as const};
 const instruction=scenePlanningInstruction(context);
 assert.ok(instruction.includes(journeyBrief('clean-slate','conditioning')!.focus));
 assert.match(instruction,/typing and microphone input are unavailable/);
 const capabilities=JSON.parse(instruction.split('Available capabilities: ')[1].split('\n')[0]);assert.equal(capabilities.some((m:{id:string})=>m.id==='challenge'),false);
});
test('conversation topics preserve the full character and stay out of session narration',async()=>{
 const base='COMPLETE MAIN\nCOMPLETE COLLAR\nCOMPLETE STRATEGY';
 for(const interaction of ['reactive','situational'] as const){
  const chat=buildReplyPrompt(base,'What should I wear?',false,'',undefined,'',true,false,interaction,'',false,'style');
  assert.ok(chat.startsWith(base));assert.match(chat,/outfit and style ideas/);assert.match(chat,/current weather/);
  const session=buildReplyPrompt(base,'Continue the scene.',false,'',undefined,'',false,true,interaction,'',false,'style');
  assert.ok(!session.includes('CURRENT CONVERSATION PURPOSE'));
 }
 const prompts:string[]=[];
 await preflightReplyContext(base,{context:8192,maxTokens:512,safetyTokens:256,soundDesign:false,selectedTriggers:[],narration:false,tokenCount:'estimate',conversationTopic:'bambi'},async messages=>{prompts.push(messages[0].content);return 1000;});
 assert.match(prompts[0],/read-only references/);
 assert.equal(ChatRequestSchema.parse({type:'chat',text:'Hello.'}).conversationTopic,'general');
 assert.equal(ChatRequestSchema.safeParse({type:'chat',text:'Hello.',conversationTopic:'execute'}).success,false);
});
