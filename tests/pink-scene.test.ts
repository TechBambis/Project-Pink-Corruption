// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pinkProgram,pinkLive} from '../packages/session-director/pink-scene';
import {EventRuntime,compileEvent} from '../packages/session-director/events/runtime';
import {presentationAt} from '../packages/session-director/events/presentation';
const voices=[['whole-one',58800],['heart-one',68400],['whole-two',78000],['voice-only',87600],['wipe',96000],['reanchor',115100],['sleep-blank',110000],['mantra',192000]].map(([id,at])=>({id:String(id),atMs:Number(at),durationMs:1200,windowMs:1500}));
test('Pink score preserves finite contrast, actual blank, cached mantra and ordinary closing',()=>{
 const {program,bindings}=pinkProgram(voices,pinkLive('Two original sentences.'));
 const runtime=new EventRuntime(program);
 assert.equal(program.durationMs,240000);
 assert.equal(program.events.filter(e=>e.type==='fractionation').length,2);
 const fraction=runtime.compiled.find(c=>c.event.id==='contrast-0');assert.equal(presentationAt(runtime.snapshot(70000),fraction,70000).canvas,0);assert.ok(presentationAt(runtime.snapshot(75600),fraction,75600).canvas>0);
 assert.ok(runtime.slots.find(s=>s.id==='contrast-1:speech:0')!.atMs-75000>=3000);
 const blank=runtime.snapshot(113000),shown=presentationAt(blank,runtime.compiled.find(e=>e.event.id===blank.eventId),113000);
 assert.equal(blank.label,'blank');assert.equal(blank.state.narrationState,'paused');assert.equal(shown.canvas,0);assert.equal(shown.motif,0);assert.ok(Object.values(shown.gains).every(g=>g===0));
 assert.ok(!runtime.slots.some(s=>s.atMs<115100&&s.endMs>112000));
 const repeats=runtime.slots.filter(s=>s.eventId==='pink-mantra');assert.equal(repeats.length,3);assert.equal(new Set(repeats.map(s=>s.payloadId)).size,1);assert.equal(bindings.filter(b=>b.sourceId==='mantra').length,1);
 assert.equal(runtime.snapshot(199000).state.visualState,'sparse');assert.equal(runtime.snapshot(205000).state.motifForm,'heart');
 assert.equal(runtime.snapshot(235000).state.ambientState,'silent');assert.equal(runtime.snapshot(240000).complete,true);
});
test('Presentation grammar is independent of voice segmentation, with a bounded peak recovery',()=>{
 const {program}=pinkProgram([...voices,{id:'entry',atMs:1000,durationMs:36000,windowMs:40000},{id:'peak',atMs:176000,durationMs:6000,windowMs:10000},{id:'soft-return',atMs:186000,durationMs:3000,windowMs:6000}]);
 const runtime=new EventRuntime(program);assert.equal(runtime.snapshot(5000).state.visualState,'sparse');assert.equal(runtime.snapshot(10000).state.visualState,'layered');assert.equal(runtime.snapshot(33000).state.density.visualDensity,.55);
 assert.equal(runtime.snapshot(179000).peak,true);assert.equal(runtime.snapshot(187000).state.visualState,'sparse');assert.equal(runtime.snapshot(187000).state.activeLayers.includes('center_text'),false);
 const slots=compileEvent(program.events.find(e=>e.id==='entry')!).speech;assert.equal(slots.length,1);assert.equal(slots[0].atMs,1000);
});
test('Prepared speech cannot overflow a finite mechanical window',()=>{assert.throws(()=>pinkProgram(voices.map(v=>v.id==='mantra'?{...v,durationMs:6001}:v)),/does not fit mantra/);});

test('opacity return cannot activate a visual layer that its engine state does not own',()=>{
 const {program}=pinkProgram(voices);const event=program.events.find(e=>e.id==='pink-mantra')!;
 event.mantra!.perLoop![1]={...event.mantra!.perLoop![1],visualState:'black',activeLayers:['main_voice']};event.visual=[{offsetMs:6000,durationMs:0,opacity:1}];const runtime=new EventRuntime(program),at=199000;
 assert.equal(presentationAt(runtime.snapshot(at),runtime.compiled.find(c=>c.event.id===event.id),at).canvas,0);
});
