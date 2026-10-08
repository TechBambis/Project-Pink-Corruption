// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceController,type DeviceTransport} from '../packages/devices/controller';
import {DeviceCommandSchema,DeviceSettingsSchema,parseDeviceMarker,devicePrompt} from '../packages/devices/commands';
import {actuatorValue,applyDeviceCommand,offState} from '../packages/devices/patterns';
import {devicePlaybackPlan} from '../packages/devices/playback';
import {ScriptDisplayStream,scriptUnits} from '../packages/speech/script';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {Kokoro} from '../packages/speech/tts';

function fixture(){let time=100;const packets:string[]=[];const transport:DeviceTransport={send:packet=>packets.push(packet),close(){}};const engine=new DeviceController(transport,()=>time,()=>.5,false),owner={};
 const beat=(elapsed:number,running=true,paused=false)=>engine.heartbeat(owner,{running,paused,elapsed,duration:1000});
 const advance=(seconds:number)=>{time+=seconds;engine.bridgeStatus({connected:true,device:'fixture'});};
 const withoutBridge=(seconds:number)=>{time+=seconds;};
 const arm=(settings:Record<string,unknown>={})=>{engine.bridgeStatus({connected:true});assert.ok(engine.configure(owner,{enabled:true,vibrationChannel:1,rotationChannel:2,...settings}));beat(0);};
 const command=(marker:string)=>engine.command(owner,parseDeviceMarker(marker));
 return {engine,owner,packets,beat,advance,withoutBridge,arm,command};
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
 const f=fixture();f.arm({randomRotation:true,transitionMs:0});f.engine.tick();assert.equal(f.engine.status.channels[1],0);
 f.beat(250);f.engine.tick();assert.equal(f.engine.status.channels[1],0);f.beat(330);f.engine.tick();assert.equal(f.engine.status.channels[1],20);
 f.command('[rot:off]');f.engine.tick();assert.equal(f.engine.status.channels[1],0,'Manual off survives phase automation');
 f.beat(400);f.engine.tick();assert.deepEqual(f.engine.status.channels,[30,0,0,0]);f.beat(459);f.engine.tick();assert.equal(f.engine.status.channels[1],0);f.beat(460);f.engine.tick();assert.equal(f.engine.status.channels[1],30);
 f.beat(467.5);f.engine.tick();assert.equal(f.engine.status.channels[1],0);f.engine.halt(f.owner);f.beat(550);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.arm();f.beat(900);f.engine.tick();f.advance(10);f.beat(910);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
});

test('a temporary accent returns to the advancing wave, and explicit off cancels queued accents',()=>{
 const f=fixture();f.arm({phaseDefaults:false,vibrationMax:.6});f.command('[vib:on:0.25]');f.command('[vib:pattern:wave]');
 f.advance(.2);f.beat(.2);f.command('[vib:buzz:0.6:300]');f.engine.tick();assert.equal(f.engine.status.channels[0],60);
 f.advance(.3);f.beat(.5);f.engine.tick();
 assert.equal(f.engine.status.channels[0],Math.round(actuatorValue({level:.25,pattern:'wave',started:100},100.5)*100));
 assert.ok(f.engine.command(f.owner,parseDeviceMarker('[vib:buzz:0.6:300]'),100));f.command('[vib:off]');
 f.advance(.1);f.beat(.6);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
});

test('pause discards a transient accent and restores only the baseline; halt cannot revive it',()=>{
 const f=fixture();f.arm({phaseDefaults:false});f.command('[vib:on:0.3]');f.command('[vib:buzz:0.1:1000]');f.engine.tick();assert.equal(f.engine.status.channels[0],10);
 f.beat(0,true,true);f.engine.tick();assert.equal(f.engine.status.channels[0],0);
 f.advance(.2);f.beat(0);f.engine.tick();assert.equal(f.engine.status.channels[0],30);
 f.command('[vib:buzz:0.1:1000]');f.engine.halt(f.owner);f.advance(.2);f.beat(.2);f.engine.tick();assert.equal(f.engine.status.channels[0],0);
});

test('phase changes blend from current capped output; awakening never starts an inactive motor',()=>{
 const f=fixture();f.arm({vibrationMax:.2});f.command('[vib:on:1]');f.command('[rot:off]');f.engine.tick();assert.deepEqual(f.engine.status.channels,[20,0,0,0]);
 f.beat(900);f.engine.tick();assert.deepEqual(f.engine.status.channels,[20,0,0,0]);
 f.advance(5);f.beat(905);f.engine.tick();assert.deepEqual(f.engine.status.channels,[10,0,0,0]);
 f.advance(5);f.beat(910);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 const blend=fixture();blend.arm();blend.command('[vib:on:0.2]');blend.beat(400);blend.engine.tick();assert.equal(blend.engine.status.channels[0],20);
 blend.advance(.125);blend.beat(400.125);blend.engine.tick();assert.equal(blend.engine.status.channels[0],25);
 blend.advance(.125);blend.beat(400.25);blend.engine.tick();assert.equal(blend.engine.status.channels[0],30);
});

test('live limit updates preserve the running pattern and do not resume a halted controller',()=>{
 const f=fixture();f.arm({phaseDefaults:false});f.command('[vib:on:0.3]');
 assert.ok(f.engine.configure(f.owner,{...f.engine.settings,vibrationMax:.2}));f.engine.tick();assert.equal(f.engine.status.channels[0],20);
 f.engine.halt(f.owner);assert.ok(f.engine.configure(f.owner,{...f.engine.settings,vibrationMax:.3}));f.engine.tick();assert.equal(f.engine.status.channels[0],0);assert.equal(f.engine.status.automationPaused,true);
 assert.ok(f.engine.configure(f.owner,{...f.engine.settings,phaseDefaults:true},true));f.engine.tick();f.advance(.25);f.beat(.25);f.engine.tick();assert.ok(f.engine.status.channels[0]>0);
});

test('stale motion cues are discarded while delayed stops still execute; completion disarms',()=>{
 const f=fixture();f.arm({phaseDefaults:false});f.command('[vib:on:0.2]');
 f.engine.command(f.owner,parseDeviceMarker('[vib:buzz:0.3:500]'),100);f.advance(.4);f.beat(.4);f.engine.tick();assert.equal(f.engine.status.channels[0],20);
 f.engine.command(f.owner,parseDeviceMarker('[both:off]'),100);f.advance(.4);f.beat(.8);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
 f.command('[vib:on:0.2]');f.engine.command(f.owner,parseDeviceMarker('[vib:on:0.3]'),1000);f.beat(1000);f.engine.tick();assert.equal(f.engine.status.enabled,false);assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
});

test('losing bridge status cancels future motion even when current output is zero',()=>{
 const f=fixture();f.arm({phaseDefaults:false});f.engine.command(f.owner,parseDeviceMarker('[vib:on:0.3]'),5000);
 f.withoutBridge(2.1);f.beat(2.1);f.engine.tick();assert.equal(f.engine.status.automationPaused,true);
 f.advance(2.9);f.beat(5);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
});

test('playback calibration uses independent motor leads, preserves global stop and explicit metadata',()=>{
 const settings=DeviceSettingsSchema.parse({vibrationLeadMs:120,rotationLeadMs:200,accentIntensity:.23,accentDurationMs:450});
 const fade=parseDeviceMarker('[both:fade:0]')!, plan=devicePlaybackPlan(fade,500,settings);
 assert.deepEqual(plan.map(p=>[p.command.channel,p.delayMs]),[['vib',380],['rot',300]]);
 assert.deepEqual(devicePlaybackPlan(parseDeviceMarker('[both:off]')!,500,settings).map(p=>[p.command.channel,p.delayMs]),[['both',500]]);
 const buzz=parseDeviceMarker('[vib:buzz:0.1:150]')!;
 assert.deepEqual(devicePlaybackPlan(buzz,100,settings,'speech'),[{command:{...buzz,intensity:.23,durationMs:450},delayMs:0}]);
 assert.deepEqual(devicePlaybackPlan(buzz,500,settings),[{command:buzz,delayMs:380}]);
 assert.deepEqual(devicePlaybackPlan(buzz,500,{...settings,speechAccents:false},'speech'),[]);
 assert.deepEqual(devicePlaybackPlan(fade,500,{...settings,rotationChannel:0}).map(p=>p.command.channel),['vib']);
 for(const field of ['vibrationLeadMs','rotationLeadMs','transitionMs','accentDurationMs'])assert.equal(DeviceSettingsSchema.safeParse({[field]:-1}).success,false);
});

test('an explicit short channel test has its own deadline and cannot remain latched',()=>{
 const f=fixture();f.arm();f.beat(0,false);assert.ok(f.engine.testChannel(f.owner,2));f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,10,0,0]);f.advance(.5);f.beat(0,false);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);assert.equal(f.engine.testChannel({},1),false);
});

test('lowering a limit during a channel test immediately caps that in-flight test',()=>{
 const f=fixture();f.arm({phaseDefaults:false});f.engine.testChannel(f.owner,1,.3);f.engine.tick();assert.equal(f.engine.status.channels[0],30);
 f.engine.configure(f.owner,{...f.engine.settings,vibrationMax:.1});f.engine.tick();assert.equal(f.engine.status.channels[0],10);
 f.advance(.5);f.beat(.5);f.engine.tick();assert.deepEqual(f.engine.status.channels,[0,0,0,0]);
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
