// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {VoiceActivity,PlaybackInputGuard} from '../packages/speech/activity';
import {Microphone} from '../packages/speech/capture';

test('noise calibration, isolated clicks and short bursts do not start an utterance',()=>{
 for(const rate of [16000,44100,48000]){
  const gate=new VoiceActivity(),ms=1024/rate*1000;
  const feed=(rms:number,duration:number)=>Array.from({length:Math.ceil(duration/ms)},()=>gate.process(rms,ms));
  assert.ok(feed(.022,500).every(x=>!x.start));
  assert.ok(gate.threshold>.06);
  assert.ok(feed(.023,2000).every(x=>!x.start));
  assert.ok(feed(.25,60).every(x=>!x.start));feed(.022,100);
  assert.ok(feed(.1,100).every(x=>!x.start));feed(.022,800);
  assert.equal(gate.active,false);
 }
});

test('sustained speech starts once, soft endings survive hysteresis and silence ends it',()=>{
 const gate=new VoiceActivity();for(let i=0;i<25;i++)gate.process(.003,20);
 const starts=[];for(let i=0;i<20;i++)starts.push(gate.process(.06,20));
 assert.equal(starts.filter(x=>x.start).length,1);
 assert.ok(gate.process(.024,20).voiced,'A softer ending remains above the sustain threshold');
 for(let i=0;i<30;i++)assert.equal(gate.process(.003,20).end,false);
 const ends=[];for(let i=0;i<10;i++)ends.push(gate.process(.003,20));
 assert.equal(ends.filter(x=>x.end&&x.valid).length,1);
 assert.equal(gate.active,false);
});

test('playback protection rejects the acoustic tail; headphone mode and reset release it',()=>{
 const guard=new PlaybackInputGuard();assert.equal(guard.blocked(false,0),false);
 assert.equal(guard.blocked(true,100),true);assert.equal(guard.blocked(false,499),true);
 assert.equal(guard.blocked(false,500),false);
 guard.blocked(true,600);assert.equal(guard.blocked(true,601,false),false);
 assert.equal(guard.blocked(false,602),false);
 guard.blocked(true,700);guard.reset();assert.equal(guard.blocked(false,701),false);
});

test('capture discards playback and resets neural state before accepting headphone input',()=>{
 let playback=true,starts=0,resets=0;const frames:Float32Array[]=[];
 const mic=new Microphone(()=>starts++,()=>{},()=>{},()=>playback);
 const capture=mic as unknown as {detector:{push(data:Float32Array,rate:number):void;reset():void;configure():void};processFrame(data:Float32Array,rate:number):void};
 capture.detector={configure(){},push(data){frames.push(data);},reset(){resets++;}};mic.vad=true;
 for(let i=0;i<100;i++)capture.processFrame(new Float32Array(320).fill(.4),16000);
 assert.equal(starts,0);assert.equal(frames.length,0);assert.equal(mic.blocked,true);assert.equal(resets,100);
 playback=false;mic.configure('headphones','balanced');capture.processFrame(new Float32Array(320).fill(.02),16000);
 assert.equal(frames.length,1);assert.equal(frames[0][0],Math.fround(.02));assert.equal(starts,0,'Energy alone cannot interrupt');
 mic.vad=false;capture.processFrame(new Float32Array(320).fill(.4),16000);assert.equal(frames.length,1);
});
