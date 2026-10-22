// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceSentenceChunker,DualVoiceSession,voiceScriptRuns,dualVoiceLevels} from '../packages/speech/dual-voice';
import {ScriptDisplayStream} from '../packages/speech/script';
import {Kokoro} from '../packages/speech/tts';
import {backgroundVoiceWindow,connectVoiceTrack} from '../packages/audio/dual-voice';
import {AudioEngine} from '../packages/audio';
import {buildReplyPrompt} from '../packages/ai/prompt';
import {spokenWordCount,narrationPassageComplete} from '../packages/ai/response';
import {situationalPassageComplete} from '../packages/ai/situational';
import {ChatRequestSchema} from '../packages/ai/request';

const script='[owner] Breathe. [pause:long] [bambi:…so warm…] [owner] Good girl. [pause:medium] [bambi] I am soft. [pause:normal] I am here. [owner] Rest.';
const chunk=(parts:string[],enabled=true)=>{const parser=new VoiceSentenceChunker([],enabled);return [...parts.flatMap(part=>parser.push(part)),...parser.flush()];};

test('both voice syntaxes preserve roles, pauses and fragments across every token boundary',()=>{
 const expected=['Breathe. [pause:long]','[bambi]…so warm…','Good girl. [pause:medium]','[bambi]I am soft. [pause:normal]','[bambi]I am here.','Rest.'];
 assert.deepEqual(chunk([script]),expected);assert.deepEqual(chunk([...script]),expected);
 for(let i=0;i<=script.length;i++)assert.deepEqual(chunk([script.slice(0,i),script.slice(i)]),expected,`boundary ${i}`);
 assert.deepEqual(voiceScriptRuns(script,true).map(run=>run.speaker),['owner','bambi','owner','bambi','owner']);
 for(const malformed of ['[owner] Ready. [bam','[owner] Ready. [bambi:unfinished'])assert.deepEqual(chunk([...malformed]),['Ready.']);
});
test('a long inner block streams complete thoughts before a role change or end of generation',()=>{
 const parser=new VoiceSentenceChunker([],true),parts:string[]=[];
 parts.push(...parser.push('[bambi] I feel that warmth. '));
 for(let i=0;i<100;i++){
  parts.push(...parser.push('I can follow this next thought. '));
  assert.ok(parser.pendingCharacters<100,'Only the last thought stays buffered');
 }
 assert.ok(parts.length>=100,'Completed inner thoughts arrive while generation continues');
 assert.ok(parts.every(part=>part.startsWith('[bambi]')));
 parts.push(...parser.flush());
 assert.equal(parts.map(part=>part.slice(7)).join(' '),'I feel that warmth. '+Array(100).fill('I can follow this next thought.').join(' '));
});
test('disabled voices discard background text without swallowing the following main passage',()=>{
 const expected=['Breathe. [pause:long]','Good girl. [pause:medium]','Rest.'];
 assert.deepEqual(chunk([...script],false),expected);
 assert.deepEqual(voiceScriptRuns(script).map(run=>run.text),expected);
 for(const enabled of [false,true]){
  const display=new ScriptDisplayStream(false,false,enabled),visible=[...script].map(char=>display.push(char)).join('')+display.flush();
  assert.ok(!visible.includes('['));assert.equal(visible.includes('so warm'),enabled);assert.equal(visible.includes('I am soft'),enabled);assert.ok(visible.includes('Rest.'));
 }
});
test('progression preserves all phase levels and alternates each complete fragment independently',()=>{
 assert.deepEqual(Object.values(dualVoiceLevels).map(v=>[v.owner,v.bambi]),[[0,-14],[0,-12],[-2,-10],[-4,-6],[-8,-6]]);
 for(const phase of Object.keys(dualVoiceLevels) as (keyof typeof dualVoiceLevels)[]){
  const session=new DualVoiceSession(phase);assert.equal(session.track('owner').gainDb,dualVoiceLevels[phase].owner);
  assert.deepEqual([session.track('bambi').pan,session.track('owner').pan,session.track('bambi').pan],[-.3,0,.3]);
  assert.equal(session.track('bambi').gainDb,dualVoiceLevels[phase].bambi);
 }
 assert.equal(new DualVoiceSession().track('bambi').pan,-.3);
});
test('renderer gets separate voice, speed and pitch while markers and background controls stay out',async()=>{
 const original=globalThis.fetch,calls:any[]=[];
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));calls.push(body);return new Response(JSON.stringify({text:body.input,audio:'AAAA',audio_format:'wav',timestamps:[],spoken_seconds:.5,pause_ms:0})+'\n');};
 try{
  const state=new DualVoiceSession('conditioning'),chunks=[];
  for await(const part of new Kokoro().speak(script,'bambi_classic',.78,AbortSignal.timeout(1000),'bambi_classic',[],false,state))chunks.push(part);
  assert.deepEqual(calls.map(c=>c.voice),['bambi_classic','af_bella','bambi_classic','af_bella','bambi_classic']);
  assert.deepEqual(calls.map(c=>c.speed),[.78,.7,.78,.7,.78]);
  assert.deepEqual(calls.map(c=>c.overrides.pitchSemitones),[-2,1,-2,1,-2]);
  assert.ok(calls.every(c=>c.overrides.layers.left_voice.enabled===false&&c.overrides.processing.echoEnabled===false));
  assert.ok(calls.every(c=>!c.input.includes('[bambi')&&!c.input.includes('[owner')));
  assert.ok(!calls[1].input.includes('…'));
  assert.deepEqual(chunks.filter(c=>c.voice_track?.speaker==='bambi').map(c=>[c.voice_track?.gainDb,c.voice_track?.pan]),[[-10,-.3],[-10,.3]]);
  calls.length=0;for await(const _ of new Kokoro().speak('[bambi:I feel warm. [vib:on:0.5]]','af_bella',.78,AbortSignal.timeout(1000),'bambi_classic',[],false,state)){}
  assert.ok(calls.every(c=>!c.input.includes('vib:')));
  calls.length=0;for await(const _ of new Kokoro().speak('[bambi] BAMBI SLEEP. [SFX:SNAP] [owner] Rest.','af_bella',.78,AbortSignal.timeout(1000),'bambi_classic',[],false,state)){}
  assert.deepEqual(calls.map(c=>c.input),['Rest.']);
  calls.length=0;for await(const _ of new Kokoro().speak(script,'af_heart',.78,AbortSignal.timeout(1000))){}
  assert.ok(calls.every(c=>c.voice==='af_heart'&&!c.input.includes('warm')&&!c.input.includes('I am')));
 }finally{globalThis.fetch=original;}
});
test('inner voice overlaps Owner while its own fragments remain sequential and complete',()=>{
 const first=backgroundVoiceWindow(10,0,10,1,1);
 assert.equal(first.start,10.15);assert.equal(first.duration,1.2);
 const next=backgroundVoiceWindow(10,first.end,10,4,4);
 assert.equal(next.start,first.end);assert.equal(next.duration,4.2);
 assert.ok(backgroundVoiceWindow(14,12,10,1,1).start>=14.035,'late audio never starts in the past');
 assert.ok(backgroundVoiceWindow(10,0,undefined,2,2).start>=10.035,'An unanchored inner thought can start independently');
});
test('the ordinary Bambi name neither schedules implicit effects nor discards inner speech',async()=>{
 const original=globalThis.fetch,calls:any[]=[],chunks=[];
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));calls.push(body);return new Response(JSON.stringify({text:body.input,audio:'AAAA',audio_format:'wav',timestamps:[],spoken_seconds:1,pause_ms:0})+'\n');};
 try{
  for await(const part of new Kokoro().speak('[owner] Bambi, follow this thought. [bambi:I am Bambi.]','af_heart',.78,new AbortController().signal,'bambi_classic',['Bambi','Bambi Sleep'],false,new DualVoiceSession()))chunks.push(part);
  assert.deepEqual(calls.map(call=>call.input),['Bambi, follow this thought.','I am Bambi.']);
  assert.ok(calls.every(call=>!call.trigger));assert.ok(chunks.every(chunk=>!chunk.trigger&&!chunk.cues_before?.length&&!chunk.cues_after?.length));
  assert.ok(chunks.some(chunk=>chunk.voice_track?.speaker==='bambi'));
  calls.length=0;
  for await(const _ of new Kokoro().speak('[bambi:I hear Bambi Sleep.]','af_heart',.78,new AbortController().signal,'bambi_classic',['Bambi','Bambi Sleep'],false,new DualVoiceSession())){}
  assert.equal(calls.length,0,'Unscheduled compound triggers remain forbidden in the inner route');
 }finally{globalThis.fetch=original;}
});
test('audio routing applies the relative gain and short room taps, with centered mono fallback',()=>{
 for(const channels of [1,2]){
  const created:any[]=[],source={connect(){},disconnect(){}},context={destination:{maxChannelCount:channels},
   createGain:()=>{const node={gain:{value:0},connect(){},disconnect(){}};created.push(node);return node;},
   createStereoPanner:()=>{const node={pan:{value:0},connect(){},disconnect(){}};created.push(node);return node;},
   createDelay:()=>{const node={delayTime:{value:0},connect(){},disconnect(){}};created.push(node);return node;}};
  const cleanup=connectVoiceTrack(context as unknown as AudioContext,source as unknown as AudioNode,{} as AudioNode,new DualVoiceSession('induction').track('bambi'));
  assert.equal(created[0].gain.value,10**(-14/20));assert.equal(created[1].pan.value,channels===1?0:-.3);
  assert.deepEqual(created.filter(n=>n.delayTime).map(n=>n.delayTime.value),[.2/3,.2*2/3,.2]);cleanup();
 }
});

test('dual voice is opt-in and prompted for narration in both conversation styles',()=>{
 assert.equal(ChatRequestSchema.parse({type:'chat',text:'hello'}).dualVoice,false);
 for(const interaction of ['reactive','situational'] as const){
  assert.ok(buildReplyPrompt('Base','Continue',false,'',undefined,'',false,true,interaction,'',true).includes('=== DUAL VOICE PROTOCOL'));
  assert.ok(!buildReplyPrompt('Base','A question',false,'',undefined,'',true,false,interaction,'',true).includes('=== DUAL VOICE PROTOCOL'));
  const prompt=buildReplyPrompt('Base','Continue',false,'',undefined,'',false,true,interaction,'',true);
  assert.match(prompt,/external adult female hypnotist/);assert.match(prompt,/internal feminine self-narrator/);
  assert.match(prompt,/play it softly in parallel with Owner speech/);
  assert.doesNotMatch(prompt,/Never overlap|Owner waits in silence/);
 }
});


test('inline background words count toward passage limits and incomplete fragments never end generation',()=>{
 const passage='[owner] Rest. [pause:long] [bambi:I feel warm.]';
 assert.equal(spokenWordCount(passage),4);
 assert.ok(narrationPassageComplete(passage,'anchor','4 words'));
 assert.ok(situationalPassageComplete(passage,'guide','4 words'));
 assert.equal(narrationPassageComplete(passage.slice(0,-1),'anchor','1 words'),false);
 assert.equal(situationalPassageComplete(passage.slice(0,-1),'guide','1 words'),false);
});

function playbackFixture(){
 const sources:any[]=[],routing:any[]=[];
 const buffer=(channels:number,length:number,rate:number)=>{const data=Array.from({length:channels},()=>new Float32Array(length));return {numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,getChannelData:(ch:number)=>data[ch]};};
 const audioNode=(data:object={})=>{const node={...data,connect(){},disconnect(){}};routing.push(node);return node;};
 const engine=Object.assign(Object.create(AudioEngine.prototype),{
  context:{currentTime:0,state:'running',sampleRate:1000,destination:{maxChannelCount:2},
   decodeAudioData:async(bytes:ArrayBuffer)=>buffer(1,new Uint8Array(bytes)[0]*1000,1000),createBuffer:buffer,
   createBufferSource:()=>{const node={buffer:null as any,onended:null as any,started:0,stopped:false,connect(){},disconnect(){},start(time:number){this.started=time;},stop(){this.stopped=true;}};sources.push(node);return node;},
   createGain:()=>audioNode({gain:{value:1,cancelScheduledValues(){},setTargetAtTime(){},setValueAtTime(){}}}),
   createStereoPanner:()=>audioNode({pan:{value:0}}),createDelay:()=>audioNode({delayTime:{value:0}})},
  nodes:{main_voice:{},AI_VOICE:{gain:{cancelScheduledValues(){},setTargetAtTime(){},setValueAtTime(){}}}},levels:{AI_VOICE:1},voiceEpoch:0,voicesEnd:0,voiceSources:new Set(),foreground:new Map(),controlSources:new Set(),triggerEvents:[],
  dualVoiceCleanup:new Map(),eventVoiceCleanup:new Map(),designSettings:{enabled:false},deliveryMix:{set(){}},
  voiceEchoes:{schedule(){throw Error('Dual Voice must not duplicate Owner into echoes');},stop(){}},
  breathAudio:{stop(){}},tickEngine:{active:false,setVoiceLevel(){}},speechDucker:{schedule(){},forget(){},clear(){}},clearDesignSilence(){},
 }) as AudioEngine;
 return {engine,sources,routing};
}

test('actual playback overlaps both voices, keeps independent queues and cancels both tracks',async()=>{
 const {engine,sources}=playbackFixture(),state=new DualVoiceSession('anchor'),events:number[]=[];
 const play=async(seconds:number,spoken:number,speaker:'owner'|'bambi')=>engine.playVoice(Uint8Array.of(seconds).buffer,start=>events.push(start),()=>{},undefined,{spokenSeconds:spoken,text:'Rest.',voiceTrack:state.track(speaker)});
 await play(3,1,'owner');await play(4,4,'bambi');await play(1,1,'owner');
 assert.equal(sources.length,3);assert.ok(events[1]<events[0]+1,'Inner voice overlaps the first main sentence');
 assert.equal(events[2],events[0]+3,'Owner retains its own authored pause');
 assert.ok(events[2]<events[1]+4.2,'A long inner thought cannot delay the next Owner sentence');
 const buffer=engine.voiceBuffer();assert.ok(buffer.speechSeconds<5,'Parallel speech is counted as a union, not summed twice');
 assert.ok(buffer.queuedSeconds>=events[1]+4.2,'Render-ahead retains the whole inner voice and room tail');
 assert.equal(sources[1].buffer.numberOfChannels,1,'Background is downmixed before panning');
 engine.stopVoice(false,true);assert.ok(sources.every(source=>source.stopped));assert.equal((engine as any).voiceSources.size,0);assert.equal((engine as any).dualVoiceCleanup.size,0);
 const short=playbackFixture();await short.engine.playVoice(Uint8Array.of(2).buffer,()=>{},()=>{},undefined,{spokenSeconds:1.5,voiceTrack:state.track('owner')});
 await short.engine.playVoice(Uint8Array.of(1).buffer,()=>{},()=>{},undefined,{spokenSeconds:1,voiceTrack:state.track('bambi')});
 assert.ok(short.sources[1].started<short.sources[0].started+1.5,'An inner voice can overlap when no long pause was authored');
 const firstInner=short.sources[1];
 await short.engine.playVoice(Uint8Array.of(1).buffer,()=>{},()=>{},undefined,{spokenSeconds:1,voiceTrack:state.track('bambi')});
 assert.ok(short.sources[2].started>=firstInner.started+1.2,'Inner fragments never cover one another');
 (short.engine.context as unknown as {currentTime:number}).currentTime=20;
 await short.engine.playVoice(Uint8Array.of(1).buffer,()=>{},()=>{},undefined,{spokenSeconds:1,voiceTrack:state.track('bambi')});
 assert.ok(short.sources[3].started>=20.035,'Late synthesis is not backdated');
 short.engine.stopVoice(false,true);
 await short.engine.playVoice(Uint8Array.of(1).buffer,()=>{},()=>{},undefined,{spokenSeconds:1,voiceTrack:state.track('owner')});
 assert.equal(short.sources[4].started,20.035,'Stop clears both scheduling horizons');
});
