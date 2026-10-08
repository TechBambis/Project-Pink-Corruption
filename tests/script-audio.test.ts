// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeScript,scriptUnits,ScriptDisplayStream} from '../packages/speech/script';
import {Kokoro} from '../packages/speech/tts';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {appendScriptDirection} from '../packages/content/script-direction';

test('script normalization preserves words and converts actual pauses without speaking metadata',()=>{
 assert.equal(normalizeScript('Wait… **I-Q LOCK** …… [PAUSE] --- END ---'),'Wait [pause:2500]  IQ LOCK  [pause:5000]  [SFX:PAUSE_10] ');
 const units=scriptUnits('[SFX:TICK] Three. [SFX:TICK] Two. [SFX:NOT_A_SOUND] One. [SFX:DRONE_OFF]');
 assert.deepEqual(units.map(u=>u.cuesBefore),[['TICK'],['TICK'],undefined]);
 assert.deepEqual(units.at(-1)?.cuesAfter,['DRONE_OFF']);
 assert.ok(units.every(u=>!u.text.includes('[SFX:')));
 assert.deepEqual(scriptUnits('[SFX:PAUSE_10]'),[{text:'',cuesBefore:['PAUSE_10'],control:true}]);
});
test('speech strips emphasis and code delimiters while retaining words, identifiers and control cues',()=>{
 assert.equal(normalizeScript('*one* **two** ***three*** _four_ __five__ `six` af_heart'), 'one two three four five six af_heart');
 assert.deepEqual(scriptUnits('*hums softly* *Ready.* [breath:in] __In.__').map(u=>({text:u.text,breath:u.breath})),[{text:'Ready.',breath:undefined},{text:'In.',breath:{direction:'in',durationMs:4000}}]);
 assert.deepEqual(scriptUnits('*** ` __'),[]);
});

test('automatic trigger groups deduplicate explicit prefix and effects while retaining the trailing pause',()=>{
 for(const [trigger,effects] of [['BAMBI POP','INFLATE,SQUEAK,POP'],['IQ LOCK','WIPERS'],['SNAP AND FORGET','BELL']]){
  const raw=`[SFX:MOAN][SFX:SNAP] **${trigger}** ${effects.split(',').map(e=>`[SFX:${e}]`).join('')} [SFX:PAUSE_5] Next.`;
  const units=scriptUnits(raw);
  assert.equal(units[0].trigger,trigger);assert.equal(units[0].cuesBefore,undefined);
  assert.deepEqual(units[0].cuesAfter,['PAUSE_5']);assert.equal(units[1].text,'Next.');
 }
 assert.deepEqual(scriptUnits('[SFX:MOAN][SFX:SNAP] BAMBI POP [SFX:INFLATE][SFX:SQUEAK][SFX:POP]'),[{text:'BAMBI POP',trigger:'BAMBI POP'}]);
});

test('streamed annotations survive every token boundary and stay attached to their trigger',()=>{
 const raw='Start. [SFX:MOAN][SFX:SNAP] BAMBI POP. [SFX:INFLATE][SFX:SQUEAK][SFX:POP][SFX:PAUSE_5] Next.';
 const run=(parts:string[])=>{const stream=new TriggerSentenceChunker();return [...parts.flatMap(p=>stream.push(p)),...stream.flush()].flatMap(p=>scriptUnits(p));};
 const expected=run([raw]);
 for(let split=0;split<=raw.length;split++)assert.deepEqual(run([raw.slice(0,split),raw.slice(split)]),expected,`split ${split}`);
 assert.deepEqual(run([...raw]),expected);
 assert.equal(expected.flatMap(u=>[...u.cuesBefore??[],...u.cuesAfter??[]]).filter(c=>typeof c==='string'&&['INFLATE','SQUEAK','POP','MOAN','SNAP'].includes(c)).length,0);
});

test('local TTS receives clean words; cues accompany the correct chunks and cue-only scripts avoid inference',async()=>{
 const original=globalThis.fetch,calls:any[]=[];
 try{
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));calls.push(body);
   return new Response(JSON.stringify({text:body.input,audio:'AAAA',audio_format:'wav',timestamps:[],spoken_seconds:.5,pause_ms:350})+'\n');};
  const chunks=[];for await(const c of new Kokoro().speak('[SFX:DRONE_ON] [SFX:TICK] Three. [SFX:MOAN][SFX:SNAP] BAMBI POP [SFX:INFLATE][SFX:SQUEAK][SFX:POP][SFX:PAUSE_5] Next. [SFX:DRONE_OFF]','af_heart',.9,new AbortController().signal,'bambi_classic',[]))chunks.push(c);
  assert.deepEqual(calls.map(c=>c.input),['Three.','BAMBI POP','Next.']);
  assert.deepEqual(chunks[0].cues_before,['DRONE_ON','TICK']);
  assert.deepEqual(chunks[1].cues_after,['PAUSE_5']);assert.equal(chunks[1].trigger,'BAMBI POP');
  assert.deepEqual(chunks[2].cues_after,['DRONE_OFF']);
  const n=calls.length;for await(const c of new Kokoro().speak('[SFX:PAUSE_10][SFX:DRONE_OFF]','af_heart',.9,new AbortController().signal))assert.equal(c.control,true);
  assert.equal(calls.length,n);
 }finally{globalThis.fetch=original;}
});

test('decimal device cues in spoken narration never reach inference across streaming boundaries',async()=>{
 const raw='Mm. All right. [vib:on:0.25] [vib:pattern:constant] Breathe gently. [both:off]';
 const original=globalThis.fetch,inputs:string[]=[];
 try{
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));inputs.push(body.input);return new Response(JSON.stringify({text:body.input,audio:'AAAA',audio_format:'wav',timestamps:[],spoken_seconds:.2})+'\n');};
  for(const parts of [[raw],[...raw],...Array.from({length:raw.length-1},(_,i)=>[raw.slice(0,i+1),raw.slice(i+1)])]){
   const chunker=new TriggerSentenceChunker(),chunks=[];const phrases=[...parts.flatMap(part=>chunker.push(part)),...chunker.flush()];
   for(const phrase of phrases)for await(const chunk of new Kokoro().speak(phrase,'af_heart',1,AbortSignal.timeout(3000)))chunks.push(chunk);
   const commands=chunks.flatMap(chunk=>[...(chunk.cues_before??[]),...(chunk.cues_after??[])]).filter(cue=>typeof cue==='object');
   assert.deepEqual(commands.map(cue=>cue.operation),['on','pattern','off']);assert.equal(commands[0].intensity,.25);
  }
  assert.ok(inputs.length>0);assert.ok(inputs.every(text=>!/[\[\]]|vib:|pattern:|25\]/i.test(text)));
 }finally{globalThis.fetch=original;}
});

test('display hides split machine tags while keeping ordinary bracketed text',()=>{
 const text='Start [SFX:TICK] here [pause:5000] [PAUSE] [ordinary] end.';
 for(let split=0;split<=text.length;split++){
  const stream=new ScriptDisplayStream();assert.equal(stream.push(text.slice(0,split))+stream.push(text.slice(split))+stream.flush(),'Start  here   [ordinary] end.');
 }
 const stream=new ScriptDisplayStream();assert.equal([...text].map(c=>stream.push(c)).join('')+stream.flush(),'Start  here   [ordinary] end.');
});

test('audio prompt directions supplement the existing source rather than replacing its content',()=>{
 const source='Existing source content.';const result=appendScriptDirection(source,'Bubble');
 assert.ok(result.startsWith(source));assert.ok(result.includes('full inflate texture'));assert.ok(result.includes('SCRIPT REQUEST:'));
 assert.ok(!appendScriptDirection(source,'ordinary input').includes('SCRIPT REQUEST:'));
});
