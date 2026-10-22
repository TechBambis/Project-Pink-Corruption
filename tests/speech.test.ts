// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Kokoro } from '../packages/speech/tts';
import {stripVocalFillers} from '../packages/speech/nonverbal';

test('unreachable speech identifies the service, releases its slot and preserves cancellation',async t=>{
 const provider=new Kokoro('http://127.0.0.1:18883'),controller=new AbortController(),networkError=new TypeError('fetch failed');
 const consume=async(signal:AbortSignal)=>{for await(const _ of provider.speak('Public test.','af_heart',1,signal)){};};
 t.mock.method(globalThis,'fetch',async()=>{throw networkError;});
 await assert.rejects(consume(controller.signal),(error:Error)=>{
  assert.match(error.message,/Local voice service is unreachable/);assert.equal(error.cause,networkError);return true;
 });
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({audio:'AAAA',audio_format:'wav',text:'Public test.',timestamps:[]})+'\n'));
 await consume(controller.signal);
 const cancelled=new AbortController(),reason=Error('Stopped');
 t.mock.method(globalThis,'fetch',async()=>{cancelled.abort(reason);throw networkError;});
 await assert.rejects(consume(cancelled.signal),error=>error===reason);
});

test('unsupported hums are removed without changing words, pauses or numeric units',()=>{
 for(const [input,expected] of [
  ['Mm. There you are.','There you are.'],['Mmm, all right.','all right.'],['mmh! Mhm… Hmm?',''],
  ['Hello. Hmm, that works.','Hello. that works.'],['[hums softly] *humming* (quietly hums) Hello.','Hello.'],
  ['Mm. [pause:900] Ready.','[pause:900] Ready.'],['12 mm. Summer. The MM module. M M.','12 mm. Summer. The MM module. M M.'],
 ])assert.equal(stripVocalFillers(input),expected,input);
});

test('vocal fillers never reach TTS and filler-only replies need no speech request',async()=>{
 const original=globalThis.fetch,inputs:string[]=[];
 try{
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));inputs.push(body.input);return new Response(JSON.stringify({audio:'AAAA',audio_format:'wav',text:body.input,timestamps:[]})+'\n');};
  const provider=new Kokoro();
  for await(const _ of provider.speak('Mm. Mmmmm… [hums] Hmm, Hello.','af_heart',1,new AbortController().signal)){}
  assert.deepEqual(inputs,['Hello.']);
  for await(const _ of provider.speak('Mm. Mhm! [hums softly]','af_heart',1,new AbortController().signal)){}
  assert.equal(inputs.length,1);
 }finally{globalThis.fetch=original;}
});

test('local speech requests retain preset/mix and phrase-level timing, propagate unavailable service',async()=>{
  const original=globalThis.fetch;
  const signal=new AbortController().signal;
  const calls:{url:string;body:any}[]=[];
  try{
    globalThis.fetch=async(url,options)=>{calls.push({url:String(url),body:JSON.parse(String(options?.body))});return new Response(JSON.stringify({audio:'AAAA',audio_format:'wav',timestamps:[],text:'First.',spoken_seconds:.5,pause_ms:900})+'\n'+JSON.stringify({audio:'BBBB',audio_format:'wav',timestamps:[],text:'Second.',spoken_seconds:.7,pause_ms:350})+'\n');};
    const provider=new Kokoro();const chunks=[];
    for await(const chunk of provider.speak('First. [pause:900] Second.','af_sarah:0.6 + af_bella:0.4',.9,signal,'bambi_classic'))chunks.push(chunk);
    assert.equal(calls[0].url,'http://127.0.0.1:8882/dev/captioned_speech');
    assert.equal(calls[0].body.preset,'bambi_classic');assert.equal(calls[0].body.speed,.9);
    assert.equal(calls[0].body.voice,'af_sarah:0.6 + af_bella:0.4');
    assert.deepEqual(chunks.map(chunk=>[chunk.text,chunk.pause_ms]),[['First.',900],['Second.',350]]);
    globalThis.fetch=async()=>new Response('Local voice unavailable',{status:503});
    await assert.rejects(async()=>{for await(const _ of provider.speak('Hello.','af_heart',.95,signal)){}},/503/);
  }finally{globalThis.fetch=original;}
});
