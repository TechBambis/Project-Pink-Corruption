// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSpeechPlan,PerformanceScoreSchema,type PerformanceScore} from '../packages/session-director/performance-score';
import {referenceProgram} from '../packages/session-director/reference-scene';
function wav(ms=1000){const bytes=new Uint8Array(44+ms*48),v=new DataView(bytes.buffer);for(const [at,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)bytes.set(new TextEncoder().encode(s),at);v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,bytes.length-44,true);return bytes;}
const score:PerformanceScore={version:1,id:'quiet',execution:'prepared-guided',windowMs:4000,leadingPauseMs:300,endingReserveMs:500,phrases:[{id:'p',text:'A quiet thought.',pauseAfterMs:1000,important:true,beats:[{beatId:'contrast-begins',afterWord:3}]}]};
const measured=[{id:'p',bytes:wav(),words:[{word:'quiet',atMs:200,endMs:500},{word:'thought',atMs:600,endMs:900}]}];
test('complete thought is one synthesis arc; measured pause anchors compile onto existing events',()=>{
 const plan=compileSpeechPlan(score,measured);assert.equal(plan.arcs.length,1);assert.equal(plan.durationMs,2800);assert.deepEqual(plan.beats,[{beatId:'contrast-begins',atMs:1450,phraseId:'p'}]);
 const program=referenceProgram([{atMs:96000,plan}]);assert.equal(program.durationMs,240000);
 assert.ok(program.events.some(e=>e.atMs===97450&&e.type==='silence'&&e.state.scene==='Minimal Dark'));
 assert.ok(program.events.every(e=>e.haptics.length===0));
});
test('unavailable or ambiguous anchors, malformed timing and measured overflow fail closed',()=>{
 assert.throws(()=>compileSpeechPlan({...score,windowMs:2500},measured),/overflow/);
 assert.throws(()=>compileSpeechPlan(score,[{...measured[0],words:[{word:'quiet',atMs:200,endMs:500}]}]),/unambiguous/);
 assert.throws(()=>compileSpeechPlan(score,[{...measured[0],words:[{word:'quiet',atMs:200,endMs:1100},{word:'thought',atMs:600,endMs:900}]}]),/alignment/);
 assert.throws(()=>compileSpeechPlan({...score,phrases:[{...score.phrases[0],pauseAfterMs:0}]},measured),/pause/);
 assert.throws(()=>compileSpeechPlan({...score,phrases:[{...score.phrases[0],beats:[{beatId:'contrast-begins',afterWord:2}]}]},measured),/complete thought/);
 assert.throws(()=>PerformanceScoreSchema.parse({...score,phrases:[{...score.phrases[0],text:'[vib:on] Arbitrary control.'}]}));
 assert.throws(()=>PerformanceScoreSchema.parse({...score,phrases:[{...score.phrases[0],beats:[{beatId:'device',afterWord:1}]}]}));
 assert.throws(()=>compileSpeechPlan(score,[...measured,...measured]),/Incomplete/);
});
