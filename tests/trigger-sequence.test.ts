// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {effectForTrigger,pauseOnlyTriggers,triggerAliases} from '../config/trigger-sequence';
import {triggerUnits,TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {Kokoro} from '../packages/speech/tts';

test('user associations add an effect only for the specified groups',()=>{
 for(const name of ['IQ Lock','IQ DROP','Braindead Bobblehead','Airhead Barbie'])assert.equal(effectForTrigger(name),'wiper');
 for(const name of ['Bambi Pop','Bubble','Bubble Induction','Blonde Moment','Blank Mindless Doll'])assert.equal(effectForTrigger(name),'pop');
 for(const name of ['Snap and Forget','Bambi Reset','Bambi Awakens','Restrained and Milked'])assert.equal(effectForTrigger(name),'bell');
 for(const name of [...pauseOnlyTriggers,'arbitrary text'])assert.equal(effectForTrigger(name),undefined);
 assert.equal(effectForTrigger('snap_and_forget'),'bell');assert.equal(new Set(triggerAliases).size,triggerAliases.length);
});
test('trigger units isolate each occurrence and longest alias, retain text and explicit pauses',()=>{
 assert.deepEqual(triggerUnits('Stay calm. IQ LOCK. IQ LOCK. Now Bambi Sleep.',['Bambi','Bambi Sleep']),[
  {text:'Stay calm. [pause:0]'},{text:'IQ LOCK',trigger:'IQ LOCK'},{text:'IQ LOCK',trigger:'IQ LOCK'},
  {text:'Now [pause:0]'},{text:'Bambi Sleep',trigger:'Bambi Sleep'}]);
 assert.deepEqual(triggerUnits('Bubble Induction, then bubble. Goodbye.'),[{text:'Bubble Induction',trigger:'Bubble Induction'},{text:'then [pause:0]'},{text:'bubble',trigger:'bubble'},{text:'Goodbye.'}]);
 assert.deepEqual(triggerUnits('Enjoy bubbling and forgotten things.'),[{text:'Enjoy bubbling and forgotten things.'}]);
 assert.deepEqual(triggerUnits('Wait [pause:900] IQ LOCK.'),[{text:'Wait [pause:0]'},{text:'[pause:900] IQ LOCK',trigger:'IQ LOCK',prePause:true}]);
});
test('plain named triggers retain explicit pauses on both sides and remove emphasis',()=>{
 const names=['KEY PHRASE'];
 assert.deepEqual(triggerUnits('Wait [pause:medium] **KEY PHRASE**. [pause:long] Continue.',names),[
  {text:'Wait [pause:0]'},
  {text:'[pause:medium] KEY PHRASE [pause:long]',trigger:'KEY PHRASE',prePause:true,postPause:true},
  {text:'Continue.'},
 ]);
 assert.deepEqual(triggerUnits('*KEY PHRASE* [pause:0]',names),[
  {text:'KEY PHRASE [pause:0]',trigger:'KEY PHRASE',postPause:true},
 ]);
});

test('spoken Snap is isolated at word boundaries while longer names win',()=>{
 assert.deepEqual(triggerUnits('Snap. Then snap and forget. No snapping or snapshot.'),[
  {text:'Snap',trigger:'Snap'}, {text:'Then [pause:0]'},
  {text:'snap and forget',trigger:'snap and forget'}, {text:'No snapping or snapshot.'},
 ]);
});

test('real speech adapter adds metadata for spoken Snap without injected triggers',async()=>{
 const original=globalThis.fetch;const calls:any[]=[];
 try{
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(String(options?.body));calls.push(body);
   return new Response(JSON.stringify({text:body.input,audio:'AAAA',audio_format:'wav',timestamps:[],spoken_seconds:.4})+'\n');
  };
  const chunks=[];
  for await(const chunk of new Kokoro().speak('Snap. Bubble. Bambi Sleep. Bubble Induction. Continue.','af_heart',1,new AbortController().signal,'bambi_local_clean',[]))chunks.push(chunk);
  assert.deepEqual(chunks.map(chunk=>chunk.trigger),['Snap','Bubble','Bambi Sleep','Bubble Induction',undefined]);
  assert.deepEqual(calls.map(body=>!!body.trigger),[false,false,true,true,false],'Only full trigger names opt into slower trigger narration');
  assert.ok(calls.every(body=>body.speed===1));
 }finally{globalThis.fetch=original;}
});

test('streaming never separates a sentence from a following pause marker, even one character at a time',()=>{
 const text='First. [pause:normal] [pause:medium] Next. [pause:long] Last.';
 const expected=['First. [pause:normal] [pause:medium]','Next. [pause:long]','Last.'];
 for(let split=0;split<=text.length;split++){
  const chunker=new TriggerSentenceChunker();
  assert.deepEqual([...chunker.push(text.slice(0,split)),...chunker.push(text.slice(split)),...chunker.flush()],expected);
 }
 const chunker=new TriggerSentenceChunker(['KEY PHRASE']);const chunks:string[]=[];
 for(const character of '[pause:900] **KEY PHRASE**. [pause:long] Continue.')chunks.push(...chunker.push(character));
 chunks.push(...chunker.flush());
 assert.deepEqual(chunks,['[pause:900] **KEY PHRASE**. [pause:long]','Continue.']);
 assert.equal(triggerUnits(chunks[0],['KEY PHRASE'])[0].postPause,true);
 const preceding='Wait. [pause:medium] KEY PHRASE. [pause:long] Continue.';
 for(let split=0;split<=preceding.length;split++){
  const current=new TriggerSentenceChunker(['KEY PHRASE']);
  assert.deepEqual([...current.push(preceding.slice(0,split)),...current.push(preceding.slice(split)),...current.flush()],
   ['Wait. [pause:0]','[pause:medium] KEY PHRASE. [pause:long]','Continue.']);
 }
});

test('trigger speech consolidates silent chunks and passes the trigger flag without changing normal speech',async()=>{
 const original=globalThis.fetch;const calls:any[]=[];
 try{
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(String(options?.body));calls.push(body);
   const chunks=body.trigger?[
    {text:'',audio:'AAAA',pause_ms:900,spoken_seconds:0},
    {text:'KEY PHRASE',audio:'BBBB',pause_ms:1500,spoken_seconds:.4},
   ]:[{text:'Continue.',audio:'CCCC',pause_ms:350,spoken_seconds:.6}];
   return new Response(chunks.map(chunk=>JSON.stringify({...chunk,audio_format:'wav',timestamps:[]})).join('\n')+'\n');
  };
  const result=[];
  for await(const chunk of new Kokoro().speak('[pause:medium] **KEY PHRASE**. [pause:long] Continue.','af_heart',.9,new AbortController().signal,'bambi_classic',['KEY PHRASE']))result.push(chunk);
  assert.equal(result.length,2,'Leading silence is metadata, not a second trigger cue');
  assert.equal(result[0].text,'KEY PHRASE');assert.equal(result[0].pre_pause_ms,900);assert.equal(result[0].post_pause_ms,1500);
  assert.equal(calls[0].trigger,true);assert.equal(calls[0].speed,.9);assert.equal(calls[0].input,'[pause:medium] KEY PHRASE [pause:long]');
  assert.equal(calls[1].trigger,undefined);assert.equal(result[1].trigger,undefined);
 }finally{globalThis.fetch=original;}
});
test('streamed trigger metadata accompanies only separately rendered trigger words',async()=>{
 const original=globalThis.fetch;const calls:string[]=[];
 try{globalThis.fetch=async(_url,options)=>{const {input}=JSON.parse(String(options?.body));calls.push(input);return new Response(JSON.stringify({text:input,audio:'AAAA',audio_format:'wav',timestamps:[],spoken_seconds:.4,pause_ms:350})+'\n');};
  const chunks=[];for await(const chunk of new Kokoro().speak('Calm. IQ LOCK. Safe.', 'af_heart',.9,new AbortController().signal,'bambi_classic',[]))chunks.push(chunk);
  assert.deepEqual(calls,['Calm. [pause:0]','IQ LOCK','Safe.']);assert.deepEqual(chunks.map(c=>c.trigger),[undefined,'IQ LOCK',undefined]);
 }finally{globalThis.fetch=original;}
});

test('streaming length cuts keep multiword triggers whole',()=>{
 const prefix='calm '.repeat(28);const text=prefix+'BAMBI CUM AND COLLAPSE '+'relax '.repeat(30);
 const chunker=new TriggerSentenceChunker();const chunks=[];
 for(const part of [text.slice(0,181),text.slice(181)])chunks.push(...chunker.push(part));chunks.push(...chunker.flush());
 assert.equal(chunks.join(' '),text.trim());assert.equal(chunks.filter(c=>c.includes('BAMBI CUM AND COLLAPSE')).length,1);
});
