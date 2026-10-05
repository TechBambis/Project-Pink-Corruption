// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBreathMarker,breathInstruction} from '../packages/speech/breath';
import {scriptUnits,ScriptDisplayStream} from '../packages/speech/script';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {Kokoro} from '../packages/speech/tts';
import {BreathVisualState} from '../packages/visuals/breath-sync';
import {breathSamples} from '../packages/audio/breath';
import {bambiVoiceDirection} from '../packages/content/voice';
import {buildReplyPrompt} from '../packages/ai/prompt';

test('shared voice and both reply modes receive one explicit breathing protocol',()=>{
 assert.match(bambiVoiceDirection,/CORRECT: \[breath:in\] In\. \[breath:out\] And out\./);
 assert.match(bambiVoiceDirection,/WRONG: Feel your chest rising and falling\./);
 for(const dialogue of [false,true]){
  const prompt=buildReplyPrompt('Fixture persona','Guide three breaths',false,'',undefined,'',dialogue);
  assert.equal(prompt.split('=== BREATHING PROTOCOL ===').length-1,1);
  assert.ok(prompt.includes(bambiVoiceDirection));
  assert.match(prompt,/without additional pause tags/);
 }
});

test('breath markers survive streaming boundaries only in the private speech channel',()=>{
 const raw='Follow comfortably. [breath:in] In. [breath:out:5000] And out. [vib:on:0.2] Rest.';
 const parse=(parts:string[])=>{const stream=new ScriptDisplayStream(true),chunker=new TriggerSentenceChunker([],true);const phrases=parts.flatMap(p=>chunker.push(stream.push(p)));phrases.push(...chunker.push(stream.flush()),...chunker.flush());return phrases.flatMap(p=>scriptUnits(p));};
 const expected=parse([raw]);
 for(let split=0;split<=raw.length;split++){
  assert.deepEqual(parse([raw.slice(0,split),raw.slice(split)]),expected);
  const display=new ScriptDisplayStream();const visible=display.push(raw.slice(0,split))+display.push(raw.slice(split))+display.flush();
  assert.ok(!/breath:|vib:/.test(visible));
 }
 assert.deepEqual(parse([...raw]),expected);
 assert.deepEqual(expected.filter(u=>u.breath).map(u=>({text:u.text,breath:u.breath})),[{text:'In.',breath:{direction:'in',durationMs:4000}},{text:'And out.',breath:{direction:'out',durationMs:5000}}]);
 assert.equal(parseBreathMarker('[breath:out:99999]'),undefined);
 assert.equal(scriptUnits('[breath:in]').length,0);
 assert.equal(breathInstruction('Breathe in. [pause:0]')?.direction,'in');
 assert.equal(breathInstruction('Und aus.')?.direction,'out');
 assert.equal(breathInstruction('Breathe in when it feels comfortable, then tell me how you feel.'),undefined);
});
test('TTS gets clean instructions and exports breathing metadata on the first spoken chunk',async()=>{
 const original=globalThis.fetch,inputs:string[]=[];
 try{globalThis.fetch=async(_url,options)=>{const input=JSON.parse(String(options?.body)).input;inputs.push(input);return new Response(JSON.stringify({audio:'AAAA',text:input,timestamps:[{word:input,start_time:.04,end_time:.4}],spoken_seconds:.4})+'\n');};
  const chunks=[];for await(const chunk of new Kokoro().speak('[breath:in] In. [breath:out] And out.','af_heart',.78,AbortSignal.timeout(2000)))chunks.push(chunk);
  assert.deepEqual(inputs,['In.','And out.']);assert.deepEqual(chunks.map(c=>c.breath?.direction),['in','out']);
 }finally{globalThis.fetch=original;}
});
test('queued inhale/exhale read the audio clock, preserve phase endpoints and respect reduced motion',()=>{
 const state=new BreathVisualState();state.schedule({direction:'in',durationMs:4000},10);state.schedule({direction:'out',durationMs:4000},14);
 assert.equal(state.frame(9).active,false);assert.equal(state.frame(10).scale,1);assert.equal(state.frame(12).scale,1.075);
 const out=state.frame(14);assert.equal(out.direction,'out');assert.equal(out.scale,1.15);
 assert.ok(state.frame(16).opacity<out.opacity);assert.equal(state.frame(18).scale,1);assert.equal(state.frame(18.4).active,false);
 state.schedule({direction:'in',durationMs:4000},20);assert.equal(state.frame(20,true).scale,state.frame(22,true).scale);
 state.clear();assert.equal(state.frame(22).active,false);
});
test('original breathing texture is bounded, repeatable and fades in and out without clicks',()=>{
 for(const direction of ['in','out'] as const){const pcm=breathSamples(direction,16000);assert.equal(pcm.length,48000);assert.equal(pcm[0],0);assert.ok(Math.abs(pcm.at(-1)!)<.00001);assert.ok(pcm.every(x=>Number.isFinite(x)&&Math.abs(x)<1));assert.deepEqual(pcm,breathSamples(direction,16000));}
});
