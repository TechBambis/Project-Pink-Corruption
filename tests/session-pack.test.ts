// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {newSessionPack,verifySessionPack,assetHash,packTimeline,SessionPackSchema} from '../packages/session-director/pack';
import {toWav} from '../packages/speech/capture';
import {SpeechTurns,unfinishedPhrase} from '../packages/speech/turn';
import {ReplyTraces} from '../packages/ai/trace';
import {PresentationGovernor} from '../packages/hardware/governor';

test('portable sessions validate audio hashes and preserve caption/action timing',async()=>{
 const bytes=new Uint8Array(await toWav(new Float32Array(16000),16000).arrayBuffer()),id=crypto.randomUUID(),pack=newSessionPack();
 pack.assets.push({id,name:'Quiet.wav',mime:'audio/wav',sha256:await assetHash(bytes),data:Buffer.from(bytes).toString('base64'),attribution:'Test fixture'});
 pack.cues.push({id:crypto.randomUUID(),time:2,type:'speech',text:'A quiet moment.',duration:1,assetId:id},{id:crypto.randomUUID(),time:1,type:'action',action:{type:'scene',scene:'Soft Pink'}});
 assert.deepEqual(await verifySessionPack(JSON.parse(JSON.stringify(pack))),pack);assert.equal(packTimeline(pack)[0].time,1);
 const changed=structuredClone(pack);changed.assets[0].sha256='0'.repeat(64);await assert.rejects(()=>verifySessionPack(changed),/changed/);
 const invalid=structuredClone(pack);invalid.cues.push({id:crypto.randomUUID(),type:'speech',time:2.5,duration:1,text:'Overlap',assetId:id});assert.equal(SessionPackSchema.safeParse(invalid).success,false);
 const missing=structuredClone(pack);missing.assets=[];assert.equal(SessionPackSchema.safeParse(missing).success,false);
 assert.equal(SessionPackSchema.safeParse({...newSessionPack(),devices:{enabled:true}}).success,false);
 const executable={...newSessionPack(),cues:[{id:crypto.randomUUID(),time:0,type:'action',action:{type:'shell',command:'anything'}}]};assert.equal(SessionPackSchema.safeParse(executable).success,false);
});

test('unfinished phrases merge before a reply and cancellation never commits a stale turn',()=>{
 const received:{text:string;endedAt:number}[]=[],turns=new SpeechTurns(turn=>received.push(turn));
 assert.equal(unfinishedPhrase('I wanted to ask because'),true);assert.equal(unfinishedPhrase('Could you slow down?'),false);
 turns.receive('I wanted to ask because',10);assert.equal(turns.waiting,true);assert.equal(received.length,0);turns.resume();turns.receive('the music is loud.',20);
 assert.deepEqual(received,[{text:'I wanted to ask because the music is loud.',endedAt:10}]);
 turns.receive('and',30);turns.clear();turns.flush();assert.equal(received.length,1);
 turns.receive('because',40,false);assert.equal(received.length,2);turns.clear();
});

test('reply traces use one monotonic clock and record each stage once without private text',()=>{
 let now=100;const traces=new ReplyTraces(()=>now);traces.begin('job','cloud','model',{speechEndToRequestMs:700,sttMs:200});now=300;traces.mark('job','first-token');now=400;traces.mark('job','first-token');traces.finish('job','interrupted');
 assert.equal(traces.snapshot()[0].stages['first-token'],200);assert.equal(traces.snapshot()[0].status,'interrupted');assert.equal(traces.snapshot()[0].stages.interrupted,300);
 for(let i=0;i<210;i++)traces.begin(String(i),'local','model');assert.equal(traces.snapshot().length,200);
});

test('reply timing aggregates are bounded per stage and snapshots cannot change stored measurements',()=>{
 const traces=new ReplyTraces(()=>100);traces.begin('job','local','model');
 traces.measure('job','tokenization',12);traces.measure('job','tokenization',8);
 for(const value of [-1,NaN,Infinity])traces.measure('job','tokenization',value);
 traces.measure('missing','tokenization',50);
 const snapshot=traces.snapshot();assert.deepEqual(snapshot[0].timings.tokenization,{count:2,totalMs:20,maxMs:12});
 snapshot[0].timings.tokenization.totalMs=999;assert.equal(traces.snapshot()[0].timings.tokenization.totalMs,20);
});

test('scene diagnostics retain the failed stage and a bounded reason',()=>{
 let now=0;const traces=new ReplyTraces(()=>now);traces.begin('scene','local','fixture');
 now=50;traces.mark('scene','context-ready');now=100;traces.fail('scene','Preparation deadline exceeded.');
 const trace=traces.snapshot()[0];assert.equal(trace.status,'error');assert.equal(trace.stages['context-ready'],50);assert.equal(trace.stages.error,100);assert.equal(trace.error,'Preparation deadline exceeded.');
 traces.fail('scene','x'.repeat(3000));assert.equal(traces.snapshot()[0].error!.length,2000);
});

test('presentation pressure has hysteresis and does not trigger on one isolated frame',()=>{
 const governor=new PresentationGovernor();assert.equal(governor.observe(90,100,true),false);assert.equal(governor.observe(90,200,true),false);assert.equal(governor.observe(90,300,true),true);assert.equal(governor.observe(16,400,true),true);assert.equal(governor.observe(16,6000,true),false);
});
