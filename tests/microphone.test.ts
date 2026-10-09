// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PlaybackInputGuard} from '../packages/speech/activity';
import {Microphone} from '../packages/speech/capture';

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
