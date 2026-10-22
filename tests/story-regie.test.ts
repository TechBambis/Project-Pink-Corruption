// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {RegieMemory,planScene,scenePlanningInstruction,scenePlanOutputSchema,validateEnglishSceneSpeech} from '../packages/session-director/regie/planner';
import {nextStoryMoment,emptyStoryProgress,StoryProgressSchema} from '../packages/session-director/regie/story-contract';
import {composeStoryScene,storyAnchorSpan,storyWritingInstruction,storyBoundaryRest,storyRest} from '../packages/session-director/regie/story';
import {validateScenePlan,type PlanningContext,type ScenePlan} from '../packages/session-director/regie/plan';
import {compileScene,synthesisArcs} from '../packages/session-director/regie/compiler';
import {directionPool} from '../packages/session-director/regie/registry';
import {directionPreset} from '../packages/session-director/direction';
import {journeyPreset} from '../packages/session-director/journeys';
import {referenceState} from '../packages/session-director/events/program';
import {InferenceQueue} from '../packages/ai/inference';
import {StructuredOutputError} from '../packages/ai/structured';
import {validateSceneSections,placePreparedScene} from '../packages/session-director/regie/placement';
import type {LLMBackend,Message} from '../packages/ai';

const pool=directionPool(journeyPreset('pink-cinema',directionPreset('balanced')),{mainVoice:true,innerVoice:true,visuals:true,reducedMotion:false,sounds:{wiper:false,snap:false,rhythm:false},triggers:[]});
const baseline=referenceState({scene:'Soft Pink'}),times={induction:0,deepening:145000,conditioning:241000,anchor:481000,awakening:541000};
function context(memory=new RegieMemory(),extra:Partial<PlanningContext>={}):PlanningContext{return {journey:'pink-cinema',phase:'induction',windowMs:90000,intensity:.55,participation:'uninterrupted',userContext:'Leave my unfinished work outside a quiet room.',pool,...memory.context(),...extra};}
function wav(ms:number){const b=Buffer.alloc(44+ms*48);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
function compile(plan:ScenePlan,c:PlanningContext,serial='fixture',ms=1500){return compileScene(plan,c,synthesisArcs(plan).map(a=>{const words=[...a.text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map(m=>m[0]),step=(ms-100)/words.length;return {id:a.id,bytes:wav(ms),words:words.map((word,i)=>({word,atMs:50+i*step,endMs:50+(i+.8)*step}))};}),{atMs:times[c.phase],durationMs:600000,baseline,instanceId:serial});}
function deliver(memory:RegieMemory,c:PlanningContext,raw:unknown={text:'Let this heart give the unfinished idea somewhere to rest.'},serial='fixture'){
 const m=nextStoryMoment(c)!;const p=composeStoryScene(raw,c,m),s=compile(p,c,serial);assert.equal(memory.accept(p,s.sections,memory.generation),true);memory.observe(s.endMs,s.payloads.map(v=>v.text).join('\n'),s.sections.flatMap(v=>v.speechIds));return {p,s};
}
function dependencies(c:PlanningContext,generate:(schema:any,messages:Message[],call:number)=>unknown){
 let calls=0;const backend:LLMBackend={name:'fixture',async models(){return [];},async structured(messages,_model,_signal,_context,schema){return generate(schema,messages,++calls);},async *stream(){throw Error('Unexpected stream');}};
 return {value:{backend,queue:new InferenceQueue(),model:'fixture',contextTokens:16000,maxTokens:768,messages:[{role:'system' as const,content:'COMPLETE SELECTED CHARACTER, STYLE AND COLLAR.'},{role:'user' as const,content:scenePlanningInstruction(c,[],{draft:true,compact:true,englishSpeech:true})}],speechLanguages:['en'],draft:true},calls:()=>calls};
}

test('Pink cinema chooses six connected moments without restarting an output-confirmed introduction',()=>{
 const memory=new RegieMemory();let c=context(memory);assert.equal(nextStoryMoment(c)!.beat,'introduce');deliver(memory,c);
 c=context(memory);assert.equal(nextStoryMoment(c)!.beat,'explore');deliver(memory,c,{text:'There is space around the familiar image that needs no explanation.'},'explore-0');
 c=context(memory,{phase:'deepening'});assert.equal(nextStoryMoment(c)!.beat,'explore');deliver(memory,c,{text:'One quiet edge can remain without another task to complete.'},'explore-1');
 c=context(memory,{phase:'deepening'});assert.equal(nextStoryMoment(c)!.beat,'exchange');deliver(memory,c,{owner:'Give that image a little room to surprise us.',inner:'I might prefer a little mystery around the edges.',reply:'Then the edges can keep their mystery for this moment.'},'exchange');
 c=context(memory,{phase:'conditioning'});assert.equal(nextStoryMoment(c)!.beat,'contrast');deliver(memory,c,{text:'The surrounding activity can recede while the familiar image stays.'},'contrast');
 c=context(memory,{phase:'anchor'});assert.equal(nextStoryMoment(c)!.beat,'return');deliver(memory,c,{text:'This heart carries the room and its quiet edges together.'},'return');
 c=context(memory,{phase:'awakening'});assert.equal(nextStoryMoment(c)!.beat,'close');const closing=deliver(memory,c,{text:'Let this small imagined chapter come to its natural ending.'},'close');
 assert.match(closing.s.payloads[0].text,/Open your eyes and notice the room around you\./);
 assert.equal(memory.context().story.completed.introduce,1);assert.equal(memory.context().story.completed.close,1);
 assert.equal(new Set(memory.context().story.associations.map(m=>m.beat)).size,6);
 assert.equal(new Set(memory.context().story.associations.map(m=>m.motifId)).size,1);
 assert.notEqual(memory.context().knownMotifs[0].meaning,memory.context().story.associations[0].meaning);
});

test('reserved future moments guide prefetch without becoming heard meanings; elapsed time is insufficient',()=>{
 const memory=new RegieMemory(),c=context(memory),m=nextStoryMoment(c)!,p=composeStoryScene({text:'Let the heart mark one quiet place for this idea.'},c,m),s=compile(p,c);
 memory.accept(p,s.sections,memory.generation);const pending=context(memory);
 assert.equal(nextStoryMoment(pending)!.beat,'explore');assert.equal(pending.story!.completed.introduce,0);
 assert.deepEqual(pending.story!.associations,[]);assert.deepEqual(pending.knownMotifs,[]);assert.equal(pending.committedMotifs![0].id,m.motifId);
 memory.observe(s.endMs+10000,'Only an opening excerpt.');assert.equal(memory.context().story.completed.introduce,0);
 assert.throws(()=>memory.accept(p,s.sections,memory.generation),/next step/);
 memory.invalidate();memory.observe(s.endMs+20000,'Late complete evidence.',s.sections.flatMap(v=>v.speechIds));
 assert.equal(memory.context().story.completed.introduce,0);assert.equal(nextStoryMoment(context(memory))!.beat,'introduce');
});

test('partial exchanges retain an interruption hint without consuming their unfinished step',()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));
 const c=context(memory,{phase:'conditioning'}),m=nextStoryMoment(c)!,p=composeStoryScene({owner:'There is room for another perspective beside this image.',inner:'I would rather keep a little mystery around it.',reply:'A little mystery can stay beside that familiar image.'},c,m),s=compile(p,c,'partial');
 memory.accept(p,s.sections,memory.generation);memory.observe(s.endMs,'There is room for another perspective beside this image.',s.sections[0].speechIds.slice(0,1));memory.feedback('Less sweet, more dry and playful.');
 assert.equal(memory.context().story.completed.exchange,0);assert.equal(memory.context().story.interrupted?.beat,'exchange');
 memory.observe(s.endMs+1,'Late words.',s.sections[0].speechIds);assert.equal(memory.context().story.completed.exchange,0);
 assert.equal(nextStoryMoment(context(memory,{phase:'conditioning'}))!.beat,'adapt');
});

test('new feedback uses the existing free planner once, then resumes the confirmed story',async()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));memory.feedback('More open space, less sweetness.');
 const c=context(memory,{phase:'conditioning'}),d=dependencies(c,()=>({strategy:'Respond to the requested space.',actions:[{kind:'guide',text:'The image can stay while the surrounding composition becomes quieter.',look:{visualDensity:.09,motion:.04,ambient:.05}}]}));
 const p=await planScene(c,d.value,new AbortController().signal);assert.equal(p.moment?.beat,'adapt');
 assert.match(d.value.messages.at(-1)!.content,/SCENE DRAFT/);assert.equal(memory.context().story.adaptedGeneration,-1);
 const s=compile(p,c,'adapt');memory.accept(p,s.sections,memory.generation);
 assert.equal(nextStoryMoment(context(memory,{phase:'conditioning'}))!.beat,'exchange','The reserved adaptation precedes future continuation without claiming it was heard');
 memory.observe(s.endMs,s.payloads[0].text,s.sections.flatMap(v=>v.speechIds));assert.equal(memory.context().story.adaptedGeneration,memory.generation);
 assert.equal(nextStoryMoment(context(memory,{phase:'conditioning'}))!.beat,'exchange');
 memory.feedback('Actually, make it warmer.');assert.equal(nextStoryMoment(context(memory,{phase:'conditioning'}))!.beat,'adapt');
 memory.reset();assert.equal(nextStoryMoment(context(memory))!.beat,'introduce');assert.deepEqual(memory.context().story.associations,[]);
});

test('the writer receives only spoken fields and cannot replace the engine moment or its presentation',async()=>{
 const c=context(),before=structuredClone(c),d=dependencies(c,(schema,messages)=>{assert.deepEqual(schema.required,['text']);assert.deepEqual(Object.keys(schema.properties),['text']);assert.equal(messages[0].content,'COMPLETE SELECTED CHARACTER, STYLE AND COLLAR.');return {text:'Let this heart offer one quiet place for the chosen idea.'};});
 const p=await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),1);assert.equal(p.moment?.beat,'introduce');assert.equal(p.sections[0].actions[0].kind,'reveal');assert.deepEqual(c,before);
 const invalid=dependencies(c,()=>({text:'Let this heart mark a quiet place.',look:{motion:1}}));
 await assert.rejects(planScene(c,invalid.value,new AbortController().signal),/one spoken-field retry/);assert.equal(invalid.calls(),2);
 const forged=structuredClone(p);forged.moment!.step++;assert.throws(()=>validateScenePlan(forged,c),/next engine-selected/);
 assert.equal('moment' in scenePlanOutputSchema(1536,true,c).properties!,false,'General scene models receive no progress-writing field');
});

test('writer retries remain bounded and handle truncated JSON, cancellation and transport failure separately',async()=>{
 const c=context(),d=dependencies(c,(_s,_m,n)=>{if(n===1)throw new StructuredOutputError('truncated');return {text:'The heart gives this chosen idea a little room.'};});
 await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),2);
 const bad=dependencies(c,()=>({text:'Two hearts are not the single required word.'}));await assert.rejects(planScene(c,bad.value,new AbortController().signal),/literal word heart/);assert.equal(bad.calls(),2);
 const failed=dependencies(c,()=>{throw Error('HTTP 503');});await assert.rejects(planScene(c,failed.value,new AbortController().signal),/HTTP 503/);assert.equal(failed.calls(),1);
 const cancelled=dependencies(c,()=>({text:'The heart stays.'})),controller=new AbortController();controller.abort();await assert.rejects(planScene(c,cancelled.value,controller.signal),/abort/i);assert.equal(cancelled.calls(),0);
});

test('literal canonical word spans feed actual alignment; duplicate and absent focus words are rejected',()=>{
 assert.deepEqual(storyAnchorSpan('Watch this HEART appear.'),{fromWord:2,toWord:3,anchor:'HEART'});
 assert.deepEqual(storyAnchorSpan('A heart beside another heart.'),{fromWord:1,toWord:3,anchor:'heart beside'});assert.throws(()=>storyAnchorSpan('An unrelated light.'),/literal word heart/);
 const c=context(),p=composeStoryScene({text:'Watch this heart mark one quiet space.'},c,nextStoryMoment(c)!),s=compile(p,c);
 assert.ok(s.events[0].softReturn!.steps[1].offsetMs>0);assert.equal(s.payloads[0].text,'Watch this heart mark one quiet space.');
 assert.throws(()=>compile(p,c,'too-long',21000),/bounded speech/);
});

test('disabled capabilities, explicit cycles and real interactions retain their existing owners',()=>{
 const c=context();assert.equal(nextStoryMoment({...c,journey:'velvet-drift'}),null);assert.equal(nextStoryMoment({...c,pool:{...pool,visuals:false}}),null);
 assert.equal(nextStoryMoment({...c,feedback:'Guide one breath cycle.'}),null);
 const memory=new RegieMemory();deliver(memory,c);const disabled=context(memory,{phase:'conditioning',pool:{...pool,innerVoice:false,reducedMotion:true}}),p=composeStoryScene({text:'A different imagined perspective can leave a little room for mystery.'},disabled,nextStoryMoment(disabled)!);
 assert.ok(p.sections[0].actions.every(a=>a.kind!=='reply'&&a.look.motion===0));
 const progress=emptyStoryProgress();progress.completed.introduce=1;const short=context(memory,{phase:'conditioning',windowMs:9000,story:progress});
 assert.match(storyWritingInstruction(short,nextStoryMoment(short)!),/JSON with text/);
 assert.equal(StoryProgressSchema.safeParse({...progress,completed:{...progress.completed,introduce:-1}}).success,false);
});

test('the explicit closing happens once and its remaining space needs no model call or extra progress',async()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));deliver(memory,context(memory,{phase:'awakening'}),{text:'The imagined chapter can finish here.'},'closing');
 const c=context(memory,{phase:'awakening',windowMs:12000}),d=dependencies(c,()=>{throw Error('Closing silence must not call a model');});
 const p=await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),0);assert.equal(p.moment,undefined);assert.equal(p.sections[0].actions[0].kind,'hold');assert.equal(synthesisArcs(p).length,0);
 const s=compile(p,c);memory.accept(p,s.sections,memory.generation);memory.observe(s.endMs,'',[]);assert.equal(memory.context().story.completed.close,1);
});


test('short-scene prefetch cannot evict an unheard introduction from the four-scene reservation window',()=>{
 const memory=new RegieMemory();const compiled:ReturnType<typeof compile>[]=[];
 for(let i=0;i<4;i++){
  const c=context(memory),m=nextStoryMoment(c)!,p=composeStoryScene({text:i?'The familiar edge leaves a little space for this thought.':'Let the heart mark one quiet place for this idea.'},c,m),s=compile(p,c,'reserved-'+i);
  memory.accept(p,s.sections,memory.generation);compiled.push(s);
 }
 assert.equal(memory.canPrepare,false);assert.equal(memory.context().story.committed.length,4);
 const c=context(memory),p=composeStoryScene({text:'Another thought can wait for the preceding scene to finish.'},c,nextStoryMoment(c)!),s=compile(p,c,'overflow');
 assert.throws(()=>memory.accept(p,s.sections,memory.generation),/Await output evidence/);
 assert.equal(memory.context().story.committed[0].beat,'introduce');
 const intro=compiled[0];memory.observe(intro.endMs,intro.payloads[0].text,intro.sections[0].speechIds);
 assert.equal(memory.canPrepare,true);assert.equal(memory.context().story.completed.introduce,1);
 assert.equal(nextStoryMoment(context(memory))!.beat,'explore');
});

test('section receipts cannot discard or rename an imagined exchange speech slot before commitment',()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));const c=context(memory,{phase:'conditioning'}),m=nextStoryMoment(c)!;
 const p=composeStoryScene({owner:'A second perspective can leave some room for this image.',inner:'I would keep a little mystery around the edges.',reply:'Then the edges can keep their mystery for this moment.'},c,m),scene=compile(p,c,'receipt');
 assert.equal(scene.sections[0].speechIds.length,3);assert.doesNotThrow(()=>validateSceneSections(scene));
 assert.doesNotThrow(()=>validateSceneSections(placePreparedScene(scene,scene.atMs+700,480000)));
 const missing=structuredClone(scene);missing.sections[0].speechIds.pop();assert.throws(()=>validateSceneSections(missing),/every required speech slot/);
 const renamed=structuredClone(scene);renamed.sections[0].speechIds[0]='made-up-slot';assert.throws(()=>validateSceneSections(renamed),/every required speech slot/);
 const wrong=structuredClone(scene);wrong.sections[0].id='made-up-section';assert.throws(()=>validateSceneSections(wrong),/section evidence/);
 const shorter=structuredClone(scene);shorter.sections[0].toMs--;assert.throws(()=>validateSceneSections(shorter),/event boundary/);
});

test('short phase tails use quiet space; a short final phase still prepares explicit orientation without a model',async()=>{
 const c=context(new RegieMemory(),{windowMs:9000}),d=dependencies(c,()=>{throw Error('No clipped boundary prose');});
 const p=await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),0);assert.equal(p.moment,undefined);assert.equal(p.sections[0].actions[0].look.motif,null);assert.equal(synthesisArcs(p).length,0);assert.ok(compile(p,c).endMs<=c.windowMs);
 const memory=new RegieMemory();deliver(memory,context(memory));const closing=context(memory,{phase:'awakening',windowMs:12000}),close=dependencies(closing,()=>{throw Error('The closing is already authored');});
 const plan=await planScene(closing,close.value,new AbortController().signal);assert.equal(close.calls(),0);assert.equal(plan.moment?.beat,'close');assert.match(synthesisArcs(plan)[0].text,/Open your eyes and notice the room around you\./);assert.doesNotThrow(()=>compile(plan,closing,'short-closing'));
});

test('spoken fields reject role labels and forced contraction endings from the actual writer sample',async()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));const c=context(memory),m=nextStoryMoment(c)!;
 for(const text of ['Inner: Oh, please.','This image stays because it’s.','One quiet thought. I’m.'])assert.throws(()=>validateEnglishSceneSpeech(composeStoryScene({text},c,m)),/speaker label|unfinished contraction/);
 assert.doesNotThrow(()=>validateEnglishSceneSpeech(composeStoryScene({text:'Yes, it is. The familiar image can stay.'},c,m)));
 const d=dependencies(c,(_s,_m,call)=>({text:call===1?'Owner: That familiar edge has some quiet space.':'That familiar edge leaves room for one unfinished idea.'}));
 await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),2);
});

test('a story exchange cannot copy its Owner invitation verbatim from the heard introduction',async()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));const heard='The heart gives the unfinished idea one quiet place. There is space around its edge.';
 const c=context(memory,{phase:'conditioning',heardText:heard}),d=dependencies(c,(_s,_m,call)=>({owner:call===1?heard:'Let this familiar image leave some space for another perspective.',inner:'I might keep a little mystery around those edges.',reply:'Then the edges can keep a little mystery for this moment.'}));
 const p=await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),2);assert.notEqual(synthesisArcs(p)[0].text,heard);
});

test('repeated focus words disambiguate without moving the measured first mention',()=>{
 assert.deepEqual(storyAnchorSpan('That heartbeat carries the familiar image.'),{fromWord:1,toWord:2,anchor:'heartbeat'});
 assert.throws(()=>storyAnchorSpan('A heartening idea stays.'),/literal word heart/);
 const text='Leave the work outside; this room is for the heart, and only the heart.',span=storyAnchorSpan(text);assert.equal(span.anchor,'heart, and');
 const c=context(),p=composeStoryScene({text},c,nextStoryMoment(c)!),scene=compile(p,c,'two-mentions');
 const words=[...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)],expected=50+span.fromWord*(1500-100)/words.length;
 assert.equal(scene.events[0].softReturn!.steps[1].offsetMs,expected);
 assert.equal(scene.payloads[0].text,text,'The engine changes no spoken words');
});

test('quiet boundaries accept fractional remaining windows produced by measured PCM',()=>{
 const c=context(new RegieMemory(),{windowMs:9567.342});
 const p=validateScenePlan(storyBoundaryRest(c),c),action=p.sections[0].actions[0];assert.equal(action.kind,'hold');
 if(action.kind==='hold')assert.equal(action.durationMs,9067);
 const memory=new RegieMemory();deliver(memory,context(memory));deliver(memory,context(memory,{phase:'awakening'}),{text:'Let the imagined chapter finish here.'},'fractional-close');
 const end=context(memory,{phase:'awakening',windowMs:9567.342});assert.doesNotThrow(()=>validateScenePlan(storyRest(end,nextStoryMoment(end)!),end));
});

test('the story journal retains complete output words, preserving its introduction and distinct beat callbacks',()=>{
 const memory=new RegieMemory(),intro='Let this heart give the unfinished idea somewhere to rest.';deliver(memory,context(memory),{text:intro});
 assert.deepEqual(memory.context().story.associations[0].utterances,[intro]);
 const c=context(memory,{phase:'conditioning'}),p=composeStoryScene({owner:'Give this familiar image a little room for another perspective.',inner:'I would leave that imagined note folded for now.',reply:'Then its folded corner can keep a little mystery.'},c,nextStoryMoment(c)!),s=compile(p,c,'journal-inner');
 memory.accept(p,s.sections,memory.generation);memory.observe(s.endMs,'Only the invitation.',s.sections[0].speechIds.slice(0,1));
 assert.ok(!JSON.stringify(memory.context().story.associations).includes('folded for now'));
 memory.observe(s.endMs,s.payloads.map(v=>v.text).join('\n'),s.sections[0].speechIds);
 assert.deepEqual(memory.context().story.associations.find(v=>v.beat==='exchange')?.utterances,s.payloads.map(v=>v.text));
 for(let i=0;i<18;i++){
  const c=context(memory,{phase:'conditioning'}),m=nextStoryMoment(c)!;
  const raw=m.beat==='exchange'?{owner:'An imagined detail can invite another perspective.',inner:'I would keep this one detail unexplained.',reply:'That little mystery can remain beside the image.'}:{text:'One imagined detail remains for this moment.'};deliver(memory,c,raw,'journal-'+i);
 }
 const journal=memory.context().story.associations;assert.equal(journal.length,12);assert.equal(journal[0].beat,'introduce');assert.deepEqual(journal[0].utterances,[intro]);assert.ok(journal.some(v=>v.beat==='exchange'));assert.ok(journal.some(v=>v.beat==='contrast'));
});

test('the director alternates development and inner exchanges instead of filling a phase with one beat',()=>{
 const progress=emptyStoryProgress();progress.completed.introduce=1;progress.completed.explore=2;
 const c=context(new RegieMemory(),{phase:'deepening',story:progress});assert.equal(nextStoryMoment(c)!.beat,'exchange');
 progress.completed.exchange=1;assert.equal(nextStoryMoment(c)!.beat,'explore');progress.completed.explore=4;assert.equal(nextStoryMoment(c)!.beat,'exchange');
});

test('a 25-second phase tail leaves quiet space without requesting constrained filler',async()=>{
 const c=context(new RegieMemory(),{windowMs:25000}),d=dependencies(c,()=>{throw Error('No filler generation');});
 const p=await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),0);assert.equal(synthesisArcs(p).length,0);assert.equal(p.moment,undefined);
});

test('actual feedback adapts in one spoken action and its bounded correction retains the direction',async()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));memory.feedback('Keep that image and give it more open space.');
 const heard='This room is a quiet home where nothing rushes and the familiar heart stays beside the folded note.';
 const c=context(memory,{phase:'conditioning',heardText:heard}),instruction=scenePlanningInstruction(c,[],{draft:true,compact:false,englishSpeech:true});
 assert.match(instruction,/actions \(1–1\)/);assert.match(instruction,/CURRENT ACTUAL DIRECTION/);assert.ok(instruction.endsWith('response.'));
 const schema=scenePlanOutputSchema(1536,false,c,true),variants=schema.properties!.sections.items!.properties!.actions;
 assert.equal(variants.maxItems,1);assert.ok(!variants.items!.anyOf!.some(v=>['hold','peak'].includes(String(v.properties!.kind.const))));
 const d=dependencies(c,(schema,messages,call)=>{
  if(call===1){assert.equal(schema.properties.actions.maxItems,1);assert.ok(schema.properties.actions.items.anyOf.every((v:any)=>v.required.includes('look')&&v.properties.look.required.includes('ambient')));return {strategy:'Give the existing image more room.',actions:[{kind:'guide',text:heard,look:{visualDensity:.09,motion:.04,ambient:.05}}]};}
  assert.ok(messages.at(-1)!.content.includes(c.feedback));
  return {text:'That same image can remain while its surroundings grow quieter.'};
 });
 const result=await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),2);assert.equal(result.moment?.beat,'adapt');assert.equal(result.sections[0].actions.length,1);
 assert.deepEqual({visualDensity:result.sections[0].actions[0].look.visualDensity,motion:result.sections[0].actions[0].look.motion,ambient:result.sections[0].actions[0].look.ambient},{visualDensity:.09,motion:.04,ambient:.05});
});

test('an adapted presentation persists into future moments only while committed or output-confirmed',async()=>{
 const memory=new RegieMemory(),intro=deliver(memory,context(memory));memory.feedback('Keep the same heart with much more space.');
 const c=context(memory,{phase:'conditioning',currentLook:intro.p.sections[0].actions[0].look});
 const profile={visualDensity:.09,motion:.04,ambient:.05};
 const d=dependencies(c,()=>({strategy:'Keep the heart in a quieter surrounding composition.',actions:[{kind:'guide',text:'That same heart can stay in a quieter composition.',look:profile}]}));
 const p=await planScene(c,d.value,new AbortController().signal),s=compile(p,c,'presentation');memory.accept(p,s.sections,memory.generation);
 const look=()=>{const c=context(memory,{phase:'anchor'});return composeStoryScene({text:'This heart can keep its familiar meaning in the quieter space.'},c,nextStoryMoment(c)!).sections[0].actions[0].look;};
 assert.equal(memory.context().story.presentation,null);assert.deepEqual(memory.context().story.committed[0].presentation,profile);
 assert.equal(look().visualDensity,.09);assert.equal(look().motion,.04);assert.equal(look().ambient,.05);
 memory.invalidate();assert.equal(look().visualDensity,.38,'Cancelled future presentation must not become a persistent user preference');
 memory.accept({...p,moment:{...p.moment!,generation:memory.generation}},s.sections,memory.generation);memory.observe(s.endMs,s.payloads[0].text,s.sections.flatMap(v=>v.speechIds));
 assert.deepEqual(memory.context().story.presentation,profile);assert.equal(look().visualDensity,.09);
 const boundary=context(memory,{windowMs:20000,currentLook:{...p.sections[0].actions[0].look,motion:.2,ambient:.2}});
 const rest=await planScene(boundary,dependencies(boundary,()=>{throw Error('No model for a quiet boundary');}).value,new AbortController().signal);
 assert.deepEqual({visualDensity:rest.sections[0].actions[0].look.visualDensity,motion:rest.sections[0].actions[0].look.motion,ambient:rest.sections[0].actions[0].look.ambient},profile,'Quiet boundaries preserve the adapted profile even if current motion was recovered from a clamped rotation period');
 memory.invalidate();assert.equal(look().ambient,.05,'Confirmed presentation survives later conversation invalidation');
 memory.reset();assert.equal(memory.context().story.presentation,null);
});

test('an adaptation cannot silently default its presentation after omitting the look decision',async()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));memory.feedback('More room around the same image.');const c=context(memory,{phase:'conditioning'});
 const d=dependencies(c,()=>({strategy:'Say it is quieter without setting it.',actions:[{kind:'guide',text:'The image is quieter now.'}]}));
 await assert.rejects(()=>planScene(c,d.value,new AbortController().signal),/look.*Required/);assert.equal(d.calls(),2);assert.equal(memory.context().story.adaptedGeneration,-1);
});

test('measured long-session candidates with clipped punctuation endings are rejected before synthesis',()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));const c=context(memory),m=nextStoryMoment(c)!;
 for(const text of ['The note holds a thought that no longer needs to—.','The unfinished words suddenly become…, .','Let that imagined image remain, .'])assert.throws(()=>validateEnglishSceneSpeech(composeStoryScene({text},c,m)),/unfinished clause|clipped clause/);
 assert.doesNotThrow(()=>validateEnglishSceneSpeech(composeStoryScene({text:'The note can remain unfinished. The sentence can still end.'},c,m)));
 assert.throws(()=>validateEnglishSceneSpeech(composeStoryScene({text:"You watch the familiar image. It doesn't need you.}.",},c,m)),/JSON delimiters/);
});

test('the appended orientation cannot conceal an unfinished model closing or a copied closing thought',async()=>{
 const memory=new RegieMemory();deliver(memory,context(memory));const c=context(memory,{phase:'awakening'});
 const d=dependencies(c,(_s,_m,call)=>({text:call===1?'The imagined room fades into a m.':'This imagined chapter can rest beside its familiar image.'}));
 const p=await planScene(c,d.value,new AbortController().signal);assert.equal(d.calls(),2);assert.ok(!synthesisArcs(p)[0].text.includes('a m.'));assert.match(synthesisArcs(p)[0].text,/Open your eyes and notice the room around you\./);
});
