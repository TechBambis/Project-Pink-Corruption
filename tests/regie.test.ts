// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {directionPreset} from '../packages/session-director/direction';
import {directionPool,availableModules} from '../packages/session-director/regie/registry';
import {validateScenePlan,planJsonSchema,type ScenePlan,type SceneAction,type PlanningContext,type SceneLook} from '../packages/session-director/regie/plan';
import {compileScene,synthesisArcs} from '../packages/session-director/regie/compiler';
import {placePreparedScene} from '../packages/session-director/regie/placement';
import {PlayfulInteraction} from '../packages/session-director/regie/interaction';
import {RegieMemory,planScene} from '../packages/session-director/regie/planner';
import {EventRuntime} from '../packages/session-director/events/runtime';
import {ProgramSchema,type PresentationState} from '../packages/session-director/events/contract';
import {presentationAt} from '../packages/session-director/events/presentation';
import {InferenceQueue} from '../packages/ai/inference';
import {structuredOptions,type LLMBackend} from '../packages/ai';
import {SessionEvents} from '../apps/web/src/session-events';
import type {AudioEngine} from '../packages/audio';

const baseline:PresentationState={activeLayers:['drone'],foreground:null,density:{intensity:.6,effectDensity:0,speechDensity:0,audioDensity:.2,visualDensity:.1},visualState:'sparse',narrationState:'paused',ambientState:'reduced',scene:'Soft Pink'};
const look:SceneLook={scene:'Soft Pink',motif:'heart',motifId:'home',style:'orb',visualDensity:.35,motion:.2,ambient:.2,effects:.2};
const common={look,delivery:'guide' as const,pauseAfterMs:400};
const pool=directionPool(directionPreset('balanced'),{mainVoice:true,innerVoice:true,visuals:true,reducedMotion:false,sounds:{wiper:true,snap:true,rhythm:true},triggers:['Bambi Sleep','Blink']});
const context:PlanningContext={phase:'conditioning',windowMs:90000,intensity:.6,pool,userContext:'I keep thinking about unfinished work.',heardText:'',feedback:'',previousStrategy:'',openThreads:[],knownMotifs:[],plannedOutlook:''};
const wipe:SceneAction={...common,id:'erase',kind:'wipe',text:'Let the unfinished work leave this imagined window.',target:{label:'unfinished work',source:'user',quote:'unfinished work'},wipeMs:3000};
const reply:SceneAction={...common,id:'answer',kind:'reply',invitation:'You can say this with me.',text:'I can leave the work here.',previewMs:900,responseMs:1800};
const sleep:SceneAction={...common,id:'withdraw',kind:'sleep_return',preparation:'Let the familiar heart carry this quiet moment.',holdMs:1400,returnText:'Open your eyes and return to the familiar heart.'};
const challenge:Extract<SceneAction,{kind:'challenge'}>={...common,id:'ask-nicely',kind:'challenge',challengeId:'infinity-request',request:'May I have the infinity spiral?',invitation:'Ask nicely and say that you are my eager little dreamer.',phrase:'Please show me infinity. I am your eager little dreamer.',criterion:'A polite request and the requested imaginary role phrase.',reward:{kind:'scene',look:{...look,scene:'Spiral Focus',style:'infinity'}},responseMs:12000,maxAttempts:2};
const challengeContext={...context,feedback:challenge.request};
function plan(actions:SceneAction[]):ScenePlan{return {version:1,id:'session',strategy:'Prepare a home image, release the named work, and return with continuity.',rationale:'The listener specifically named unfinished work.',continuity:'The same heart retains the meaning of leaving work outside.',openThreads:['Return to the familiar home image.'],sections:[{id:'release',purpose:'A heart becomes a familiar home image.',actions}]};}
function wav(ms:number){const b=new Uint8Array(44+ms*48),v=new DataView(b.buffer);for(const [at,s]of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]as const)b.set(new TextEncoder().encode(s),at);v.setUint32(4,b.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,b.length-44,true);return b;}
function measured(p:ScenePlan,ms=1500){return synthesisArcs(p).map(a=>{const words=a.text.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g)!;const step=(ms-200)/words.length;return {id:a.id,bytes:wav(ms),words:words.map((word,i)=>({word,atMs:100+i*step,endMs:100+(i+.8)*step}))};});}
const options={atMs:96000,durationMs:240000,baseline};

test('registry constrains pool, phase, voice, sound and motion capabilities',()=>{
 assert.equal(availableModules({...pool,innerVoice:false,sounds:{wiper:false,snap:false,rhythm:false}},'conditioning').some(c=>['reply','repeat','wipe','sleep_return'].includes(c.id)),false);
 assert.ok(availableModules(pool,'awakening').every(c=>['guide','hold','recall'].includes(c.id)));
 assert.throws(()=>validateScenePlan(plan([reply]),{...context,pool:{...pool,innerVoice:false}}),/unavailable/);
 assert.throws(()=>validateScenePlan(plan([wipe]),{...context,pool:{...pool,reducedMotion:true}}),/Reduced motion/);
 assert.throws(()=>validateScenePlan(plan([wipe]),{...context,pool:{...pool,motifs:['ring']}}),/outside/);
 const chosen=directionPool({...directionPreset('balanced'),regie:{enabled:true,innerResponses:true,intent:'',withdrawal:false,scenes:['Soft Pink'],styles:['loop']}},{mainVoice:true,innerVoice:true,visuals:true,reducedMotion:false,sounds:pool.sounds,triggers:pool.triggers});
 assert.deepEqual(chosen.scenes,['Soft Pink']);assert.deepEqual(chosen.styles,['loop']);assert.ok(!chosen.modules.includes('sleep_return'));
 assert.throws(()=>validateScenePlan(plan([wipe]),{...context,pool:chosen}),/outside/);
});
test('wipe targets come from the specific cited context, not a generic fallback',()=>{
 assert.equal(validateScenePlan(plan([wipe]),context).sections[0].actions[0].kind,'wipe');
 assert.throws(()=>validateScenePlan(plan([{...wipe,target:{label:'DISTRACTIONS',quote:'DISTRACTIONS',source:'user'}}]),context),/grounded/);
 assert.throws(()=>validateScenePlan(plan([{...wipe,text:'Everything disappears.'}]),context),/grounded/);
 const guide:SceneAction={...common,id:'introduce',kind:'guide',text:'Imagine a tiny unopened envelope.'};
 const grounded={...wipe,target:{label:'unopened envelope',quote:'tiny unopened envelope',source:'planned' as const},text:'Let the unopened envelope leave this window.'};
 assert.doesNotThrow(()=>validateScenePlan(plan([guide,grounded]),context));
 assert.throws(()=>validateScenePlan(plan([grounded,guide]),context),/grounded/);
});
test('complete measured thoughts compile to contextual wipe, turning heart and exact pink inner response',()=>{
 const p=plan([wipe,reply]),c=compileScene(p,context,measured(p),options);
 assert.equal(c.events[0].wipe?.text,'unfinished work');assert.equal(c.events[0].state.motifMotion?.kind,'heart_turn');assert.equal(c.events[0].state.spiralStyle,'orb');
 assert.equal(c.events[0].state.motifMotion?.strength,1,'lower motion must not shrink the heart');
 const stillPlan=plan([{...common,id:'still',kind:'hold',look:{...look,motion:0},durationMs:2000}]);
 const still=compileScene(stillPlan,context,[],options).events[0];
 assert.equal(still.state.motifMotion?.kind,'heart_turn','a static moment retains the same volume-heart renderer');assert.equal(still.visual[0].motion,0);assert.equal(still.state.motifMotion?.strength,1);
 const voice=c.events.find(e=>e.speech.voiceTrack?.speaker==='bambi')!,payload=c.payloads.find(p=>p.payloadId===voice.id+':payload')!;
 assert.equal(payload.text,reply.text);assert.equal(c.responsePrompts[0].text,reply.text);
 assert.ok(c.responsePrompts[0].fromMs<=voice.atMs-700);assert.ok(c.responseWindows[0].toMs>=voice.atMs+payload.durationMs+reply.responseMs);
 assert.ok(c.events.every(e=>!e.speech.fixedText&&e.haptics.length===0));
 assert.throws(()=>compileScene(p,{...context,windowMs:1600},measured(p),options),/overflow/);
 assert.throws(()=>compileScene(p,context,measured(p,22000),options),/bounded speech/);
});
test('sleep picture withdrawal and selected cue share one measured word anchor; reopening is explicit',()=>{
 const p=plan([sleep]),c=compileScene(p,context,measured(p),options);
 const cue=c.events.find(e=>e.speech.requiredTrigger)!,runtime=new EventRuntime({durationMs:options.durationMs,baseline,version:1,events:c.events,motifs:c.motifs});
 const at=cue.atMs+cue.speech.triggerAtMs!;
 assert.equal(c.payloads.find(p=>p.text==='Bambi Sleep.')?.triggerOffsetMs!+250,cue.speech.triggerAtMs);
 assert.equal(runtime.snapshot(at-1).state.visualState,'motif');assert.equal(runtime.snapshot(at).state.visualState,'black');
 assert.equal(presentationAt(runtime.snapshot(at),runtime.compiled.find(e=>e.event.id===cue.id),at).black,1);
 assert.ok(c.payloads.at(-1)!.text.startsWith('Open your eyes'));
 assert.throws(()=>validateScenePlan(plan([{...sleep,returnText:'The heart returns.'}]),context),/reopening/);
 const bad=measured(p);bad.find(a=>a.id==='withdraw-cue')!.words=[];
 assert.throws(()=>compileScene(p,context,bad,options),/unambiguous/);
});
test('motif recall requires introduction and a peak requires real recovery',()=>{
 const recall:SceneAction={...common,id:'callback',kind:'recall',text:'The familiar heart brings that same quiet space.'};
 assert.throws(()=>validateScenePlan(plan([recall]),context),/established/);
 assert.doesNotThrow(()=>validateScenePlan(plan([wipe,recall]),context));
 const peak:SceneAction={...common,id:'climax',kind:'peak',text:'The familiar image grows bright for this moment.',rhythm:true};
 assert.throws(()=>validateScenePlan(plan([peak]),context),/recovery/);
 assert.doesNotThrow(()=>validateScenePlan(plan([peak,{...common,id:'recover',kind:'hold',look:{...look,visualDensity:.1,ambient:.1,motion:0},durationMs:3000}]),context));
});
test('the model may select other eligible phrases; their wipe association remains contextual',()=>{
 const cue:SceneAction={...common,id:'selected',kind:'trigger',phrase:'IQ LOCK',preparation:'Let the unfinished work leave this imagined window.',target:{label:'unfinished work',source:'user',quote:'unfinished work'},wipeMs:2400,holdMs:700};
 const c={...context,pool:{...pool,triggers:['IQ LOCK','GOOD GIRL']}};
 const p=plan([cue]),compiled=compileScene(p,c,measured(p),options),event=compiled.events.find(e=>e.speech.requiredTrigger)!;
 assert.equal(event.speech.requiredTrigger,'IQ LOCK');assert.equal(event.speech.triggerEffects,'snap_only');assert.equal(event.wipe?.text,'unfinished work');assert.equal(event.wipe?.offsetMs,event.speech.triggerAtMs);
 assert.throws(()=>validateScenePlan(plan([{...cue,target:null,wipeMs:0}]),c),/contextual wipe/);
 assert.throws(()=>validateScenePlan(plan([{...cue,phrase:'UNKNOWN'}]),c),/eligible/);
 assert.doesNotThrow(()=>validateScenePlan(plan([{...cue,phrase:'GOOD GIRL',target:null,wipeMs:0,preparation:'That quiet home remains familiar.'}]),c));
});
test('atomic scene append rejects a bad composition without changing the live engine',()=>{
 const p=plan([wipe,reply]),c=compileScene(p,context,measured(p),options),r=new EventRuntime({version:1,durationMs:240000,baseline,motifs:[],events:[]});
 const bad=structuredClone(c);bad.responsePrompts[0].text='';
 assert.throws(()=>r.appendScene(bad));assert.equal(r.compiled.length,0);assert.equal(r.program.motifs.length,0);
 r.appendScene(c);r.tick(c.events[0].atMs+100);const begun=r.compiled[0].event;
 r.discardFuture(begun.atMs+100);assert.equal(r.compiled.length,1);assert.equal(r.compiled[0].event.id,begun.id);assert.equal(r.program.responsePrompts?.length,0);
 assert.throws(()=>r.discardFuture(0),/heard/);
});
test('continuous response windows remain bounded by committed future playback',()=>{
 const p=plan([reply]),c=compileScene(p,context,measured(p),{...options,atMs:336000,continuous:true});
 assert.ok(c.responseWindows[0].fromMs>240000);
 assert.throws(()=>ProgramSchema.parse({version:1,durationMs:240000,continuous:true,baseline,motifs:[],events:[],responseWindows:c.responseWindows}),/inside/);
});
test('engine occurrence identities do not depend on a model inventing fresh plan names',()=>{
 const p=plan([{...common,id:'g',kind:'guide',text:'Let that quiet home image remain.'}]),m=measured(p);
 const first=compileScene(p,context,m,{...options,instanceId:'instance-one'});
 const second=compileScene(p,{...context,knownMotifs:[{id:'home',meaning:'A quiet home image.'}]},m,{...options,atMs:first.endMs,instanceId:'instance-two'});
 const r=new EventRuntime({version:1,durationMs:240000,baseline,motifs:[],events:[]});r.appendScene(first);r.appendScene(second);
 assert.equal(new Set(r.slots.map(s=>s.payloadId)).size,2);
});
test('late preparation moves only the whole uncommitted scene, preserving measured cues and response protection',()=>{
 const p=plan([wipe,reply,sleep]),c=compileScene(p,context,measured(p),options),before=structuredClone(c);
 const shifted=placePreparedScene(c,c.atMs+4200,c.endMs+5000);
 assert.deepEqual(c,before,'the original scene and any caller references remain untouched');
 assert.deepEqual(shifted.payloads,c.payloads,'PCM and word-relative anchors never change');
 const program=(scene:typeof c)=>({version:1 as const,durationMs:240000,baseline,motifs:scene.motifs,events:scene.events,responseWindows:scene.responseWindows,responsePrompts:scene.responsePrompts});
 const original=new EventRuntime(program(c)),late=new EventRuntime(program(shifted));
 const first=original.slots.find(s=>s.speech.requiredTrigger)!,second=late.slots.find(s=>s.speech.requiredTrigger)!;
 const cueAt=first.atMs+first.speech.triggerAtMs!;
 assert.equal(second.atMs+second.speech.triggerAtMs!,cueAt+4200);
 assert.deepEqual(late.snapshot(cueAt+4200).state.visualState,original.snapshot(cueAt).state.visualState);
 assert.equal(late.snapshot(cueAt+4200).state.motifMotion!.startMs-original.snapshot(cueAt).state.motifMotion!.startMs,4200);
 assert.equal(shifted.responseWindows[0].fromMs-c.responseWindows[0].fromMs,4200);
 assert.equal(shifted.responseWindows[0].toMs-c.responseWindows[0].toMs,4200);
 assert.throws(()=>placePreparedScene(c,c.atMs+6000,c.endMs+5000),/remaining parent phase/);
 assert.throws(()=>placePreparedScene(c,c.atMs-1,c.endMs+5000));
});
test('feedback invalidates a captured plan and changes model context; unheard proposals never become history',async()=>{
 const memory=new RegieMemory(),generation=memory.generation,p=plan([wipe]),c=compileScene(p,context,measured(p),options);
 assert.ok(memory.accept(p,c.sections,generation));assert.equal(memory.context().previousStrategy,'');assert.equal(memory.context().knownMotifs.length,0);
 assert.ok(memory.context().plannedOutlook.includes(p.strategy));assert.equal(memory.context().heardText,'');
 const interrupted=new RegieMemory();interrupted.accept(p,c.sections,interrupted.generation);interrupted.feedback('May I have another scene?');
 assert.ok(interrupted.context().interruptedOutlook.includes(p.strategy));assert.equal(interrupted.context().heardText,'','the displaced original plan remains a preview, never a listener fact');
 memory.observe(c.endMs,'Let the unfinished work leave this imagined window.');assert.equal(memory.context().previousStrategy,p.strategy);assert.equal(memory.context().knownMotifs[0].id,'home');
 memory.feedback('No wiping. I would prefer a spacious image.');assert.equal(memory.accept(p,c.sections,generation),false);
 const changed:ScenePlan={...plan([{...common,id:'spacious',kind:'guide',text:'Imagine room around the familiar heart.'}]),id:'revised',strategy:'Switch from release imagery to spacious continuity.',rationale:'The listener explicitly asked to stop wiping.'};
 let usedOptions:unknown;
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,_schema,opts){usedOptions=opts;assert.ok(messages[0].content.includes('No wiping'));return changed;},async *stream(){throw Error('Unexpected stream');}};
 const nextContext={...context,...memory.context()};
 const next=await planScene(nextContext,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:2048,messages:[{role:'user',content:JSON.stringify(nextContext)}]},new AbortController().signal);
 assert.notEqual(next.strategy,p.strategy);assert.deepEqual(next.sections[0].actions.map(a=>a.kind),['guide']);assert.deepEqual(usedOptions,{maxTokens:2048,temperature:.65});
 memory.reset();assert.equal(memory.context().heardText,'');
});
test('structured planner budget preserves the small listening default and emits strict JSON schema',()=>{
 assert.deepEqual(structuredOptions(),{maxTokens:32,temperature:0});assert.throws(()=>structuredOptions({maxTokens:99999}));
 const schema=planJsonSchema();assert.equal(schema.additionalProperties,false);assert.ok(JSON.stringify(schema).includes('sleep_return'));
});
test('playful challenge previews a real answer and never synthesizes or suppresses it',()=>{
 const p=plan([challenge]),c=compileScene(p,challengeContext,measured(p),options);
 assert.equal(c.payloads.length,1);assert.equal(c.payloads[0].text,challenge.invitation);
 assert.deepEqual(c.responseWindows,[]);assert.equal(c.responsePrompts[0].text,challenge.phrase);
 const window=c.challenges[0],interaction=new PlayfulInteraction();interaction.schedule(window);
 assert.equal(interaction.receive(challenge.phrase,window.fromMs),false,'a skipped invitation cannot create an accepted response');
 interaction.invitationScheduled(window.invitationEventId);
 assert.equal(interaction.begin(window.fromMs-1),false);assert.equal(interaction.begin(window.toMs-1),true);
 assert.equal(interaction.expire(window.toMs+10000),false,'an utterance started in the window keeps its recognition grace');
 assert.equal(interaction.receive('Please, I am your eager little dreamer.',window.toMs+10000),true);
 assert.equal(interaction.receive('A duplicated final transcript.',window.toMs+11000),false);
 const runtime=new EventRuntime({version:1,durationMs:240000,baseline,motifs:c.motifs,events:c.events,responsePrompts:c.responsePrompts});runtime.tick(window.fromMs+500);
 runtime.finishListeningWindow(window.responseEventId,window.fromMs+800);assert.equal(runtime.compiled.at(-1)!.event.timing.activeMs,800);assert.equal(runtime.program.responsePrompts![0].toMs,window.fromMs+800);
});
test('uninterrupted participation rejects answer-dependent scenes even with a forged permissive pool',()=>{
 const solo={...challengeContext,participation:'uninterrupted' as const};
 assert.throws(()=>validateScenePlan(plan([challenge]),solo),/not allowed|disabled|outside|capability/i);
 const imagined={...solo,pool:context.pool};
 assert.doesNotThrow(()=>validateScenePlan(plan([reply]),imagined),'imagined inner responses remain usable without real input');
 const compiled=compileScene(plan([challenge]),challengeContext,measured(plan([challenge])),options);
 assert.throws(()=>validateScenePlan(plan([reply]),{...imagined,interaction:compiled.challenges[0].context}),/no real listener/);
});
test('the model can grant, motivate a bounded retry or continue only after actual feedback',()=>{
 const p=plan([challenge]),c=compileScene(p,challengeContext,measured(p),options),pending=c.challenges[0].context;
 const granted={...plan([{...common,id:'earned',kind:'guide',look:challenge.reward.look,text:'That was a sweet request. Here is infinity.'}]),resolution:{challengeId:challenge.challengeId,outcome:'grant' as const,reason:'The listener asked politely and used the offered role phrase.'}};
 assert.throws(()=>validateScenePlan(granted,{...challengeContext,interaction:pending}),/Await the real/);
 const responded={...pending,response:'Please. I am your eager little dreamer.'};
 assert.doesNotThrow(()=>validateScenePlan(granted,{...challengeContext,interaction:responded}));
 assert.throws(()=>validateScenePlan({...granted,sections:plan([{...common,id:'unearned',kind:'guide',text:'You earned it.'}]).sections},{...challengeContext,interaction:responded}),/actually perform/);
 const retry={...plan([{...challenge,id:'try-sweeter',invitation:'You can ask more sweetly. Try once more.'}]),resolution:{challengeId:challenge.challengeId,outcome:'retry' as const,reason:'The request did not include the stated phrase.'}};
 assert.doesNotThrow(()=>validateScenePlan(retry,{...challengeContext,interaction:{...pending,response:'Infinity.'}}));
 assert.throws(()=>validateScenePlan(retry,{...challengeContext,interaction:{...responded,attempt:2}}),/bounded/);
 assert.throws(()=>validateScenePlan(granted,{...challengeContext,interaction:{...pending,timedOut:true}}),/Silence/);
 const continued={...plan([{...common,id:'return-home',kind:'guide',text:'We can leave that game and return to the familiar heart.'}]),resolution:{challengeId:challenge.challengeId,outcome:'continue' as const,reason:'The listener chose to continue the original journey.'}};
 assert.doesNotThrow(()=>validateScenePlan(continued,{...challengeContext,interaction:{...pending,timedOut:true}}));
 assert.throws(()=>validateScenePlan(p,{...challengeContext,pool:{...pool,playfulRequests:false}}),/unavailable/);
 assert.throws(()=>validateScenePlan(plan([challenge,reply]),challengeContext),/final action/);
 const memory=new RegieMemory();memory.feedback(challenge.request);memory.settleRequest(challenge.request,continued.resolution);
 assert.equal(memory.context().feedback,'');assert.equal(memory.context().resolvedRequests[0].outcome,'continue');
 assert.throws(()=>validateScenePlan(p,{...challengeContext,...memory.context(),userContext:challenge.request}),/settled request/);
 memory.feedback(challenge.request);assert.doesNotThrow(()=>validateScenePlan(p,{...challengeContext,...memory.context(),userContext:challenge.request}));
 const interaction=new PlayfulInteraction();interaction.schedule(c.challenges[0]);assert.equal(interaction.expire(c.challenges[0].toMs),true);assert.equal(interaction.context?.timedOut,true);interaction.clear();assert.equal(interaction.context,null);
});
test('earned breathing uses existing measured in/out cues and remains inside the allowed pool',()=>{
 const breath:SceneAction={...common,id:'paced',kind:'breath',preparation:'You asked sweetly. Here is a little room to breathe.',inText:'In.',outText:'And out.',inMs:4000,outMs:4500,cycles:2};
 const p=plan([breath]),c=compileScene(p,{...context,pool:{...pool,breathing:true}},measured(p),options);
 assert.deepEqual(c.events.filter(e=>e.breath).map(e=>e.breath!.direction),['in','out','in','out']);
 assert.equal(c.payloads.filter(e=>e.text==='In.').length,2);
 assert.ok(c.events.filter(e=>e.breath).every(e=>e.breath!.offsetMs+e.breath!.durationMs<=e.timing.activeMs));
 assert.throws(()=>validateScenePlan(p,context),/unavailable/);
 assert.throws(()=>validateScenePlan(plan([{...breath,inText:'Hold your breath.'}]),{...context,pool:{...pool,breathing:true}}),/short direct/);
});
test('breath playback owns the full paced event after its short spoken instruction',()=>{
 const breath:SceneAction={...common,id:'paced-live',kind:'breath',preparation:'Breathe with me.',inText:'In.',outText:'And out.',inMs:4000,outMs:4000,cycles:1};
 const p=plan([breath]),c=compileScene(p,{...context,pool:{...pool,breathing:true}},measured(p),options);
 const runtime=new EventRuntime({version:1,durationMs:240000,baseline,motifs:c.motifs,events:c.events});
 const event=c.events.find(e=>e.breath)!,slot=runtime.slots.find(s=>s.eventId===event.id)!,payload=c.payloads.find(p=>p.payloadId===slot.payloadId)!;
 const element=()=>({hidden:true,style:{setProperty(){}},dataset:{},append(){},setAttribute(){}}),previousDocument=globalThis.document;
 let observedDeadline=0,stopped=0;
 const engine={context:{currentTime:10},outputTime:10,setNarrationDelivery(){},stopEventBreaths(){stopped++;},playEventVoice(){return {onended:null,stop(){}};},playEventBreath(_cue:unknown,_time:number,deadline:number){observedDeadline=deadline;return true;}} as unknown as AudioEngine;
 const hooks={audio:()=>engine,visuals:()=>null,settings:()=>({allowedTriggers:[]}),clearSpeech(){},narration(){},displayNarration(){},haptics:()=>false,allowSpeech:()=>true,allowTriggers:()=>false,allowTriggerSound:()=>false,regieBreathing:()=>true} as unknown as ConstructorParameters<typeof SessionEvents>[2];
 try{
  globalThis.document={createElement:element,getElementById:element} as unknown as Document;
  const adapter=new SessionEvents(element() as unknown as HTMLElement,element() as unknown as HTMLCanvasElement,hooks);
  const internals=adapter as unknown as {runtime:EventRuntime;lastSnapshot:ReturnType<EventRuntime['snapshot']>;payloads:Map<string,{response:typeof payload;buffer:AudioBuffer}>;speak:(s:typeof slot,atMs:number)=>void;cancelSpeech:()=>void};
  internals.runtime=runtime;internals.lastSnapshot=runtime.snapshot(slot.atMs);internals.payloads.set(slot.payloadId,{response:payload,buffer:{duration:1.5} as AudioBuffer});
  internals.speak(slot,slot.atMs);
  assert.ok(observedDeadline>10+(slot.endMs-slot.atMs)/1000,'the short voice slot must not truncate the paced breath');
  assert.equal(observedDeadline,10+event.timing.activeMs/1000);
  internals.cancelSpeech();assert.ok(stopped>=2,'new speech and interruption release old breath audio');
 }finally{globalThis.document=previousDocument;}
});
test('a missed or revoked snap cannot leave the regie player black; a scheduled cue can',()=>{
 const p=plan([{...sleep,look:{...look,motif:null,motifId:null,style:null}}]),c=compileScene(p,context,measured(p),options);
 const runtime=new EventRuntime({version:1,durationMs:240000,baseline,motifs:c.motifs,events:c.events});
 const slot=runtime.slots.find(s=>s.speech.requiredTrigger)!,payload=c.payloads.find(p=>p.payloadId===slot.payloadId)!;
 const element=()=>({hidden:true,style:{setProperty(){}},dataset:{},append(){},setAttribute(){}});
 const previousDocument=globalThis.document;
 let snap=true;
 const engine={context:{currentTime:10},outputTime:10,setNarrationDelivery(){},playEventVoice(){return {onended:null,stop(){}};},playEventTrigger(){return snap;}} as unknown as AudioEngine;
 const hooks:ConstructorParameters<typeof SessionEvents>[2]={audio:()=>engine,visuals:()=>null,settings:()=>({model:'fixture',voice:'af_heart',speed:.78,preset:'bambi_local_clean',sampling:'creative',context:8192,promptId:'custom',persona:'',username:'Listener',selectedTriggers:['Bambi Sleep'],collar:false,collarName:'',allowedTriggers:['Bambi Sleep']}),notice(){},narration(){},displayNarration(){},clearSpeech(){},clearDevices(){},cue(){},pink(){},allowVisuals:()=>true,paused:()=>false,triggers:()=>({}),haptics:()=>false,restore(){},allowSpeech:()=>true,allowTriggers:()=>true,allowTriggerSound:()=>true,regieSounds:()=>({snap,wiper:true,rhythm:false})};
 try{
  globalThis.document={createElement:element,getElementById:element} as unknown as Document;
  const adapter=new SessionEvents(element() as unknown as HTMLElement,element() as unknown as HTMLCanvasElement,hooks);
  const internals=adapter as unknown as {runtime:EventRuntime;started:boolean;lastSnapshot:ReturnType<EventRuntime['snapshot']>;regieDirection:ReturnType<typeof directionPreset>;payloads:Map<string,{response:typeof payload;buffer:AudioBuffer}>;speak:(s:typeof slot,atMs:number)=>void;layer:HTMLElement};
  internals.runtime=runtime;internals.started=true;internals.lastSnapshot=runtime.snapshot(slot.atMs);internals.regieDirection={...directionPreset('balanced'),regie:{enabled:true,innerResponses:true,intent:''}};
  internals.payloads.set(payload.payloadId,{response:payload,buffer:{duration:1.5} as AudioBuffer});
  const cueAt=slot.atMs+slot.speech.triggerAtMs!;
  internals.speak(slot,slot.atMs+600);adapter.present(cueAt,true);assert.equal(internals.layer.hidden,true,'late cue leaves the prepared picture visible');
  internals.speak(slot,slot.atMs);adapter.present(cueAt,true);assert.equal(internals.layer.hidden,false,'actual scheduled snap authorizes the word-aligned blackout');
  snap=false;adapter.present(cueAt,true);assert.equal(internals.layer.hidden,true,'revocation removes the blackout');
  runtime.program.responseWindows=[{fromMs:slot.atMs,toMs:slot.atMs+2000}];
  (engine as unknown as {outputTime:number}).outputTime=9.9;
  assert.equal(adapter.listenerResponseAt(slot.atMs),false,'the preview has not reached output yet');
  assert.equal(adapter.listenerResponseAt(slot.atMs+2050),true,'input remains protected while the output-clock prompt is still visible');
  assert.equal(adapter.listenerResponseAt(slot.atMs+2101),false);
 }finally{globalThis.document=previousDocument;}
});
