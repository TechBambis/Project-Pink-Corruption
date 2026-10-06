// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine} from '../packages/audio';
import {parseDeviceMarker,type DeviceCommand,type DeviceCueOrigin} from '../packages/devices/commands';
import {triggerSequenceDefaults} from '../config/trigger-sequence';

function fixture(){
 const buffer=(channels:number,length:number,rate:number)=>{const data=Array.from({length:channels},()=>new Float32Array(length).fill(.08));return {numberOfChannels:channels,length,sampleRate:rate,duration:length/rate,getChannelData:(ch:number)=>data[ch]};};
 const cues:{command:DeviceCommand;time?:number;origin?:DeviceCueOrigin}[]=[],starts:number[]=[];
 const voiceEchoes={schedule:(_buffer:unknown,time:number,duration:number)=>time+duration};
 const engine=Object.assign(Object.create(AudioEngine.prototype),{
  context:{currentTime:10,sampleRate:1000,decodeAudioData:async()=>buffer(1,800,1000),createBuffer:buffer,createBufferSource:()=>({connect(){},disconnect(){},start(time:number){starts.push(time);}})},
  nodes:{main_voice:{}},voiceEpoch:0,voicesEnd:0,voiceSources:new Set(),foreground:new Map(),triggerEvents:[],
  designSettings:{enabled:false},sequenceSettings:{...triggerSequenceDefaults,snap:false,moan:false,effects:false,plainPauseMs:0,effectPauseMs:0},
  voiceEchoes,tickEnabled:false,tickEngine:{active:false,setVoiceLevel(){}},
  speechDucker:{schedule(){},forget(){}},onDeviceCue:(command:DeviceCommand,time?:number,origin?:DeviceCueOrigin)=>cues.push({command,time,origin}),
 }) as AudioEngine;
 return {engine,cues,starts,voiceEchoes};
}

test('ordinary voice playback aligns its single default accent to the measured word, after pre-pause',async()=>{
 const f=fixture();let wordTime=0;
 await f.engine.playVoice(new ArrayBuffer(0),(_start,_duration,word)=>{wordTime=word;},()=>{},{trigger:'test cue',spokenSeconds:.8,prePauseMs:250},{wordStart:.2});
 assert.equal(f.starts.length,1);assert.equal(f.cues.length,1);assert.equal(f.cues[0].time,wordTime);assert.ok(Math.abs(wordTime-10.485)<.000001);assert.equal(f.cues[0].origin,'speech');
});

test('explicit word metadata takes precedence; disabled sequences and spoken one-shots add no accent',async()=>{
 const explicit=parseDeviceMarker('[vib:buzz:0.2:400]')!,f=fixture();
 await f.engine.playVoice(new ArrayBuffer(0),()=>{},()=>{},{trigger:'test cue',spokenSeconds:.8},{wordStart:.2,devicesAtWord:[explicit]});
 assert.deepEqual(f.cues.map(c=>c.command),[explicit]);assert.equal(f.cues[0].origin,undefined);
 for(const trigger of [{trigger:'test cue',sequenceEnabled:false},{trigger:'SNAP'}]){
  const silent=fixture();await silent.engine.playVoice(new ArrayBuffer(0),()=>{},()=>{},{...trigger,spokenSeconds:.8},{wordStart:.2});assert.deepEqual(silent.cues,[]);
 }
});

test('cue-only script schedules device markers ahead while preserving explicit pause order',async()=>{
 const f=fixture(),on=parseDeviceMarker('[vib:on:0.2]')!,off=parseDeviceMarker('[both:off]')!;
 await f.engine.playScriptCues([on,'PAUSE_5',off],()=>{});
 assert.deepEqual(f.cues.map(c=>c.command),[on,off]);assert.ok(Math.abs(f.cues[0].time!-10.035)<.000001);assert.equal(f.cues[1].time!-f.cues[0].time!,5);
 assert.equal(f.starts.length,1,'Device execution does not depend on an audio onended callback');
});
test('plain breathing instructions never schedule extra voice copies without marker metadata',async()=>{
 for(const text of ['*Breathe in.*','Breathe out slowly.','Inhale for me.','Exhale again.','Rest here.']){
  const f=fixture();let echoes=0;
  f.voiceEchoes.schedule=(_buffer,time,duration)=>{echoes++;return time+duration;};
  await f.engine.playVoice(new ArrayBuffer(0),()=>{},()=>{},undefined,{text,phase:'induction',conversation:true,spokenSeconds:.8});
  assert.equal(f.starts.length,1);assert.equal(echoes,text==='Rest here.'?1:0);
 }
});
