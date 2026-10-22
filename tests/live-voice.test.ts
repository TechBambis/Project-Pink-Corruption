// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceSentenceChunker} from '../packages/speech/dual-voice';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';
import {SpeechRenderAhead} from '../packages/speech/renderer-queue';
import {ReplyTraces} from '../packages/ai/trace';

const parse=(parts:string[],low=true)=>{const chunker=new VoiceSentenceChunker(['KEY PHRASE'],false,true,()=>low);return [...parts.flatMap(p=>chunker.push(p)),...chunker.flush()];};
test('first complete clause is released while a later thought is still generating',()=>{
 const chunker=new VoiceSentenceChunker([],false,true);
 assert.deepEqual(chunker.push('I understand what you need, '),['I understand what you need,']);
 assert.deepEqual(chunker.push('and I will explain the reasoning'),[]);
 assert.deepEqual(chunker.flush(),['and I will explain the reasoning']);
});
test('healthy reserve keeps a larger later prosody unit; low reserve uses a safe clause',()=>{
 const prefix='The first thought is ready. ',later='I understand what you need, and I can explain it. ';
 assert.deepEqual(parse([prefix,later],false),['The first thought is ready.','I understand what you need, and I can explain it.']);
 assert.deepEqual(parse([prefix,later],true),['The first thought is ready.','I understand what you need,','and I can explain it.']);
});
test('numbers, abbreviations, quotes, markup, controls and trigger names survive every token split',()=>{
 const texts=[
  'Dr. Smith knows the U.S. rate is 3.14 percent. Next thought. ',
  'The amount is $1,234.56 today, and I can explain the reason. ',
  'I know the phrase is KEY PHRASE, and I can explain it. ',
  "I understand 'what you need, and why it matters.' Next thought. ",
  'I understand "what you need, and why it matters." Next thought. ',
  '**I understand what you need, and I can explain it.** Next thought. ',
  'I know `version 3.14, really` is useful. Next thought. ',
  'I know what you need [pause:medium] and I can help. Next thought. ',
  'When you know what you need, I can help you choose. ',
 ];
 for(const text of texts){
  const expected=parse([text]);
  for(let at=0;at<=text.length;at++)assert.deepEqual(parse([text.slice(0,at),text.slice(at)]),expected,`${text} split ${at}`);
  assert.deepEqual(parse([...text]),expected,text);
  assert.equal(expected.join(' '),text.trim());
  assert.ok(expected.every(p=>!p.includes('[')||p.includes('[pause:medium]')));
 }
 assert.deepEqual(parse([...texts[0]]),['Dr. Smith knows the U.S. rate is 3.14 percent.','Next thought.']);
 assert.deepEqual(parse([...texts.at(-1)!]),[texts.at(-1)!.trim()]);
});
test('no safe boundary means wait; fragmented control and numeric suffix are never pronounced early',()=>{
 const chunker=new VoiceSentenceChunker([],false,true);
 assert.deepEqual(chunker.push('The amount is $1,'),[]);
 assert.deepEqual(chunker.push('234.'),[]);
 assert.deepEqual(chunker.push('56 [pau'),[]);
 assert.deepEqual(chunker.push('se:medium] and I can help. '),['The amount is $1,234.56 [pause:medium] and I can help.']);
 const unsplit=new TriggerSentenceChunker([],true);
 assert.deepEqual(unsplit.push('A long opening without a completed clause '.repeat(20)),[]);
});
test('complete sentences stream inside an open quoted or emphasized paragraph without dropping words',()=>{
 for(const opening of ['"','*','**']){
  const parser=new VoiceSentenceChunker([],false,true),parts:string[]=[];
  parts.push(...parser.push(opening+'The first thought is complete. '));
  assert.equal(parts.length,1,'An outer prose delimiter cannot hold completed speech');
  for(let i=0;i<50;i++)parts.push(...parser.push('The next thought is complete. '));
  assert.ok(parser.pendingCharacters<100);
  parts.push(...parser.push(opening),...parser.flush());
  assert.equal(parts.join(' '),opening+'The first thought is complete. '+Array(50).fill('The next thought is complete.').join(' ')+' '+opening);
 }
});
test('render-ahead uses observed seconds and bytes, freezes on Pause and rejects stale reports',()=>{
 const reserve=new SpeechRenderAhead();reserve.sent(0,4,1000);
 assert.equal(reserve.allows(),false,'Unscheduled WAV consumes the single ready slot');
 assert.equal(reserve.allows(.6,1000,true),false,'Parallel speech still waits for the browser scheduling report');
 assert.equal(reserve.observe({sample:0,seqs:[0],queuedSeconds:4,speechSeconds:3,queuedBytes:1000,running:true}),true);
 assert.equal(reserve.snapshot.held,true);assert.equal(reserve.snapshot.authoredSilenceSeconds,1);
 assert.equal(reserve.allows(),false);
 assert.equal(reserve.allows(.6,1000,true),true,'An inner voice can reach its already scheduled Owner during a soft render hold');
 assert.equal(reserve.allows(27,1000,true),false,'Parallel voices retain the hard duration cap');
 assert.equal(reserve.allows(.6,SpeechRenderAhead.maxBytes,true),false,'Parallel voices retain the hard byte cap');
 reserve.observe({sample:1,seqs:[0],queuedSeconds:2,speechSeconds:1,queuedBytes:1000,running:true});assert.equal(reserve.allows(),false,'Hysteresis persists between low and high');
 reserve.observe({sample:2,seqs:[0],queuedSeconds:1,speechSeconds:1,queuedBytes:1000,running:false});assert.equal(reserve.allows(),false,'No server-clock decay while paused');
 assert.equal(reserve.allows(.6,1000,true),false,'Parallel preparation cannot bypass Pause');
 assert.equal(reserve.observe({sample:1,seqs:[0],queuedSeconds:0,speechSeconds:0,queuedBytes:1000,running:true}),false);
 reserve.observe({sample:3,seqs:[0],queuedSeconds:1,speechSeconds:1,queuedBytes:1000,running:true});assert.equal(reserve.allows(),true);
 assert.equal(reserve.observe({sample:4,seqs:[99],queuedSeconds:0,speechSeconds:0,queuedBytes:0,running:true}),false);
 assert.throws(()=>reserve.allows(31,0),/limit/);assert.throws(()=>reserve.allows(1,9*1024*1024),/limit/);
 reserve.sent(1,27,1000);assert.equal(reserve.allows(4,0),false,'All rendered WAV duration remains under the hard cap');
 reserve.acknowledged(1);reserve.rendered(2500);assert.equal(reserve.lowSeconds,2.75);assert.equal(reserve.highSeconds,4.25);
});
test('bounded trace snapshots keep queue/output observations separate and cannot mutate stored evidence',()=>{
 let now=0;const traces=new ReplyTraces(()=>now);traces.begin('reply','llama.cpp','selected');
 const reserve=new SpeechRenderAhead();now=100;
 for(let i=0;i<300;i++){traces.event('reply','audio-scheduled',{seq:i,value:1});traces.buffer('reply',reserve.snapshot);}
 const snapshot=traces.snapshot()[0];assert.equal(snapshot.events?.length,256);assert.equal(snapshot.buffers?.length,128);
 snapshot.events![0].name='tampered';snapshot.buffers![0].queuedSeconds=100;
 assert.equal(traces.snapshot()[0].events![0].name,'audio-scheduled');assert.equal(traces.snapshot()[0].buffers![0].queuedSeconds,0);
});
