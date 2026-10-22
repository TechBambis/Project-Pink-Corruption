// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {Kokoro,isMossVoice,mossCapabilities} from '../packages/speech/tts';
import {DualVoiceSession} from '../packages/speech/dual-voice';
import {SpeechPlayback} from '../packages/speech/playback';

test('native reference capabilities exclude blending and fabricated word times',()=>{
 assert.equal(isMossVoice('moss_doll_q8'),true);
 for(const invalid of ['moss_../private','moss_doll_q8 + af_heart','af_heart','moss_'])assert.equal(isMossVoice(invalid),false);
 assert.equal(mossCapabilities.wordTimings,false);assert.equal(mossCapabilities.voiceBlending,false);
});

test('long replies respect both native and ordinary renderer limits without losing their ending',async()=>{
 const original=globalThis.fetch;
 const text=('Every fucking word belongs here. ').repeat(160)+'This is the final sentence.';
 try{
  for(const voice of ['moss_doll_q8','af_heart']){
   const requests:string[]=[];
   globalThis.fetch=async(_url,init)=>{
    const body=JSON.parse(String(init?.body));requests.push(body.input);
    assert.ok(body.input.length<=(voice==='moss_doll_q8'?1000:3000));
    return new Response(JSON.stringify({audio:'whole',audio_format:'wav',timestamps:[],text:body.input,history_mode:'complete'})+'\n');
   };
   const spoken:string[]=[];
   for await(const chunk of new Kokoro().speak(text,voice,1,new AbortController().signal))spoken.push(chunk.text??'');
   assert.ok(requests.length>1);assert.equal(spoken.join(' '),text);assert.equal(requests.join(' '),text);
  }
 }finally{globalThis.fetch=original;}
});

test('completed-utterance history never estimates partially heard MOSS words',()=>{
 const playback=new SpeechPlayback();playback.schedule(0,'',1,.08,[],'complete');
 playback.schedule(1,'We can decide together.',1.08,.24,[],'complete');
 assert.deepEqual(playback.progress(1.3),[]);assert.equal(playback.revealed(1.3),'');
 assert.deepEqual(playback.progress(1.33),[{seq:1,chars:'We can decide together.'.length}]);
 assert.equal(playback.revealed(1.33),'We can decide together.');
 playback.clear();assert.equal(playback.spoken(5),'');
});

test('MOSS packets keep empty prefix history and use native configuration through the shared client',async()=>{
 const original=globalThis.fetch;const bodies:Record<string,any>[]=[];
 globalThis.fetch=async(_url,init)=>{
  bodies.push(JSON.parse(String(init?.body)));
  return new Response([
   {audio:'prefix',audio_format:'wav',timestamps:[],text:'',stream:{id:'u',final:false,index:0,offset:0,samples:3840,sampleRate:48000,channels:2},history_mode:'complete'},
   {audio:'tail',audio_format:'wav',timestamps:[],text:'Hello.',stream:{id:'u',final:true,index:1,offset:3840,samples:3840,sampleRate:48000,channels:2},history_mode:'complete'},
  ].map(chunk=>JSON.stringify(chunk)+'\n').join(''));
 };
 try{
  const chunks=[];for await(const chunk of new Kokoro().speak('Hello.','moss_doll_q8',.78,new AbortController().signal))chunks.push(chunk);
  assert.equal(bodies.length,1);assert.equal(bodies[0].provider,'moss');assert.equal(bodies[0].speed,1);
  assert.equal(bodies[0].overrides.sampleRate,48000);assert.equal(bodies[0].overrides.processing.enabled,false);
  assert.deepEqual(chunks.map(c=>c.text),['','Hello.']);assert.equal(chunks[1].stream?.final,true);
  await assert.rejects(async()=>{for await(const _ of new Kokoro().speak('Hello.','moss_doll_q8 + af_heart',1,new AbortController().signal)){}},/without voice blending/);
 }finally{globalThis.fetch=original;}
});

test('isolated events and dual voice request whole utterances; background retains its own existing voice',async()=>{
 const original=globalThis.fetch;const bodies:Record<string,any>[]=[];
 globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));bodies.push(body);return new Response(JSON.stringify({audio:'whole',audio_format:'wav',timestamps:[],text:body.input,history_mode:'complete'})+'\n');};
 try{
  for await(const _ of new Kokoro().speak('Hello.','moss_doll_q8',1,new AbortController().signal,'bambi_local_clean',[],true)){}
  assert.equal(bodies[0].whole_utterance,true);
  for await(const _ of new Kokoro().speak('[owner]Hello. [bambi]Yes.','moss_doll_q8',1,new AbortController().signal,'bambi_local_clean',[],false,new DualVoiceSession())){}
  assert.equal(bodies[1].provider,'moss');assert.equal(bodies[1].whole_utterance,true);
  assert.equal(bodies[2].provider,undefined);assert.equal(bodies[2].voice,'af_bella');
 }finally{globalThis.fetch=original;}
});

test('missing EOS and stale packet offsets cannot credit a native utterance',async()=>{
 const original=globalThis.fetch;
 const prefix={audio:'prefix',audio_format:'wav',timestamps:[],text:'',history_mode:'complete',stream:{id:'u',final:false,index:0,offset:0,samples:3840,sampleRate:48000,channels:2}};
 try{
  for(const packets of [[prefix],[prefix,{...prefix,text:'Hello.',stream:{...prefix.stream,final:true,index:1,offset:0}}]]){
   globalThis.fetch=async()=>new Response(packets.map(p=>JSON.stringify(p)+'\n').join(''));
   const heard:string[]=[];
   await assert.rejects(async()=>{for await(const chunk of new Kokoro().speak('Hello.','moss_doll_q8',1,new AbortController().signal))heard.push(chunk.text??'');},/Native speech ended|Invalid or stale/);
   assert.deepEqual(heard,['']);
  }
 }finally{globalThis.fetch=original;}
});

test('spoken Snap and Bubble retain complete MOSS audio without acquiring a full trigger sequence',async()=>{
 const original=globalThis.fetch;const requests:Record<string,any>[]=[];
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  const packets=body.whole_utterance?[{audio:'whole-audio',audio_format:'wav',timestamps:[],text:body.input,history_mode:'complete'}]:[
   {audio:'discarded-prefix',audio_format:'wav',timestamps:[],text:'',history_mode:'complete',stream:{id:'u',final:false,index:0,offset:0,samples:3840,sampleRate:48000,channels:2}},
   {audio:'tail-only',audio_format:'wav',timestamps:[],text:body.input,history_mode:'complete',stream:{id:'u',final:true,index:1,offset:3840,samples:3840,sampleRate:48000,channels:2}},
  ];return new Response(packets.map(p=>JSON.stringify(p)+'\n').join(''));
 };
 try{
  for(const trigger of ['Snap','Bubble']){
   const chunks=[];for await(const chunk of new Kokoro().speak(trigger+'.','moss_doll_q8',1,new AbortController().signal,'bambi_local_clean',[trigger]))chunks.push(chunk);
   const request=requests.at(-1);assert.ok(request);assert.equal(request.whole_utterance,true);assert.equal(request.trigger,undefined);
   assert.equal(chunks.length,1);assert.equal(chunks[0].audio,'whole-audio');assert.equal(chunks[0].trigger?.toLowerCase(),trigger.toLowerCase());
  }
 }finally{globalThis.fetch=original;}
});
