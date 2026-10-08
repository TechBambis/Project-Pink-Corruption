// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {TimelineScheduler,presentationEventLateness} from '../packages/timeline';
import {RuntimeLoop,type RuntimeLoopHost} from '../packages/timeline/runtime-loop';
import {SessionDirector} from '../packages/session-director';

test('stalled playback discards old pulses and expired words while restoring current captions and state',()=>{
 let wall=0;const clock=new TimelineScheduler(()=>wall,presentationEventLateness);clock.start();
 clock.schedule({id:'expired-caption',time:1,type:'caption',duration:2});
 clock.schedule({id:'expired-word',time:2,type:'word',duration:.4});
 clock.schedule({id:'old-pulse',time:3,type:'spoken-pink'});
 clock.schedule({id:'old-trigger',time:4,type:'trigger-cue'});
 clock.schedule({id:'scene',time:5,type:'scene'});
 clock.schedule({id:'accounting',time:5,type:'voice-start'});
 clock.schedule({id:'current-caption',time:8,type:'voice-caption',duration:4});
 clock.schedule({id:'current-word',time:9.5,type:'word',duration:1});
 clock.schedule({id:'fresh-pulse',time:9.9,type:'spoken-pink'});
 wall=10;
 assert.deepEqual(clock.tick().map(e=>e.id),['scene','accounting','current-caption','current-word','fresh-pulse']);
 assert.deepEqual(clock.tick(),[]);
 clock.seek(1);assert.deepEqual(clock.tick().map(e=>e.id),['expired-caption']);
});

test('pause, out-of-order insertion and scope replacement keep each pending event deliverable once',()=>{
 let wall=0;const clock=new TimelineScheduler(()=>wall);clock.start();
 clock.schedule({id:'reused',time:1,type:'caption',scope:'media'});
 clock.schedule({id:'future',time:4,type:'word',scope:'speech'});
 wall=1;assert.equal(clock.tick()[0].id,'reused');clock.pause();wall=100;assert.deepEqual(clock.tick(),[]);
 clock.clearScope('media');clock.schedule({id:'reused',time:2,type:'caption',scope:'media'});
 clock.schedule({id:'inserted',time:1.5,type:'caption'});clock.start();wall=102;
 assert.deepEqual(clock.tick().map(e=>e.id),['inserted','reused']);
 clock.clear('caption');wall=103;assert.deepEqual(clock.tick().map(e=>e.id),['future']);
 clock.clear();clock.schedule({id:'future',time:4,type:'word'});assert.equal(clock.tick()[0].id,'future');
 assert.throws(()=>clock.seek(NaN));assert.throws(()=>clock.schedule({id:'bad',type:'word',time:5,duration:Infinity}));
});

test('large authored timelines keep stable ordering through seeking and late insertion',()=>{
 let wall=0;const clock=new TimelineScheduler(()=>wall);clock.start();
 for(let i=0;i<10000;i++)clock.schedule({id:String(i),time:i/10,type:'scene'});
 wall=800;assert.equal(clock.tick().length,8001);assert.deepEqual(clock.tick(),[]);
 clock.schedule({id:'new-past',time:799,type:'scene'});assert.deepEqual(clock.tick().map(e=>e.id),['new-past']);
 clock.seek(500);assert.deepEqual(clock.tick().map(e=>e.id),['5000']);
 wall+=.2;assert.deepEqual(clock.tick().map(e=>e.id),['5001','5002']);
});

test('hidden and stalled frames still advance transport, finish sessions and never render on timer ticks',()=>{
 let wall=0,hidden=false,frame:((time:number)=>void)|undefined,timer:(()=>void)|undefined,renders=0,controls=0,cancelled=0;
 const clock=new TimelineScheduler(()=>wall/1000),director=new SessionDirector(clock);director.duration=1;director.ready();director.start();
 const host:RuntimeLoopHost={now:()=>wall,hidden:()=>hidden,requestFrame:callback=>{frame=callback;return 1;},cancelFrame:()=>{cancelled++;frame=undefined;},setTimer:callback=>{timer=callback;return 2;},clearTimer:()=>{timer=undefined;}};
 const loop=new RuntimeLoop(()=>{controls++;director.update();},()=>renders++,host);
 loop.start();loop.start();frame!(0);assert.equal(renders,1);assert.equal(controls,1);
 wall=50;timer!();assert.equal(controls,1);
 wall=200;timer!();assert.equal(controls,2);assert.equal(renders,1);
 hidden=true;wall=1200;timer!();assert.equal(director.state,'FINISHED');assert.equal(clock.running,false);assert.equal(renders,1);
 frame!(wall);assert.equal(renders,1);
 loop.stop();assert.equal(cancelled,1);assert.equal(timer,undefined);
 hidden=false;loop.start();frame!(wall);assert.equal(renders,2);loop.stop();
});
