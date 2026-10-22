// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {directionPreset} from '../packages/session-director/direction';
import {directionPool,availableModules} from '../packages/session-director/regie/registry';
import {validateScenePlan,normalizeSceneBreathing,planJsonSchema,sceneWordCount,type ScenePlan,type SceneAction,type PlanningContext,type SceneLook} from '../packages/session-director/regie/plan';
import {compileScene,synthesisArcs} from '../packages/session-director/regie/compiler';
import {placePreparedScene} from '../packages/session-director/regie/placement';
import {PlayfulInteraction} from '../packages/session-director/regie/interaction';
import {RegieMemory,planScene,repairRevealAnchor,scenePlanOutputSchema,scenePlanningInstruction,validateEnglishSceneSpeech} from '../packages/session-director/regie/planner';
import {StructuredOutputError} from '../packages/ai/structured';
import {EventRuntime} from '../packages/session-director/events/runtime';
import {ProgramSchema,type PresentationState} from '../packages/session-director/events/contract';
import {presentationAt} from '../packages/session-director/events/presentation';
import {InferenceQueue} from '../packages/ai/inference';
import {structuredOptions,type LLMBackend} from '../packages/ai';
import {SessionEvents} from '../apps/web/src/session-events';
import type {AudioEngine} from '../packages/audio';
import {sceneDraftSchema,expandSceneDraft} from '../packages/session-director/regie/draft';
import {RevealAlignmentError} from '../packages/session-director/regie/compiler';
import {withHapticMappings} from '../packages/session-director/events/program';

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
test('late placement preserves adjacent fractional PCM boundaries without false foreground overlap',()=>{
 const p=plan([{...common,id:'one',kind:'guide',text:'Notice this familiar light.'},{...common,id:'two',kind:'guide',text:'Let that warmth remain here.'}]);
 const scene=compileScene(p,context,measured(p,6258+1/3),{...options,atMs:110007.13550876673});
 const placed=placePreparedScene(scene,127403.9916372415,160000);
 // Re-associating (start + duration) + delta changes the last floating bit.
 const overlap=placed.events[0].atMs+placed.events[0].timing.activeMs-placed.events[1].atMs;
 assert.ok(overlap>0&&overlap<.001,'Reproduces translation rounding with actual fractional PCM lengths');
 const windows=placed.events.map(event=>({fromMs:event.atMs,toMs:event.atMs+event.timing.activeMs}));
 const program={version:1 as const,durationMs:options.durationMs,baseline,motifs:placed.motifs,events:placed.events,responseWindows:windows,responsePrompts:windows.map(window=>({...window,text:'I feel steady.'}))};
 assert.doesNotThrow(()=>ProgramSchema.parse(program));
 const runtime=new EventRuntime({...program,events:[],motifs:[],responseWindows:[],responsePrompts:[]});
 assert.doesNotThrow(()=>runtime.appendScene(program));
 const invalid=structuredClone(program);invalid.events[1].atMs-=1;
 assert.throws(()=>ProgramSchema.parse(invalid),/Foreground events cannot overlap/);
 const invalidWindows=structuredClone(program);invalidWindows.responseWindows[1].fromMs-=1;
 assert.throws(()=>ProgramSchema.parse(invalidWindows),/Listener response windows/);
 const invalidPrompts=structuredClone(program);invalidPrompts.responsePrompts[1].fromMs-=1;
 assert.throws(()=>ProgramSchema.parse(invalidPrompts),/Response prompts/);
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
 memory.observe(c.endMs,'Let the unfinished work leave this imagined window.',c.sections.flatMap(s=>s.speechIds));assert.equal(memory.context().previousStrategy,p.strategy);assert.equal(memory.context().knownMotifs[0].id,'home');
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
test('scene decoding constrains single-line text and complete speech without censoring words',()=>{
 const schema=planJsonSchema() as any;
 const variants=schema.properties.sections.items.properties.actions.items.anyOf;
 const guide=variants.find((variant:any)=>variant.properties.kind.const==='guide').properties.text;
 const contrast=variants.find((variant:any)=>variant.properties.kind.const==='contrast').properties;
 const repeat=variants.find((variant:any)=>variant.properties.kind.const==='repeat').properties.text;
 for(const field of [guide,contrast.textA,contrast.textB,repeat]){
  assert.equal(typeof field.pattern,'string');
  const regex=new RegExp(field.pattern);
  assert.ok(regex.test('Fuck, this shit is loud.'));
  assert.ok(regex.test('A complete thought!'));
  assert.ok(regex.test('x'.repeat(field.maxLength-1)+'.'));
  assert.equal(regex.test('x'.repeat(field.maxLength)+'.'),false,'Decoder pattern bounds the field itself');
  for(const text of ['A "quoted" sentence.','A backslash \\ sentence.','A \t tab.','A `code` sentence.'])assert.equal(regex.test(text),false,text);
  for(const text of ['Two lines.\nAnother sentence.','Two lines.\rAnother sentence.','[pause:1000] A thought.','<action> A thought.','An unfinished thought'])assert.equal(regex.test(text),false,text);
 }
 const strategy=new RegExp(schema.properties.strategy.pattern);
 assert.ok(strategy.test('A connected idea without final punctuation'));
 assert.equal(strategy.test('An idea\nwith a second line'),false);
 assert.ok(strategy.test('x'.repeat(600)));assert.equal(strategy.test('x'.repeat(601)),false);
 assert.doesNotThrow(()=>validateScenePlan(plan([{...common,id:'raw-guide',kind:'guide',text:'Fuck, this shit is loud.'}]),context));
 for(const text of ['[pause:1000] A thought.','A thought.\nAnother thought.','An unfinished thought','```fenced text```.'])assert.throws(()=>validateScenePlan(plan([{...common,id:'invalid-guide',kind:'guide',text}]),context));
 for(const text of ['Her eyes narrow dangerously.','She steps closer, towering over you.'])assert.throws(()=>validateScenePlan(plan([{...common,id:'narrated-guide',kind:'guide',text}]),context),/only the words spoken/);
});
test('scene output schema fits bounded sections and retains every capability on a compact retry',()=>{
 const regular=scenePlanOutputSchema(3072),compact=scenePlanOutputSchema(3072,true);
 const sections=regular.properties!.sections,retrySections=compact.properties!.sections;
 assert.equal(sections.maxItems,2);assert.equal(sections.items!.properties!.actions.maxItems,3);
 assert.equal(scenePlanOutputSchema(1024).properties!.sections.maxItems,1);
 assert.equal(retrySections.maxItems,1);assert.equal(retrySections.items!.properties!.actions.maxItems,2);
 const regularGuide=sections.items!.properties!.actions.items!.anyOf!.find(variant=>variant.properties!.kind.const==='guide')!;
 assert.equal(regularGuide.properties!.text.maxLength,120);
 const textPattern=new RegExp(regularGuide.properties!.text.pattern!);
 assert.equal(textPattern.test('x'.repeat(120)+'.'),false);
 const variants=retrySections.items!.properties!.actions.items!.anyOf!;
 assert.equal(variants.length,sections.items!.properties!.actions.items!.anyOf!.length);
 for(const variant of variants)for(const key of ['text','textA','textB','invitation','preparation','returnText']){
  const field=variant.properties![key];if(!field)continue;
  assert.ok(field.maxLength!<=120);
  const regex=new RegExp(field.pattern!);
  assert.ok(regex.test('Damn, a complete sentence.'));
  if(field.pattern!.endsWith('[.!?]$'))assert.ok(regex.test('x'.repeat(100)+'.'),'Compact decoding leaves room to finish a thought beyond the 80-character target');
  assert.equal(regex.test('x'.repeat(120)+'.'),false);
 }
});
test('English speech decoding rejects corrupt scripts while retaining accents and unfiltered vocabulary',()=>{
 const schema=scenePlanOutputSchema(1536,true,context,true);
 const field=schema.properties!.sections.items!.properties!.actions.items!.anyOf!.find(variant=>variant.properties!.kind.const==='guide')!.properties!.text;
 const regex=new RegExp(field.pattern!);
 for(const text of ['Fuck, this shit is loud.','Bambi, let’s stay here — comfortably.','A café feels warm.'])assert.ok(regex.test(text),text);
 assert.equal(regex.test("You are safe,紛."),false);
 const guide=(text:string)=>plan([{...common,id:'guide',kind:'guide',text}]);
 for(const text of ["You are safe,紛.","It is warm and steady, a I!","The glow stays warm, I!"])assert.throws(()=>validateEnglishSceneSpeech(guide(text)),/English speech/);
 assert.doesNotThrow(()=>validateEnglishSceneSpeech(guide('Fuck, Bambi, stay with me.')));
 assert.doesNotThrow(()=>validateScenePlan(guide('静かな光です。 Stay here.'),context),'The shared plan format remains multilingual');
});
test('an English speech corruption triggers only the existing single compact retry',async()=>{
 let calls=0;const messages=[{role:'system' as const,content:'Complete selected character.'},{role:'user' as const,content:'Full request.'}];
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(){calls++;return plan([{...common,id:'guide',kind:'guide',text:calls===1?'It is warm and steady, a I!':'The glow feels warm and steady.'}]);},async *stream(){throw Error('Unexpected stream');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:1536,messages,speechLanguages:['en']},new AbortController().signal);
 assert.equal(calls,2);assert.equal((result.sections[0].actions[0] as {text:string}).text,'The glow feels warm and steady.');
});
test('scene decoding admits only the chosen modules, visuals and reduced-motion limits',()=>{
 const c={...context,participation:'uninterrupted' as const,pool:{...pool,modules:['guide' as const],visuals:false,reducedMotion:true}};
 const schema=scenePlanOutputSchema(3072,false,c);
 const variants=schema.properties!.sections.items!.properties!.actions.items!.anyOf!;
 assert.equal(variants.length,1);assert.equal(variants[0].properties!.kind.const,'guide');
 const look=variants[0].properties!.look.properties!;
 assert.deepEqual(look.scene.enum,c.pool.scenes);assert.equal(look.motif.const,null);assert.equal(look.motifId.const,null);assert.equal(look.style.const,null);
 assert.equal(look.visualDensity.maximum,0);assert.equal(look.motion.maximum,0);
 const compact=scenePlanOutputSchema(3072,true,c);
 assert.equal(compact.properties!.sections.items!.properties!.actions.items!.anyOf!.length,1);
 assert.throws(()=>scenePlanOutputSchema(3072,false,{...c,pool:{...c.pool,mainVoice:false}}),/No scene actions/);
});
test('incomplete scene JSON retries once with a fresh compact plan and preserves mandatory messages',async()=>{
 const valid=plan([{...common,id:'guide',kind:'guide',text:'Notice this familiar heart.'}]);
 const messages=[{role:'system' as const,content:'Complete selected character.'},{role:'user' as const,content:'Full engine planning request.'}],original=structuredClone(messages);
 const seen:{messages:unknown;schema:any;options:unknown}[]=[];
 const backend:LLMBackend={name:'fixture',async models(){return [];},async countTokens(){return 300;},async structured(messages,_model,_signal,_context,schema,options){seen.push({messages,schema,options});if(seen.length===1)throw new StructuredOutputError('truncated');return valid;},async *stream(){throw Error('Unexpected streaming');}};
 assert.deepEqual(await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:2048,messages},new AbortController().signal),{...valid,resolution:null});
 assert.equal(seen.length,2);assert.deepEqual(messages,original);
 assert.equal((seen[1].messages as typeof messages)[0].content,messages[0].content);
 assert.ok((seen[1].messages as typeof messages)[1].content.startsWith(messages[1].content));
 assert.match((seen[1].messages as typeof messages)[1].content,/APPLICATION OUTPUT RETRY/);
 assert.deepEqual(seen[1].options,{maxTokens:2048,temperature:.25});
 assert.equal(seen[1].schema.properties.sections.maxItems,1);
});
test('scene retries are bounded, cancellation stops retry and repeated capability violations stay rejected',async()=>{
 const messages=[{role:'system' as const,content:'Complete selected character.'},{role:'user' as const,content:'Full request.'}];
 const run=(backend:LLMBackend,signal=new AbortController().signal)=>planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:2048,messages},signal);
 let calls=0;
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(){calls++;throw new StructuredOutputError('invalid');},async *stream(){throw Error('Unexpected stream');}};
 await assert.rejects(run(backend),/after a compact retry/);assert.equal(calls,2);
 calls=0;backend.structured=async()=>{calls++;throw Error('HTTP 503');};
 await assert.rejects(run(backend),/HTTP 503/);assert.equal(calls,1);
 calls=0;backend.structured=async()=>{calls++;return plan([{...wipe,target:{label:'DISTRACTIONS',quote:'DISTRACTIONS',source:'user'}}]);};
 await assert.rejects(run(backend),/grounded/);assert.equal(calls,2);
 calls=0;const controller=new AbortController();backend.structured=async()=>{calls++;controller.abort(Error('Cancelled'));throw new StructuredOutputError('invalid');};
 await assert.rejects(run(backend,controller.signal),/Cancelled/);assert.equal(calls,1);
 calls=0;backend.structured=async()=>{calls++;throw new StructuredOutputError('truncated');};backend.countTokens=async()=>7900;
 await assert.rejects(run(backend),/too little context/);assert.equal(calls,1);
});
test('a repeated guide repairs only its spoken field, preserves the scene and still rejects another copy',async()=>{
 const heard='Keep the familiar warm light in view while the next quiet thought takes shape.';
 const replacement='Let that familiar light become a little warmer now.';
 const repeated=plan([{...common,id:'copied',kind:'guide',text:heard},sleep]);
 const calls:{schema:any;messages:any;options:any}[]=[];
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,schema,options){calls.push({schema,messages,options});return calls.length===1?structuredClone(repeated):{text:replacement};},async *stream(){throw Error('Unexpected stream');}};
 const dependencies={backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:2048,messages:[{role:'system' as const,content:'Complete selected character.'},{role:'user' as const,content:'Continue the current scene.'}]};
 const output=await planScene({...context,heardText:heard},dependencies,new AbortController().signal);
 assert.equal(calls.length,2);assert.equal(calls[1].schema.additionalProperties,false);
 assert.deepEqual(Object.keys(calls[1].schema.properties),['text']);assert.equal(calls[1].options.maxTokens,256);
 assert.match(calls[1].messages.at(-1).content,/APPLICATION SPOKEN FIELD RETRY/);
 assert.ok(calls[1].messages.at(-1).content.includes(JSON.stringify(repeated.sections[0].actions[0].look)));
 assert.deepEqual(output,{...repeated,resolution:null,sections:[{...repeated.sections[0],actions:[{...repeated.sections[0].actions[0],text:replacement},sleep]}]});
 calls.length=0;backend.structured=async()=>{calls.push({schema:{},messages:[],options:{}});return calls.length===1?structuredClone(repeated):{text:heard};};
 await assert.rejects(planScene({...context,heardText:heard},dependencies,new AbortController().signal),/after a compact retry/);assert.equal(calls.length,2);
});
test('compact first plans advertise and enforce identical bounds while preserving the complete character',async()=>{
 const instruction=scenePlanningInstruction(context,[],{compact:true,maxTokens:1536});
 assert.match(instruction,/one related future section/);assert.match(instruction,/at most two actions/);
 const advertised=scenePlanOutputSchema(1536,true,context);
 assert.ok(instruction.length<JSON.stringify(advertised).length,'The prompt explains the shape without duplicating the decoder schema');
 assert.equal(advertised.properties!.sections.maxItems,1);
 assert.equal(advertised.properties!.sections.items!.properties!.actions.maxItems,2);
 const character='Complete selected character, retained verbatim.';
 let calls=0;
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,schema,options){
  calls++;assert.equal(messages[0].content,character);assert.deepEqual(schema,advertised);assert.equal(options?.maxTokens,1536);
  return plan([{...common,id:'guide',kind:'guide',text:'Notice this familiar heart.'}]);
 },async *stream(){throw Error('Unexpected stream');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:24576,maxTokens:1536,compact:true,messages:[{role:'system',content:character},{role:'user',content:instruction}]},new AbortController().signal);
 assert.equal(calls,1);assert.equal(result.sections[0].actions[0].kind,'guide');
});

test('scene decoding cannot invent an outcome without a pending listener interaction',()=>{
 for(const participation of ['interactive','uninterrupted'] as const){
  const c={...context,participation};
  const full=scenePlanOutputSchema(1536,true,c,true);
  assert.deepEqual(full.properties!.resolution,{type:'null',const:null});
  assert.deepEqual(sceneDraftSchema(full).properties!.resolution,{type:'null',const:null});
  assert.throws(()=>validateScenePlan({...plan([{...common,id:'plain',kind:'guide',text:'Notice this quiet image.'}]),resolution:{challengeId:'imaginary-response',outcome:'grant',reason:'Made up.'}},c),/absent listener response|no real listener response/);
 }
});

test('short phase tails constrain both decoder formats and reject a multi-action candidate before synthesis',async()=>{
 const c={...context,windowMs:25000};
 const schema=scenePlanOutputSchema(3072,false,c,true),actions=schema.properties!.sections.items!.properties!.actions;
 assert.equal(schema.properties!.sections.maxItems,1);assert.equal(actions.maxItems,1);
 assert.ok(!actions.items!.anyOf!.some(v=>v.properties!.kind.const==='peak'),'A peak and its required recovery cannot fit the one-action contract');
 assert.match(scenePlanningInstruction(c,[],{draft:true}),/actions \(1–1\)/);
 assert.match(scenePlanningInstruction(c,[],{draft:true}),/only 25 seconds left/);
 assert.match(scenePlanningInstruction(c),/at most one action per section/);
 let calls=0;
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,output:any){
  calls++;assert.equal(output.properties.actions.maxItems,1);
  if(calls===1)return {strategy:'Continue the image.',actions:[{kind:'guide',text:'Stay with this quiet image.'},{kind:'hold',durationMs:2000}]};
  assert.match(messages.at(-1)!.content,/exactly one action/);
  return {strategy:'Continue the image.',actions:[{kind:'guide',text:'The same quiet image gives this moment room.'}]};
 },async *stream(){throw Error('Unexpected stream');}};
 const result=await planScene(c,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:16000,maxTokens:1536,messages:[{role:'user',content:'Continue the scene.'}],draft:true},new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.sections[0].actions.length,1);
 assert.doesNotThrow(()=>compileScene(result,c,measured(result,9000),options));
 assert.throws(()=>compileScene(result,{...c,windowMs:5000},measured(result,9000),options),/overflow/,'Action count cannot replace measured time admission');
});

test('short-window drafts retain narrow speech bounds and defer only optional breathing',()=>{
 const c={...context,windowMs:10000,pool:{...context.pool,breathing:true}};
 const full=scenePlanOutputSchema(1536,true,c,true),variants=full.properties!.sections.items!.properties!.actions.items!.anyOf!;
 assert.ok(!variants.some(v=>v.properties!.kind.const==='breath'));
 const draft=sceneDraftSchema(full),guide=draft.properties!.actions.items!.anyOf!.find(v=>v.properties!.kind.const==='guide')!.properties!;
 assert.equal(guide.text.maxLength,50);assert.ok(new RegExp(String(guide.text.pattern)).test('A short complete thought.'));
 assert.equal(new RegExp(String(guide.text.pattern)).test('x'.repeat(50)+'.'),false);
 assert.equal(guide.pauseAfterMs.maximum,1000);
 const hold=variants.find(v=>v.properties!.kind.const==='hold')!;assert.equal(hold.properties!.durationMs.maximum,8500);
 const requested=scenePlanOutputSchema(1536,true,{...c,feedback:'Guide one breath cycle.'},true);
 const breath=requested.properties!.sections.items!.properties!.actions.items!.anyOf!.find(v=>v.properties!.kind.const==='breath');
 assert.ok(breath,'An explicit exercise is not silently deferred');assert.deepEqual(breath.properties!.cycles,{type:'integer',const:1});
});

test('focused English drafts repair overlong thoughts before synthesis without truncating them',async()=>{
 let calls=0;const long='Soft '.repeat(44)+'light.';
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,schema:any){
  calls++;if(calls===2){assert.match(messages.at(-1)!.content,/at most 40 spoken words per field/);assert.equal(schema.properties['action-0'].properties.text.maxLength,120);}
  return calls===1?{strategy:'Continue the same light.',actions:[{kind:'guide',text:long}]}:{'action-0':{text:'The same warm light stays with you.'}};
 },async *stream(){throw Error('Unexpected stream');}};
 const dependencies={backend,queue:new InferenceQueue(),model:'fixture',contextTokens:16000,maxTokens:1536,messages:[{role:'user' as const,content:'Write a scene draft.'}],draft:true,speechLanguages:['en']};
 const result=await planScene(context,dependencies,new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.sections[0].actions[0].kind,'guide');
 assert.equal((result.sections[0].actions[0] as Extract<SceneAction,{kind:'guide'}>).text,'The same warm light stays with you.');
 calls=0;backend.structured=async()=>{calls++;return calls===1?{strategy:'Continue.',actions:[{kind:'guide',text:long}]}:{'action-0':{text:long}};};
 await assert.rejects(planScene(context,dependencies,new AbortController().signal),/after a compact retry.*at most 120 character/s);
 assert.equal(calls,2);
});

test('a naturally spaced connected thought can exceed the writing target while the measured audio bound stays strict',async()=>{
 const text='Imagine a swirling vortex of soft pink light, pulling you gently into its embrace. Let each breath carry you further down this rabbit hole of bliss.';
 assert.equal(sceneWordCount(text),26);
 let calls=0;
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(){calls++;return {strategy:'Continue the same imagined light.',actions:[{kind:'guide',text}]};},async *stream(){throw Error('Unexpected stream');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:16000,maxTokens:1536,messages:[{role:'user',content:'Write a scene draft.'}],draft:true,speechLanguages:['en']},new AbortController().signal);
 assert.equal(calls,1);assert.equal(synthesisArcs(result)[0].text,text);
 // The installed voice measured this thought at 11008 ms. This fixture
 // verifies admission only; the real render is saved separately as evidence.
 assert.doesNotThrow(()=>compileScene(result,context,measured(result,11008),options));
 assert.throws(()=>compileScene(result,context,measured(result,20001),options),/bounded speech/);
});

test('a streaming-only scene backend discards malformed JSON and validates its fresh compact reply',async()=>{
 let calls=0;const valid=plan([{...common,id:'guide',kind:'guide',text:'Notice this familiar heart.'}]);
 const backend:LLMBackend={name:'fixture',async models(){return [];},async *stream(){calls++;yield {text:calls===1?'{"text":"cut off':JSON.stringify(valid)};}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:2048,messages:[{role:'user',content:'Full request.'}]},new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.id,valid.id);
});
test('unscheduled catalog cues are rejected before speech rendering and can receive one validated correction',async()=>{
 let calls=0;
 const valid=plan([{...common,id:'guide',kind:'guide',text:'Notice this familiar heart.'}]);
 const unscheduled=plan([{...common,id:'guide',kind:'guide',text:'Bambi Reset. Notice this familiar heart.'}]);
 assert.doesNotThrow(()=>validateScenePlan(unscheduled,context));
 assert.throws(()=>validateScenePlan(unscheduled,context,['Bambi Reset']),/dedicated engine cue actions/);
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages){calls++;if(calls===1)return unscheduled;assert.match(messages.at(-1)!.content,/dedicated engine cue actions/);return valid;},async *stream(){throw Error('Unexpected stream');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:2048,reservedTriggers:['Bambi Reset'],messages:[{role:'user',content:'Full request.'}]},new AbortController().signal);
 assert.equal(calls,2);assert.equal(result.sections[0].actions[0].kind,'guide');
});
test('Bambi is a normal scene address while explicitly scheduled cues retain engine ownership',()=>{
 const c={...context,pool:{...pool,triggers:['Bambi',...pool.triggers]}},reserved=['Bambi','Bambi Sleep','Bambi Reset'];
 const p=plan([{...common,id:'named-guide',kind:'guide',text:'Bambi, notice this familiar heart.'}]);
 assert.doesNotThrow(()=>validateScenePlan(p,c,reserved));
 const compiled=compileScene(p,c,measured(p),{...options,reservedTriggers:reserved});
 assert.equal(compiled.payloads[0].text,'Bambi, notice this familiar heart.');
 assert.equal(compiled.payloads[0].triggerOffsetMs,undefined,'A name does not schedule a cue');
 assert.ok(compiled.events.every(event=>!event.fractionation&&!event.blink));
 for(const phrase of ['Bambi Sleep','Bambi Reset'])assert.throws(()=>validateScenePlan(plan([{...common,id:'illegal-cue',kind:'guide',text:phrase+'.'}]),c,reserved),/dedicated engine cue actions/);
 const explicit=plan([{...common,id:'name-cue',kind:'trigger',preparation:'Follow these next words.',phrase:'Bambi',target:null,wipeMs:0,holdMs:1000}]);
 const cue=compileScene(explicit,c,measured(explicit),{...options,reservedTriggers:reserved});
 assert.ok(cue.payloads.some(payload=>payload.text==='Bambi.'&&payload.triggerOffsetMs!==undefined),'The selected explicit name cue still works');
 const instruction=scenePlanningInstruction(c,reserved);
 assert.match(instruction,/Bambi may be used as the listener.s name/);
 assert.match(instruction,/Reserved cue names[^\n]*\["Bambi Sleep","Blink","Bambi Reset"\]/);
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
test('a model-written paired cycle becomes measured breathing, preserving surrounding words and capability limits',async()=>{
 const c={...context,pool:{...pool,breathing:true}};
 const raw=plan([{...common,id:'paired',kind:'guide',text:'Breathe with me. In... and out. Like the rings on your finger... connecting you.'},
  {...common,id:'paired-after-1',kind:'guide',text:'The same quiet image stays here.'}]);
 assert.throws(()=>validateScenePlan(raw,c),/require an enabled breath action/);
 const normalized=normalizeSceneBreathing(raw,c),actions=normalized.sections[0].actions;
 assert.equal(actions[0].kind,'breath');assert.equal(actions[1].kind,'guide');
 if(actions[0].kind==='breath')assert.deepEqual([actions[0].preparation,actions[0].inText,actions[0].outText,actions[0].inMs,actions[0].outMs],['Breathe with me.','In.','And out.',4000,4000]);
 if(actions[1].kind==='guide')assert.equal(actions[1].text,'Like the rings on your finger... connecting you.');
 assert.equal(new Set(actions.map(action=>action.id)).size,actions.length,'Generated identities cannot collide with later authored actions');
 const compiled=compileScene(normalized,c,measured(normalized),options);
 assert.deepEqual(compiled.events.filter(event=>event.breath).map(event=>event.breath!.direction),['in','out']);
 assert.deepEqual(compiled.payloads.map(payload=>payload.text),['Breathe with me.','In.','And out.','Like the rings on your finger... connecting you.','The same quiet image stays here.']);
 const disabled=normalizeSceneBreathing(raw,context);assert.equal(disabled.sections[0].actions[0].kind,'guide');
 assert.throws(()=>validateScenePlan(disabled,context),/require an enabled breath action/);
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(){return raw;},async *stream(){throw Error('Unexpected stream');}};
 assert.deepEqual(await planScene(c,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:2048,messages:[{role:'user',content:'Full request.'}]},new AbortController().signal),validateScenePlan(normalized,c));
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

test('small scene drafts inherit a look, retain all action capabilities and pass the existing compiler',()=>{
 const c={...context,currentLook:look,pool:{...pool,breathing:true}};
 const schema=sceneDraftSchema(scenePlanOutputSchema(1536,true,c));
 assert.equal(schema.properties!.actions.maxItems,4);
 const draft={strategy:'Keep the same warm heart.',actions:[{kind:'guide',text:'I will stay with this familiar heart.'},{kind:'breath',preparation:'Breathe with me.',inText:'In.',outText:'And out.',inMs:4000,outMs:4000,cycles:1}]};
 const full=validateScenePlan(expandSceneDraft(draft,c),c);
 assert.deepEqual(full.sections[0].actions[0].look,look);assert.deepEqual(full.sections[0].actions[1].look,look);
 assert.equal(new Set(full.sections[0].actions.map(action=>action.id)).size,2);
 assert.ok(synthesisArcs(full).some(arc=>arc.id.endsWith('-out')));
 assert.throws(()=>expandSceneDraft({...draft,atMs:1},c),/Unrecognized/);
 const illegal={...draft,actions:[{kind:'guide',look:{scene:'Deep Tunnel'},text:'Stay with me.'}]};
 assert.throws(()=>validateScenePlan(expandSceneDraft(illegal,{...c,pool:{...c.pool,scenes:['Soft Pink']}}),{...c,pool:{...c.pool,scenes:['Soft Pink']}}),/outside/);
});
test('the draft request omits the serialized schema and corrects pet before synthesis',async()=>{
 const instruction=scenePlanningInstruction(context,[],{compact:true,maxTokens:1536,draft:true});
 const full=scenePlanningInstruction(context,[],{compact:true,maxTokens:1536});
 assert.ok(instruction.length<full.length*.6);assert.ok(!instruction.includes('"additionalProperties"'));
 let calls=0;const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(_messages,_model,_signal,_context,schema){
  calls++;const s=schema as ReturnType<typeof sceneDraftSchema>;assert.ok(s.properties!.actions);assert.ok(!s.properties!.sections);
  return {strategy:'Continue the same image.',actions:[{kind:'guide',text:calls===1?'Stay with me, pet.':'Stay with me, Bambi.'}]};
 },async *stream(){throw Error('Unexpected stream');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:1536,draft:true,messages:[{role:'system',content:'Complete selected character.'},{role:'user',content:instruction}]},new AbortController().signal);
 assert.equal(calls,2);assert.equal((result.sections[0].actions[0] as {text:string}).text,'Stay with me, Bambi.');
});

test('one requested cycle is not scheduled again when the prefetch reservation window is full',()=>{
 const breath:SceneAction={...common,id:'one-breath',kind:'breath',preparation:'Breathe with me.',inText:'In.',outText:'And out.',inMs:4000,outMs:4000,cycles:1};
 const c={...context,feedback:'Guide one comfortable paced breathing cycle.',pool:{...pool,breathing:true}},memory=new RegieMemory();
 memory.feedback(c.feedback);memory.accept(plan([breath]),[{id:'release',fromMs:0,toMs:14000}],memory.generation,true);
 for(let i=0;i<3;i++)memory.accept(plan([{...common,id:'later-'+i,kind:'guide',text:'Stay with this light.'}]),[{id:'release',fromMs:14000+i*3000,toMs:17000+i*3000}],memory.generation,true);
 assert.equal(memory.canPrepare,false);
 assert.throws(()=>memory.accept(plan([{...common,id:'overflow',kind:'guide',text:'This scene must wait.'}]),[{id:'release',fromMs:24000,toMs:27000}],memory.generation,true),/Await output evidence/);
 assert.equal(memory.context().breathCyclesAlreadyCommitted,1);
 const next={...c,breathCyclesAlreadyCommitted:1};
 const schema=sceneDraftSchema(scenePlanOutputSchema(1536,true,next));
 assert.ok(!schema.properties!.actions.items!.anyOf!.some(action=>action.properties!.kind.const==='breath'));
 assert.throws(()=>validateScenePlan(plan([breath]),next),/exactly 0 remaining/);
 memory.observe(14001,'In. And out.');memory.invalidate();assert.equal(memory.context().breathCyclesAlreadyCommitted,1);
 memory.feedback(c.feedback);assert.equal(memory.context().breathCyclesAlreadyCommitted,0);
 memory.accept(plan([breath]),[{id:'release',fromMs:15000,toMs:29000}],memory.generation,true);memory.invalidate();assert.equal(memory.context().breathCyclesAlreadyCommitted,0,'Discarded pending cycles are refunded');
});

test('focused English decoding preserves normal spaces while semantic validation owns word limits',()=>{
 const full=scenePlanOutputSchema(1536,true,context,true),schema=sceneDraftSchema(full,2);
 assert.equal(schema.properties!.actions.maxItems,2);
 const guide=schema.properties!.actions.items!.anyOf!.find(action=>action.properties!.kind.const==='guide')!;
 const pattern=new RegExp(String(guide.properties!.text.pattern));
 assert.equal(pattern.test('Bambi, I will keep this thought clear.'),true);
 assert.equal(pattern.test('Soft '.repeat(19)+'light.'),true);
 assert.equal(pattern.test('Soft '.repeat(20)+'light.'),true,'The decoder must not force words together to fit a whitespace counter');
 assert.equal(sceneWordCount('Soft '.repeat(20)+'light.'),21);
 assert.equal(sceneWordCount('One,two;three-four five.'),5);
 assert.equal(pattern.test('Doll, fuck that noise.'),true,'Word budgeting does not censor vocabulary');
 assert.match(scenePlanningInstruction(context,[],{draft:true,compact:true,englishSpeech:true}),/actions \(1–2\)/);
});

test('unplayed or partially output scenes cannot establish a motif by elapsed time alone',()=>{
 const p=plan([wipe,reply]),c=compileScene(p,context,measured(p),options),memory=new RegieMemory();
 memory.accept(p,c.sections,memory.generation);
 const ids=c.sections.flatMap(s=>s.speechIds);
 memory.observe(c.endMs+10000,'Only the opening words.');
 assert.deepEqual(memory.context().knownMotifs,[]);
 memory.observe(c.endMs+10000,'Only the opening words.',ids.slice(0,-1));
 assert.deepEqual(memory.context().knownMotifs,[],'An unfinished inner answer cannot complete its scene');
 memory.invalidate();memory.observe(c.endMs+20000,'Only the opening words.',ids);
 assert.deepEqual(memory.context().knownMotifs,[],'Late evidence cannot resurrect an invalidated introduction');
 const fresh=new RegieMemory();fresh.accept(p,c.sections,fresh.generation);fresh.observe(c.endMs,'A complete thought.',ids);
 assert.deepEqual(fresh.context().knownMotifs,[{id:'home',meaning:p.sections[0].purpose,form:'heart'}]);
 const recall:SceneAction={...common,id:'recall',kind:'recall',text:'That heart carries the same quiet home.'};
 assert.doesNotThrow(()=>validateScenePlan(plan([recall]),{...context,...fresh.context()}));
 assert.throws(()=>validateScenePlan(plan([{...recall,look:{...look,motif:'ring'}}]),{...context,...fresh.context()}),/visual form/);
});

test('growing output excerpts add only newly completed words to directing history',()=>{
 const memory=new RegieMemory();
 memory.observe(0,'The');memory.observe(50,'The heart');memory.observe(100,'The heart returns.');
 memory.observe(200,'The heart returns.');memory.observe(300,'A new thought.');
 assert.equal(memory.context().heardText,'The heart returns.\nA new thought.');
});

test('motif motion continues across planning boundaries and remains stationary under reduced motion',()=>{
 const p=plan([{...common,id:'g',kind:'guide',text:'The familiar heart stays with this thought.'}]);
 const first=compileScene(p,context,measured(p),options),prior=first.events[0].state.motifMotion!;
 const next=compileScene(p,{...context,currentLook:look,currentMotifMotion:prior},measured(p),{...options,atMs:first.endMs});
 assert.equal(next.events[0].state.motifMotion!.startMs,prior.startMs);
 const moved=placePreparedScene(next,next.atMs+1200,next.endMs+2000);
 assert.equal(moved.events[0].state.motifMotion!.startMs,prior.startMs,'Late preparation must not move the origin of an existing motif');
 const still=plan([{...p.sections[0].actions[0],look:{...look,motion:0}}]);
 const reduced=compileScene(still,{...context,pool:{...pool,reducedMotion:true}},measured(still),options);
 assert.equal(reduced.events[0].visual[0].motion,0);assert.equal(reduced.events[0].state.motifMotion?.kind,'heart_turn','Reduced motion retains the same static volume renderer');
});

test('reveal binds a connected spoken thought, image and mix to one measured phrase',()=>{
 const reveal:SceneAction={...common,id:'reveal',kind:'reveal',text:'Watch the heart appear here, carrying that quiet space.',anchor:'heart appear',before:{...look,motif:null,motifId:null,visualDensity:.05,ambient:.1,effects:0},holdMs:1200};
 const p=plan([reveal]),m=measured(p),c=compileScene(p,context,m,options),event=c.events[0],runtime=new EventRuntime({version:1,durationMs:240000,baseline,motifs:c.motifs,events:c.events});
 const anchor=m[0].words.find(w=>w.word==='heart')!.atMs,at=event.atMs+anchor;
 assert.equal(runtime.snapshot(at-1).state.motifId,undefined);
 assert.equal(runtime.snapshot(at).state.motifId,'home');
 assert.equal(runtime.snapshot(at).state.narrationState,'speaking','The connected voice continues through the image change');
 assert.equal(c.motifs[0].firstIntroducedAtMs,at);
 const silence=runtime.snapshot(event.atMs+1650);
 assert.equal(silence.state.narrationState,'paused');assert.equal(silence.state.motifId,'home');
 const held=presentationAt(runtime.snapshot(event.atMs+2100),runtime.compiled[0],event.atMs+2100);
 assert.equal(held.gains.drone,look.ambient);
 assert.equal(c.payloads.length,1,'One complete PCM thought, with no sentence restart at the change');
 assert.throws(()=>validateScenePlan(plan([{...reveal,anchor:'unknown phrase'}]),context),/anchor/);
 const ambiguous=plan([{...reveal,text:'The heart returns, and the heart returns.',anchor:'heart returns'}]);
 assert.throws(()=>compileScene(ambiguous,context,measured(ambiguous),options),/unambiguous/);
 assert.throws(()=>validateScenePlan(p,{...context,pool:{...pool,visuals:false}}),/unavailable/);
 const shifted=placePreparedScene(c,c.atMs+1000,c.endMs+2000);
 assert.equal(shifted.events[0].softReturn!.steps[1].offsetMs,anchor);
 assert.equal(shifted.motifs[0].firstIntroducedAtMs,at+1000);
});

test('inner speech and return use distinct delivery and the background recovers after PCM ends',()=>{
 const p=plan([reply,sleep]),c=compileScene(p,context,measured(p),options),arcs=synthesisArcs(p);
 assert.equal(arcs.find(a=>a.inner)!.delivery,'hold');assert.equal(arcs.at(-1)!.delivery,'return');
 const event=c.events.find(e=>e.speech.voiceTrack?.speaker==='bambi')!,runtime=new EventRuntime({version:1,durationMs:240000,baseline,motifs:c.motifs,events:c.events});
 const during=presentationAt(runtime.snapshot(event.atMs+500),runtime.compiled.find(e=>e.event.id===event.id),event.atMs+500);
 const after=presentationAt(runtime.snapshot(event.atMs+2100),runtime.compiled.find(e=>e.event.id===event.id),event.atMs+2100);
 assert.ok(during.gains.drone!<after.gains.drone!);assert.equal(after.gains.drone,look.ambient);
});

test('optional scene haptics are local, playback-bound and low intensity, including picture withdrawal',()=>{
 const p=plan([sleep]),c=compileScene(p,context,measured(p),options);
 assert.ok(c.events.every(e=>e.haptics.length===0),'The server/compiler never authorizes actuators');
 const program=withHapticMappings({version:1,durationMs:240000,baseline,motifs:c.motifs,events:c.events}),runtime=new EventRuntime(program);
 const cue=program.events.find(e=>e.speech.requiredTrigger)!,accent=cue.haptics[0];
 assert.ok(accent.speechSlotId);assert.equal(accent.command.intensity,.1);assert.equal(accent.command.durationMs,150);
 assert.equal(accent.offsetMs,cue.speech.triggerAtMs);
 assert.ok(runtime.snapshot(cue.atMs+accent.offsetMs).state.activeLayers.includes('haptics'));
 assert.ok(c.events.every(e=>e.haptics.length===0),'Mapping does not mutate the accepted server scene');
 runtime.stop();assert.equal(runtime.snapshot(cue.atMs+accent.offsetMs).complete,true);
});

test('prefetched motif identities remain reserved without becoming heard history or duplicate introductions',()=>{
 const guide:SceneAction={...common,id:'first',kind:'guide',text:'Imagine the heart as a quiet home.'};
 const first=compileScene(plan([guide]),context,measured(plan([guide])),{...options,instanceId:'first'});
 const future={...context,committedMotifs:[{id:'home',meaning:'A heart becomes a familiar home image.',form:'heart' as const}]};
 const nextPlan=plan([{...guide,id:'next',text:'Let that imagined home grow a little warmer.'}]);
 const next=compileScene(nextPlan,future,measured(nextPlan),{...options,atMs:first.endMs,instanceId:'next'});
 assert.deepEqual(next.motifs,[],'Preparation must not redefine a reserved introduction');
 const runtime=new EventRuntime({version:1,durationMs:240000,baseline,motifs:[],events:[]});
 runtime.appendScene(first);assert.doesNotThrow(()=>runtime.appendScene(next));
 assert.throws(()=>validateScenePlan(plan([{...common,id:'too-soon',kind:'recall',text:'Remember the heart you already saw.'}]),future),/established/);
 assert.throws(()=>validateScenePlan(plan([{...guide,look:{...look,motif:'ring'}}]),future),/visual form/);
});

test('completed section speech remains proven after the bounded output diagnostic rolls over',()=>{
 const p=plan([wipe,reply]),c=compileScene(p,context,measured(p),options),memory=new RegieMemory();memory.accept(p,c.sections,memory.generation);
 const ids=c.sections.flatMap(s=>s.speechIds);
 for(const id of ids)memory.observe(c.endMs-1,'Completed fragment.',[id]);
 assert.deepEqual(memory.context().knownMotifs,[]);
 memory.observe(c.endMs+1,'Completed fragment.',[]);
 assert.equal(memory.context().knownMotifs[0].id,'home');
});

test('measured reveal spans support split hyphenated words and an onset at zero without guessing missing alignment',()=>{
 const reveal:SceneAction={...common,id:'hyphen',kind:'reveal',text:'A heart-shaped light appears in the quiet room.',anchor:'heart-shaped',before:{...look,motif:null,motifId:null},holdMs:500};
 const p=plan([reveal]),m=measured(p);m[0].words=[{word:'A',atMs:0,endMs:80},{word:'heart',atMs:100,endMs:240},{word:'shaped',atMs:250,endMs:400},{word:'light',atMs:420,endMs:550},{word:'appears',atMs:570,endMs:750},{word:'in',atMs:770,endMs:820},{word:'the',atMs:840,endMs:900},{word:'quiet',atMs:920,endMs:1100},{word:'room',atMs:1120,endMs:1300}];
 const c=compileScene(p,context,m,options);assert.equal(c.events[0].softReturn!.steps[1].offsetMs,100);
 const onset=plan([{...reveal,text:'Heart-shaped light appears in the quiet room.'}]),zero=measured(onset);
 zero[0].words=m[0].words.slice(1).map(w=>({...w,atMs:w.atMs-100,endMs:w.endMs!-100}));
 const first=compileScene(onset,context,zero,options);
 assert.equal(first.events[0].softReturn!.steps[0].state.motifId,'home');assert.equal(first.events[0].softReturn!.steps[0].offsetMs,0);
 const missing=structuredClone(m);missing[0].words=[];
 assert.throws(()=>compileScene(p,context,missing,options),/unambiguous/);
});

test('compact reveal drafts leave motif identity to the engine and permit a small before-look',()=>{
 const schema=sceneDraftSchema(scenePlanOutputSchema(1536,true,context,true)),variant=schema.properties!.actions.items!.anyOf!.find(action=>action.properties!.kind.const==='reveal')!;
 assert.equal(variant.properties!.before.properties!.motifId,undefined);assert.equal(variant.properties!.before.properties!.motif,undefined);
 const draft={strategy:'Reveal one home image inside the same spoken thought.',actions:[{kind:'reveal',text:'Watch the heart appear in that quiet space.',anchor:'heart appear',before:{visualDensity:.05,ambient:.1},holdMs:1500}]};
 const p=expandSceneDraft(draft,context),action=p.sections[0].actions[0];assert.equal(action.kind,'reveal');
 if(action.kind==='reveal'){assert.equal(action.before.motifId,null);assert.equal(action.before.motif,null);assert.equal(action.look.motifId,'focus-'+context.pool.motifs[0]);}
 assert.doesNotThrow(()=>compileScene(p,context,measured(p),options));
 assert.throws(()=>expandSceneDraft({...draft,actions:[{...draft.actions[0],before:{motifId:'invented'}}]},context));
});

test('a rejected reveal corrects its literal anchor only, preserving the entire scene and its spoken thought',async()=>{
 const bad=plan([{...common,id:'reveal',kind:'reveal',text:'A heart shape blooms in the quiet room.',anchor:'heart blooms',before:{...look,motif:null,motifId:null},holdMs:1000}]);
 let calls=0;const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,schema:any){calls++;if(calls===1)return bad;assert.match(messages.at(-1)!.content,/APPLICATION SCENE FIELD CORRECTION/);assert.match(messages.at(-1)!.content,/never been heard/);assert.deepEqual(schema.required,['reveal']);assert.deepEqual(schema.properties.reveal.required,['anchor']);assert.ok(schema.properties.reveal.properties.anchor.enum.includes('heart shape blooms'));return {reveal:{anchor:'heart shape blooms'}};},async *stream(){throw Error('Unexpected streaming');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:1536,messages:[{role:'system',content:'Complete character.'},{role:'user',content:'Prepare a connected reveal.'}]},new AbortController().signal);
 const expected=structuredClone(bad);if(expected.sections[0].actions[0].kind==='reveal')expected.sections[0].actions[0].anchor='heart shape blooms';
 assert.equal(calls,2);assert.deepEqual(result,{...expected,resolution:null});
});

test('one measured rehearsal repair selects only aligned subphrases while preserving every spoken arc and PCM',async()=>{
 const a:SceneAction={...common,id:'measured-reveal',kind:'reveal',text:'A quiet heart appears in this room.',anchor:'A quiet heart',before:{...look,motif:null,motifId:null},holdMs:1000};
 const p=plan([a]),m=measured(p);m[0].words=m[0].words.slice(1);let failure:RevealAlignmentError|undefined;
 try{compileScene(p,context,m,options);}catch(error){assert.ok(error instanceof RevealAlignmentError);failure=error;}
 assert.ok(failure);assert.ok(failure.candidates.includes('quiet heart'));assert.ok(!failure.candidates.includes('A'));
 let calls=0,admissions=0;const backend:LLMBackend={name:'fixture',async models(){return [];},async countTokens(){return 400;},async structured(messages,_model,_signal,_context,schema:any,budget){calls++;assert.equal(messages[0].content,'The whole selected character.');assert.ok(schema.properties.anchor.enum.includes('quiet heart'));assert.match(messages.at(-1)!.content,/still uncommitted/);assert.deepEqual(budget,{maxTokens:128,temperature:0});return {anchor:'quiet heart'};},async *stream(){throw Error('No streaming repair');}};
 const dependencies={backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,messages:[{role:'system' as const,content:'The whole selected character.'}],beforeRepair:async()=>{admissions++;}};
 const before=structuredClone(m),repaired=await repairRevealAnchor(p,failure,context,dependencies,new AbortController().signal);
 assert.equal(calls,1);assert.equal(admissions,1);assert.deepEqual(synthesisArcs(repaired),synthesisArcs(p));assert.deepEqual(m,before);
 const compiled=compileScene(repaired,context,m,options);assert.equal(compiled.events[0].softReturn!.steps[1].offsetMs,m[0].words[0].atMs);
 const original=structuredClone(p),candidate=repaired.sections[0].actions[0];if(candidate.kind==='reveal')candidate.anchor=a.anchor;assert.deepEqual(repaired,{...original,resolution:null});
 const forged={...dependencies,backend:{...backend,async structured(){return {anchor:'some unrelated word'};}}};
 await assert.rejects(repairRevealAnchor(p,failure,context,forged,new AbortController().signal),/available measured subphrase/);
 const empty=new RevealAlignmentError(a.id,a.anchor,[]);
 await assert.rejects(repairRevealAnchor(p,empty,context,dependencies,new AbortController().signal),RevealAlignmentError);assert.equal(calls,1);
 const aborted=new AbortController();aborted.abort();await assert.rejects(repairRevealAnchor(p,failure,context,dependencies,aborted.signal),/abort/i);assert.equal(calls,1);
 const tooFull={...dependencies,backend:{...backend,async countTokens(){return 8192;}}};
 await assert.rejects(repairRevealAnchor(p,failure,context,tooFull,new AbortController().signal),/no room/);assert.equal(calls,1);
});

test('one correction repairs pacing text and a literal reveal anchor together without replacing scene decisions',async()=>{
 const guide:SceneAction={...common,id:'bad-pacing',kind:'guide',text:'Inhale slowly, letting the warmth fill the room. Now exhale and let the work go.'};
 const reveal:SceneAction={...common,id:'new-heart',kind:'reveal',text:'Notice the heart shape blooming in this quiet room.',anchor:'heart blooms',before:{...look,motif:null,motifId:null},holdMs:1700};
 const proposed=plan([guide,reveal]),before=structuredClone(proposed),messages=[{role:'system' as const,content:'The entire selected character and collar.'},{role:'user' as const,content:'Use the existing permitted scene.'}];
 let calls=0;const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(input,_model,_signal,_context,schema:any,budget){calls++;if(calls===1)return proposed;assert.equal(input[0].content,messages[0].content);assert.deepEqual(schema.required,['bad-pacing','new-heart']);assert.deepEqual(schema.properties['bad-pacing'].required,['text']);assert.deepEqual(schema.properties['new-heart'].required,['anchor']);assert.equal(budget?.maxTokens,512);assert.match(input.at(-1)!.content,/without inhale\/exhale instructions/);return {'bad-pacing':{text:'Let the familiar warmth gather around that quiet image.'},'new-heart':{anchor:'heart shape'}};},async *stream(){throw Error('Unexpected streaming');}};
 const dependencies={backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:1536,messages};
 const result=await planScene(context,dependencies,new AbortController().signal);
 assert.equal(calls,2);assert.deepEqual(proposed,before,'No mutation of the rejected proposal');
 const expected=structuredClone(before);if(expected.sections[0].actions[0].kind==='guide')expected.sections[0].actions[0].text='Let the familiar warmth gather around that quiet image.';if(expected.sections[0].actions[1].kind==='reveal')expected.sections[0].actions[1].anchor='heart shape';
 assert.deepEqual(result,{...expected,resolution:null});assert.doesNotThrow(()=>compileScene(result,context,measured(result),options));
 for(const illegal of [
  {'bad-pacing':{text:'A new complete thought.',look:{...look,motion:1}},'new-heart':{anchor:'heart shape'}},
  {'bad-pacing':{text:'A new complete thought.'},'new-heart':{anchor:'the heart shape'}},
  {'bad-pacing':{text:'Inhale slowly and watch this picture.'},'new-heart':{anchor:'heart shape'}},
 ]){
  calls=0;backend.structured=async()=>{calls++;return calls===1?proposed:illegal;};
  await assert.rejects(planScene(context,dependencies,new AbortController().signal),/after a compact retry/);assert.equal(calls,2);
 }
});

test('breath preparation repairs as one spoken field without changing explicit cycles, tempo or cue words',async()=>{
 const breath:SceneAction={...common,id:'requested-cycle',kind:'breath',preparation:'Now inhale as it glows and exhale as it softens.',inText:'In.',outText:'And out.',inMs:4000,outMs:4500,cycles:1};
 const proposed=plan([breath]);let calls=0;
 const c={...context,feedback:'Guide one breath cycle.',pool:{...context.pool,modules:['breath' as const],breathing:true}};
 const replacement='Let the familiar heart accompany this quiet moment.';
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,schema:any){
  if(++calls===1)return structuredClone(proposed);
  assert.deepEqual(schema.required,['requested-cycle']);assert.deepEqual(schema.properties['requested-cycle'].required,['preparation']);
  assert.match(messages.at(-1)!.content,/4000/);assert.match(messages.at(-1)!.content,/4500/);
  return {'requested-cycle':{preparation:replacement}};
 },async *stream(){throw Error('Unexpected stream');}};
 const dependencies={backend,queue:new InferenceQueue(),model:'fixture',contextTokens:16000,maxTokens:1536,messages:[{role:'user' as const,content:'Guide the requested cycle.'}]};
 const result=await planScene(c,dependencies,new AbortController().signal);
 assert.equal(calls,2);assert.deepEqual(result.sections[0].actions[0],{...breath,preparation:replacement});
 assert.doesNotThrow(()=>compileScene(result,c,measured(result),options));
 for(const patch of [{preparation:replacement,cycles:2},{preparation:'Inhale slowly and watch that heart.'}]){
  calls=0;backend.structured=async()=>++calls===1?structuredClone(proposed):{'requested-cycle':patch};
  await assert.rejects(planScene(c,dependencies,new AbortController().signal),/after a compact retry/);assert.equal(calls,2);
 }
});

test('a rewritten reveal must return its new matching anchor and cannot retain a stale one',async()=>{
 const proposed=plan([{...common,id:'change',kind:'reveal',text:'Inhale slowly as the heart appears in the room.',anchor:'heart appears',before:{...look,motif:null,motifId:null},holdMs:1000}]);
 let calls=0;const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(_messages,_model,_signal,_context,schema:any){calls++;if(calls===1)return proposed;assert.deepEqual(schema.properties.change.required,['text','anchor']);assert.equal(schema.properties.change.properties.anchor.enum,undefined);return {change:{text:'The familiar heart shines softly beside that quiet door.',anchor:'heart shines'}};},async *stream(){throw Error('Unexpected streaming');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:1536,messages:[{role:'user',content:'Reveal one connected thought.'}]},new AbortController().signal);
 assert.equal(calls,2);assert.doesNotThrow(()=>compileScene(result,context,measured(result),options));
});

test('a repeated guide and reveal share one field correction using actual output history',async()=>{
 const guide='Keep the familiar warm light in view while the next quiet thought takes shape.';
 const reveal='Watch the same quiet heart appear beside the door of that familiar room.';
 const proposed=plan([{...common,id:'old-guide',kind:'guide',text:guide},{...common,id:'old-reveal',kind:'reveal',text:reveal,anchor:'heart appear',before:{...look,motif:null,motifId:null},holdMs:1600}]);
 let calls=0;
 const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,schema:any){
  if(++calls===1)return structuredClone(proposed);
  assert.deepEqual(schema.required,['old-guide','old-reveal']);assert.deepEqual(schema.properties['old-reveal'].required,['text','anchor']);
  assert.ok(messages.at(-1)!.content.includes(JSON.stringify(guide+'\n'+reveal)));
  return {'old-guide':{text:'Let that warmth settle along the quiet edges of the room.'},'old-reveal':{text:'The familiar heart now shines softly beside the open doorway.',anchor:'heart now shines'}};
 },async *stream(){throw Error('Unexpected stream');}};
 const result=await planScene({...context,heardText:guide+'\n'+reveal},{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:16000,maxTokens:1536,messages:[{role:'user',content:'Continue the scene.'}]},new AbortController().signal);
 assert.equal(calls,2);
 for(let i=0;i<2;i++){
  const action=result.sections[0].actions[i],original=proposed.sections[0].actions[i];
  assert.deepEqual(action.look,original.look);assert.equal(action.pauseAfterMs,original.pauseAfterMs);assert.equal(action.delivery,original.delivery);
 }
 const repaired=result.sections[0].actions[1];assert.equal(repaired.kind,'reveal');if(repaired.kind==='reveal')assert.equal(repaired.holdMs,1600);
 assert.doesNotThrow(()=>compileScene(result,context,measured(result),options));
});

test('punctuation without spaces cannot hide excess speech words and correction stays bounded',async()=>{
 const text=Array(43).fill('Warm').join(',')+'.';assert.equal(sceneWordCount(text),43);
 let calls=0;const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(){calls++;return calls===1?{strategy:'Continue the familiar image.',actions:[{kind:'guide',text}]}:{'action-0':{text:'Let that familiar warmth stay around the image.'}};},async *stream(){throw Error('Unexpected streaming');}};
 const result=await planScene(context,{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:8192,maxTokens:1536,draft:true,speechLanguages:['en'],messages:[{role:'user',content:'Continue this scene.'}]},new AbortController().signal);
 assert.equal(calls,2);assert.ok(sceneWordCount((result.sections[0].actions[0] as Extract<SceneAction,{kind:'guide'}>).text)<=20);
});
