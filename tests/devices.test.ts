// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceController,type DeviceTransport} from '../packages/devices/controller';
import {DeviceCommandSchema,DeviceSettingsSchema,parseDeviceMarker,devicePrompt} from '../packages/devices/commands';
import {actuatorValue,applyDeviceCommand,offState} from '../packages/devices/patterns';
import {ScriptDisplayStream,scriptUnits} from '../packages/speech/script';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {Kokoro} from '../packages/speech/tts';

function fixture(){let time=100;const packets:string[]=[];const transport:DeviceTransport={send:packet=>packets.push(packet),close(){}};const engine=new DeviceController(transport,()=>time,()=>.5,false),owner={};
 const beat=(elapsed:number,running=true,paused=false)=>engine.heartbeat(owner,{running,paused,elapsed,duration:1000});
 const advance=(seconds:number)=>{time+=seconds;engine.bridgeStatus({connected:true,device:'fixture'});};
 const arm=(settings:Record<string,unknown>={})=>{engine.bridgeStatus({connected:true});assert.ok(engine.configure(owner,{enabled:true,vibrationChannel:1,rotationChannel:2,...settings}));beat(0);};
 const command=(marker:string)=>engine.command(owner,parseDeviceMarker(marker));
 return {engine,owner,packets,beat,advance,arm,command};
}

test('conversation interruption discards future word commands while preserving the current bounded session pattern',()=>{
 const f=fixture();f.arm({phaseDefaults:false,vibrationMax:.2});f.command('[vib:on:0.2]');f.engine.tick();
 assert.ok(f.engine.command(f.owner,parseDeviceMarker('[vib:off]'),500));
 assert.equal(f.engine.cancelQueuedPlayback({}),false);
 assert.equal(f.engine.cancelQueuedPlayback(f.owner),true);
 f.advance(1);f.beat(1);f.engine.tick();assert.deepEqual(f.engine.status.channels,[20,0,0,0]);
 f.beat(1,true,true);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.engine.halt(f.owner);f.beat(1);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.engine.close();
});

test('device protocol validates two channels, bounded amounts, fade/buzz durations and pattern roles',()=>{
 for(const tag of ['[vib:on:0.3]','[rot:on:0.3]','[vib:pattern:breathe]','[rot:pattern:slow]','[vib:buzz:0.6:3000]','[both:off]','[both:fade:0]'])assert.ok(parseDeviceMarker(tag),tag);
 for(const tag of ['[vib:on:Infinity]','[rot:on:2]','[vib:buzz:0.5:999999]','[rot:pattern:wave]','[vib:pattern:slow]','[both:on:0.4]','[rot:raw:a0]','[vib:unknown]'])assert.equal(parseDeviceMarker(tag),undefined,tag);
 assert.equal(parseDeviceMarker('[both:fade:0]')?.durationMs,10000);
 assert.equal(DeviceSettingsSchema.safeParse({vibrationChannel:1,rotationChannel:1}).success,false);
 assert.equal(DeviceCommandSchema.safeParse({type:'device',channel:'vib',operation:'on',intensity:NaN}).success,false);
 assert.ok(devicePrompt(true).includes('[rot:on:0.2]'));assert.ok(devicePrompt(false).includes('disabled'));
});

test('device markers stay out of display/TTS and survive every streaming split',async()=>{
 const raw='Start. [vib:on:0.3][rot:pattern:slow] Ready. [SFX:PAUSE_5][both:off] End.';
 const run=(parts:string[])=>{const stream=new TriggerSentenceChunker();return [...parts.flatMap(part=>stream.push(part)),...stream.flush()].flatMap(part=>scriptUnits(part));};
 const expected=run([raw]);for(let split=0;split<=raw.length;split++)assert.deepEqual(run([raw.slice(0,split),raw.slice(split)]),expected,`split ${split}`);
 assert.deepEqual(run([...raw]),expected);
 const display=new ScriptDisplayStream();assert.equal([...raw].map(char=>display.push(char)).join('')+display.flush(),'Start.  Ready.  End.');
 const original=globalThis.fetch;const inputs:string[]=[];try{globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));inputs.push(body.input);return new Response(JSON.stringify({audio:'AAAA',audio_format:'wav',text:body.input,timestamps:[],spoken_seconds:.2})+'\n');};
  const chunks=[];for await(const chunk of new Kokoro().speak(raw,'af_heart',1,AbortSignal.timeout(2000)))chunks.push(chunk);
  assert.ok(inputs.every(text=>!text.includes('[vib:')&&!text.includes('[rot:')&&!text.includes('[both:')));assert.equal(chunks[1].devices_at_word?.length,2);
  const before=inputs.length;for await(const chunk of new Kokoro().speak('[both:off]','af_heart',1,AbortSignal.timeout(2000)))assert.ok(chunk.control);assert.equal(inputs.length,before);
 }finally{globalThis.fetch=original;}
});

test('bounded patterns, timed buzz and fade stop exactly without restarting',()=>{
 for(const pattern of ['breathe','pulse','wave','strobe','constant','ramp_up','slow','steady'] as const){const state={level:.6,pattern,started:0};for(let t=0;t<20;t+=.03){const value=actuatorValue(state,t);assert.ok(value>=0&&value<=.6);}}
 const buzz=applyDeviceCommand(offState(),parseDeviceMarker('[vib:buzz:0.6:3000]')!,10);assert.equal(actuatorValue(buzz,12.9),.6);assert.equal(actuatorValue(buzz,13),0);
 const fade=applyDeviceCommand({level:.4,pattern:'constant',started:0},parseDeviceMarker('[both:fade:0]')!,10);assert.equal(actuatorValue(fade,15),.2);assert.equal(actuatorValue(fade,20),0);assert.equal(actuatorValue(fade,21),0);
});

test('UDP mapping keeps independent caps, zeros unused channels and rejects another owner',()=>{
 const f=fixture();f.arm({phaseDefaults:false,vibrationMax:.2,rotationMax:.25});assert.ok(f.command('[vib:on:1]'));assert.ok(f.command('[rot:on:1]'));f.engine.tick();assert.deepEqual(f.engine.status.channels,[20,25,0,0]);
 assert.equal(f.engine.command({},parseDeviceMarker('[vib:on:1]')),false);assert.equal(f.engine.configure({},{enabled:true}),false);
 assert.ok(f.packets.some(p=>p==='{"vibe":[20,25,0,0]}'));assert.equal(f.packets.some(p=>p.includes('rotate')),false);
 assert.ok(f.command('[rot:off]'));f.engine.tick();assert.deepEqual(f.engine.status.channels,[20,0,0,0]);
 assert.ok(f.command('[both:off]'));f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
});

test('missing bridge/device and unassigned rotation are ignored; connection does not revive old output',()=>{
 const f=fixture();assert.ok(f.engine.configure(f.owner,{enabled:true,phaseDefaults:false}));f.beat(0);assert.equal(f.command('[vib:on:0.3]'),false);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.arm({phaseDefaults:false,rotationChannel:0});assert.ok(f.command('[rot:on:0.3]'));f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 assert.ok(f.command('[vib:on:0.3]'));f.engine.tick();f.engine.bridgeStatus({connected:false});assert.deepEqual(f.engine.status.channels,[0,0,0,0]);f.advance(1);f.beat(1);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
});

test('pause, interrupt, owner disconnect and heartbeat timeout stop motors and queued rotation',()=>{
 const f=fixture();f.arm({phaseDefaults:false});f.command('[vib:on:0.3]');f.command('[rot:on:0.3]');f.engine.tick();f.beat(0,false,true);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.beat(1);f.command('[rot:on:0.3]');f.engine.halt(f.owner);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.command('[vib:on:0.3]');f.engine.tick();f.advance(2.1);f.engine.tick();assert.equal(f.engine.status.enabled,false);assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.arm();f.engine.release(f.owner);assert.equal(f.engine.status.enabled,false);assert.equal(f.packets.at(-1),'{"vibe":[0,0,0,0]}');
});

test('phase defaults, later deepening rotation, bounded random intervals and awakening fade',()=>{
 const f=fixture();f.arm({randomRotation:true});f.engine.tick();assert.equal(f.engine.status.channels[1],0);
 f.beat(250);f.engine.tick();assert.equal(f.engine.status.channels[1],0);f.beat(330);f.engine.tick();assert.equal(f.engine.status.channels[1],20);
 f.command('[rot:off]');f.engine.tick();assert.equal(f.engine.status.channels[1],0,'Manual off survives phase automation');
 f.beat(400);f.engine.tick();assert.deepEqual(f.engine.status.channels,[30,0,0,0]);f.beat(459);f.engine.tick();assert.equal(f.engine.status.channels[1],0);f.beat(460);f.engine.tick();assert.equal(f.engine.status.channels[1],30);
 f.beat(467.5);f.engine.tick();assert.equal(f.engine.status.channels[1],0);f.engine.halt(f.owner);f.beat(550);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.arm();f.beat(900);f.engine.tick();f.advance(10);f.beat(910);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
});

test('an explicit short channel test has its own deadline and cannot remain latched',()=>{
 const f=fixture();f.arm();f.beat(0,false);assert.ok(f.engine.testChannel(f.owner,2));f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,10,0,0]);f.advance(.5);f.beat(0,false);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);assert.equal(f.engine.testChannel({},1),false);
});


test('one-shot preview works disarmed, respects mapped cap and disarms without starting phase automation',()=>{
 const f=fixture();f.engine.bridgeStatus({connected:true});
 assert.ok(f.engine.preview(f.owner,{vibrationChannel:2,rotationChannel:1,vibrationMax:.26,rotationMax:.27,phaseDefaults:true,randomRotation:true},1,.3));
 f.beat(400);f.engine.tick();assert.deepEqual(f.engine.status.channels,[27,0,0,0]);
 assert.equal(f.engine.preview({},f.engine.settings,2),false);
 f.advance(.5);f.beat(401);f.engine.tick();assert.equal(f.engine.status.enabled,false);assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.advance(.1);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 assert.equal(f.engine.preview(f.owner,{},1,1),false);assert.equal(f.engine.preview(f.owner,{},1,NaN),false);
 f.engine.bridgeStatus({connected:false});assert.equal(f.engine.preview(f.owner,{},1),false);
});
