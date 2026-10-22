// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {heartProjection} from '../packages/visuals/heart';
import {sceneSounds} from '../packages/audio/scene-sounds';
import {ListenerResponseInput} from '../apps/web/src/concurrent-input';
import {EventSchema,ProgramSchema} from '../packages/session-director/events/contract';
import {pinkProgram,pinkState} from '../packages/session-director/pink-scene';
import {EventRuntime} from '../packages/session-director/events/runtime';
const voices=[['whole-one',58800],['heart-one',68400],['whole-two',78000],['voice-only',87600],['wipe',96000],['sleep-blank',110000],['reanchor',115100],['mantra',192000]].map(([id,at])=>({id:String(id),atMs:Number(at),durationMs:1200,windowMs:1500}));
test('heart profile keeps volume at its narrow turn and reduced motion holds the broad face',()=>{
 const width=(t:number,reduced=false)=>{const xs=heartProjection(t,5660,reduced).flatMap(f=>f.points.map(p=>p[0]));return Math.max(...xs)-Math.min(...xs);};
 assert.ok(width(1415)>9);assert.ok(width(1415)<width(0)*.6);assert.equal(width(0,true),width(1415,true));
 for(const t of [0,1415,2830,4245])assert.ok(heartProjection(t).every(f=>f.points.every(p=>p.every(Number.isFinite))));
});
test('sound snapshot respects the selected recording, independent faders and sound opt-outs',()=>{
 const prefs={'bus-effects':'0.28','trigger-wiper-variant':'wiper_alt','trigger-wiper-seconds':'10','trigger-snap':false,'trigger-wiper-db':'-6'};
 const actual=sceneSounds(prefs);assert.equal(actual.variants.wiper,'wiper_alt');assert.equal(actual.effectsLevel,.28);assert.equal(actual.sequence.wiperSeconds,10);assert.equal(actual.sequence.snap,false);assert.equal(actual.gains.wiper,-6);assert.equal(sceneSounds({'trigger-sound':false}).enabled,false);assert.equal(prefs['trigger-wiper-db'],'-6');
});
test('response utterances remain reserved through their end; ordinary subsequent speech is admitted',()=>{
 const input=new ListenerResponseInput();let interrupts=0,recognition=0,requests=0;
 const start=(reserved:boolean)=>{if(!input.begin(reserved)){interrupts++;recognition++;}};
 const end=()=>{if(!input.end())requests++;};
 start(true);assert.equal(input.active,true);end();assert.deepEqual([interrupts,recognition,requests],[0,0,0]);
 start(false);end();assert.deepEqual([interrupts,recognition,requests],[1,1,1]);
 start(true);input.reset();assert.equal(input.active,false);
});
test('black preparation, true blank and spoken reanchor remain separate; response windows are bounded',()=>{
 const {program}=pinkProgram(voices),runtime=new EventRuntime(program);
 assert.equal(runtime.snapshot(110500).state.visualState,'black');assert.equal(runtime.snapshot(110500).state.narrationState,'speaking');assert.equal(runtime.snapshot(113000).state.narrationState,'paused');assert.equal(runtime.slots.find(s=>s.speech.mode==='reanchor')!.atMs,115100);
 assert.throws(()=>ProgramSchema.parse({...program,responseWindows:[{fromMs:100,toMs:241000}]}));
 const event=program.events.find(e=>e.type==='mindwipe')!;assert.throws(()=>EventSchema.parse({...event,speech:{...event.speech,requiredTrigger:'SNAP',triggerAtMs:10,triggerCooldownMs:700,voiceTrack:{speaker:'bambi',gainDb:-6,pan:0,reverbMs:200,reverbDb:-18}}}));
});

test('convergence gathers its surroundings, preserves the heart and releases after the peak',()=>{
 const early=pinkState(20000,true),gather=pinkState(140000,true),build=pinkState(170000,true),peak=pinkState(179000,true),release=pinkState(188000,true);
 assert.equal(early.scene,'Soft Pink');assert.equal(gather.scene,'Deep Tunnel');
 assert.equal(gather.motifMotion?.surround,'gears');assert.equal(build.motifMotion?.surround,'gears');assert.ok(build.density.visualDensity>gather.density.visualDensity);assert.ok(peak.density.visualDensity>build.density.visualDensity);
 assert.equal(peak.motifId,early.motifId);assert.equal(release.motifMotion?.surround,undefined);assert.equal(release.visualState,'sparse');
});
