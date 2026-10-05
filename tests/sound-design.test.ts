// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSoundMarker,PhaseSoundDefaults,soundDeviceCommands,soundSpecs,type SoundCue} from '../packages/audio/sound-design';
import {scriptUnits,ScriptDisplayStream} from '../packages/speech/script';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {Kokoro} from '../packages/speech/tts';
import {appendSoundDirection} from '../packages/content/sound-direction';

test('sound protocol accepts only known names and bounded wiper durations',()=>{
  assert.deepEqual(parseSoundMarker('[sound:WIPER:3000]'),{type:'sound',name:'wiper',durationMs:3000});
  assert.deepEqual(parseSoundMarker('[sound:sub_dive]'),{type:'sound',name:'sub_dive'});
  for(const marker of ['[sound:../other]','[sound:wiper:0]','[sound:wiper:20001]','[sound:pop:3000]','[sound:unknown]','[sound:wiper:3e3]'])assert.equal(parseSoundMarker(marker),undefined);
});

test('sound and device markers precede the same word across every streamed boundary',()=>{
  const raw='Before. [sound:sub_dive] [vib:pattern:breathe] [rot:off] [pause:long] BAMBI SLEEP. [sound:wiper:3000] IQ DROP. Next.';
  const parse=(parts:string[])=>{const chunker=new TriggerSentenceChunker();return [...parts.flatMap(part=>chunker.push(part)),...chunker.flush()].flatMap(part=>scriptUnits(part));};
  const expected=parse([raw]);
  for(let split=0;split<=raw.length;split++)assert.deepEqual(parse([raw.slice(0,split),raw.slice(split)]),expected,'split '+split);
  assert.deepEqual(parse([...raw]),expected);
  const sleep=expected.find(unit=>unit.trigger==='BAMBI SLEEP')!;
  assert.equal(sleep.prePause,true);assert.equal(sleep.sounds?.[0].name,'sub_dive');assert.deepEqual(sleep.devicesAtWord?.map(cue=>cue.channel),['vib','rot']);
  assert.equal(expected.find(unit=>unit.trigger==='IQ DROP')?.sounds?.[0].durationMs,3000);
  assert.ok(expected.filter(unit=>unit.sounds).every(unit=>unit.trigger));
  assert.deepEqual(scriptUnits('[sound:snap]'),[]);
});

test('invalid or partial sound tags are hidden from display and speech',()=>{
  const raw='Word [sound:snap] [sound:unknown] [ordinary] end.';
  for(let split=0;split<=raw.length;split++){
    const display=new ScriptDisplayStream();assert.equal(display.push(raw.slice(0,split))+display.push(raw.slice(split))+display.flush(),'Word   [ordinary] end.');
  }
  assert.ok(scriptUnits('[sound:unknown] Hello.')[0].text==='Hello.');
  assert.equal(new ScriptDisplayStream().push('[sound:sub_'),'');
});

test('silent TTS chunks retain pauses but cannot consume a sound cue intended for a word',async()=>{
  const original=globalThis.fetch,inputs:string[]=[];
  try{
    globalThis.fetch=async(_url,options)=>{
      const input=JSON.parse(String(options?.body)).input;inputs.push(input);
      return new Response([
        {audio:'AAAA',audio_format:'wav',text:'',spoken_seconds:0,pause_ms:900,timestamps:[]},
        {audio:'BBBB',audio_format:'wav',text:'BAMBI SLEEP',spoken_seconds:.5,pause_ms:300,timestamps:[]},
      ].map(chunk=>JSON.stringify(chunk)).join('\n')+'\n');
    };
    const chunks=[];for await(const chunk of new Kokoro().speak('[sound:sub_dive] [pause:900] BAMBI SLEEP.','af_heart',1,new AbortController().signal))chunks.push(chunk);
    assert.equal(chunks.length,1);assert.equal(chunks[0].pre_pause_ms,900);assert.equal(chunks[0].sounds?.[0].name,'sub_dive');
    assert.ok(inputs.every(input=>!input.includes('sound:')));
  }finally{globalThis.fetch=original;}
});

test('phase defaults cover countdowns, entry once, trigger mapping, anchor onset and ascending awakening',()=>{
  const plan=new PhaseSoundDefaults();
  assert.deepEqual(plan.plan('A quiet opening.',undefined,'induction'),[]);
  assert.equal(plan.plan('BAMBI SLEEP','BAMBI SLEEP','induction')[0].cue.name,'sub_dive');
  assert.equal(plan.plan('BIMBO DOLL','BIMBO DOLL','induction')[0].cue.name,'snap');
  for(const step of [10,9,8,7,6,5,4,3,2,1])assert.equal(plan.plan(String(step)+'.',undefined,'deepening').length,[10,7,4,1].includes(step)?1:0);
  assert.deepEqual(plan.plan('One.',undefined,'deepening'),[],'Same step is not repeated');
  assert.equal(plan.plan('Begin.',undefined,'conditioning')[0].cue.name,'descent');
  assert.deepEqual(plan.plan('Continue.',undefined,'conditioning'),[]);
  for(const [trigger,name] of [['BAMBI SLEEP','sub_dive'],['BAMBI CUM AND COLLAPSE','sinking'],['IQ DROP','wiper'],['BAMBI POP','pop'],['CUSTOM TRIGGER','snap']])assert.equal(plan.plan(trigger,trigger,'conditioning')[0].cue.name,name);
  assert.equal(plan.plan('IQ DROP','IQ DROP','anchor')[0].at,'start');
  assert.equal(plan.plan('Five.',undefined,'awakening')[0].cue.inverted,true);
  plan.reset();const marker:SoundCue={type:'sound',name:'pop'};
  assert.equal(plan.plan('Begin.',undefined,'conditioning',[marker])[0].reason,'marker');
  assert.deepEqual(plan.plan('Continue.',undefined,'conditioning'),[],'Explicit cue consumes pending entry default');
  const devices=soundDeviceCommands({type:'sound',name:'wiper'});assert.ok(devices.every(command=>command.operation==='off'));
  assert.equal(soundDeviceCommands({type:'sound',name:'sub_dive'},true)[0].intensity,.5);
});

test('sound direction preserves the original text and specifies the sinking level',()=>{
  assert.equal(soundSpecs.sinking.gainDb,-8);
  assert.equal(appendSoundDirection('Original.',false),'Original.');assert.ok(appendSoundDirection('Original.',true).startsWith('Original.\n'));
});
