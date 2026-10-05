// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTickMarker,tickBpmForPhase,synthesizeTick} from '../packages/audio/tick';
import {scriptUnits,ScriptDisplayStream} from '../packages/speech/script';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {Kokoro} from '../packages/speech/tts';
import {DeviceCommandSchema} from '../packages/devices/commands';
import {actuatorValue,applyDeviceCommand,offState} from '../packages/devices/patterns';

test('tick markers accept bounded integer BPM, off and ten-second fade metadata',()=>{
  for(const bpm of [20,30,40,50,60,120])assert.deepEqual(parseTickMarker(`[tick:on:${bpm}]`),{type:'tick',operation:'on',bpm});
  assert.deepEqual(parseTickMarker('[tick:off]'),{type:'tick',operation:'off'});
  assert.deepEqual(parseTickMarker('[tick:fade:0]'),{type:'tick',operation:'fade'});
  for(const tag of ['[tick:on:0]','[tick:on:121]','[tick:on:40.5]','[tick:on:Infinity]','[tick:fade:1]','[tick:off:30]'])assert.equal(parseTickMarker(tag),undefined);
});
test('phase tempo slows 60→50→40→30 and awakening requests silence',()=>{
  assert.equal(tickBpmForPhase('induction',0),60);assert.equal(tickBpmForPhase('induction',.6),50);
  assert.equal(tickBpmForPhase('deepening'),40);assert.equal(tickBpmForPhase('conditioning'),30);assert.equal(tickBpmForPhase('anchor'),30);assert.equal(tickBpmForPhase('awakening'),0);
  assert.equal(synthesizeTick(44100).length,Math.round(.065*44100));
});
test('tick and pulse metadata stay with their spoken word at every streaming split',()=>{
  const text='Before. [tick:on:40] [vib:pattern:pulse] Count slowly. [tick:fade:0] Done.';
  const run=(parts:string[])=>{const chunker=new TriggerSentenceChunker();return [...parts.flatMap(part=>chunker.push(part)),...chunker.flush()].flatMap(part=>scriptUnits(part));};
  const expected=run([text]);
  for(let split=0;split<=text.length;split++)assert.deepEqual(run([text.slice(0,split),text.slice(split)]),expected);
  assert.deepEqual(run([...text]),expected);
  assert.equal(expected[1].ticks?.[0].bpm,40);assert.equal(expected[1].devicesAtWord?.[0].pattern,'pulse');
  assert.equal(expected[2].ticks?.[0].operation,'fade');
  const stream=new ScriptDisplayStream();assert.equal([...text].map(char=>stream.push(char)).join('')+stream.flush(),'Before.   Count slowly.  Done.');
});
test('tick-only controls avoid TTS and invalid tick cues never enter the spoken input',async()=>{
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async(_url,options)=>{calls++;const text=JSON.parse(String(options?.body)).input;assert.ok(!text.includes('tick:'));return new Response(JSON.stringify({audio:'AAAA',text,timestamps:[],spoken_seconds:.3})+'\n');};
    const controls=[];for await(const chunk of new Kokoro().speak('[tick:off]','af_heart',1,new AbortController().signal))controls.push(chunk);
    assert.equal(calls,0);assert.equal(controls[0].control,true);assert.equal(controls[0].ticks?.[0].operation,'off');
    for await(const _chunk of new Kokoro().speak('[tick:unknown] Hello.','af_heart',1,new AbortController().signal)){}
    assert.equal(calls,1);
  }finally{globalThis.fetch=original;}
});
test('vibration pulse follows 40 BPM and audio-clock phase while retaining actuator caps',()=>{
  const command=DeviceCommandSchema.parse({type:'device',channel:'vib',operation:'pattern',pattern:'pulse',bpm:40,phaseMs:100});
  const state=applyDeviceCommand(offState(),command,10,.2);
  assert.equal(state.bpm,40);assert.equal(actuatorValue(state,10),.2);assert.equal(actuatorValue(state,10.4),0);
  assert.equal(actuatorValue(state,11.5),.2);assert.equal(actuatorValue(state,12),0);
  for(const command of [{type:'device',channel:'rot',operation:'pattern',pattern:'pulse',bpm:40},{type:'device',channel:'vib',operation:'on',intensity:.3,bpm:40},{type:'device',channel:'vib',operation:'pattern',pattern:'pulse',bpm:40,phaseMs:1500}])assert.equal(DeviceCommandSchema.safeParse(command).success,false);
});
