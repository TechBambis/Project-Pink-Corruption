// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerSpeechDetector,type DetectorWorker,type DetectorCommand,type DetectorReply} from '../packages/speech/detector-client';
import {Message} from '@ricky0123/vad-web/dist/messages';

class WorkerFixture implements DetectorWorker {
 onmessage:DetectorWorker['onmessage']=null;onerror:DetectorWorker['onerror']=null;
 sent:DetectorCommand[]=[];terminated=false;
 postMessage(message:DetectorCommand){this.sent.push(structuredClone(message));}
 terminate(){this.terminated=true;}
 reply(data:DetectorReply){this.onmessage?.({data} as MessageEvent<DetectorReply>);}
}
test('reset invalidates speech already sent by the worker before the next utterance',async()=>{
 const worker=new WorkerFixture(),events:string[]=[];
 const detector=new WorkerSpeechDetector(worker,event=>events.push(event.msg),error=>{throw error;});
 detector.push(new Float32Array(512),16000);detector.reset();
 worker.reply({type:'event',epoch:0,event:{msg:Message.SpeechRealStart}});
 worker.reply({type:'event',epoch:0,event:{msg:Message.SpeechEnd,audio:new Float32Array(16000)}});
 assert.deepEqual(events,[]);
 worker.reply({type:'event',epoch:1,event:{msg:Message.SpeechRealStart}});
 assert.deepEqual(events,[Message.SpeechRealStart]);
 await detector.destroy();assert.equal(worker.terminated,true);
 assert.equal(worker.onmessage,null);assert.equal(worker.onerror,null);
});
test('unresponsive worker mailbox drops old audio instead of replaying it later',()=>{
 const worker=new WorkerFixture();const detector=new WorkerSpeechDetector(worker,()=>{},error=>{throw error;});
 for(let i=0;i<17;i++)detector.push(new Float32Array(512),16000);
 assert.equal(worker.sent.filter(message=>message.type==='frame').length,16);
 assert.deepEqual(worker.sent.at(-1),{type:'reset',epoch:1});
 worker.reply({type:'accepted',epoch:0,durationMs:512});
 for(let i=0;i<17;i++)detector.push(new Float32Array(512),16000);
 assert.deepEqual(worker.sent.at(-1),{type:'reset',epoch:2});
 void detector.destroy();
});
test('acknowledged worker input can keep flowing and a worker crash stops the detector once',()=>{
 const worker=new WorkerFixture(),errors:unknown[]=[];
 const detector=new WorkerSpeechDetector(worker,()=>{},error=>errors.push(error));
 for(let i=0;i<60;i++){detector.push(new Float32Array(512),16000);worker.reply({type:'accepted',epoch:0,durationMs:32});}
 assert.equal(worker.sent.filter(message=>message.type==='reset').length,0);
 worker.reply({type:'error',message:'Inference failed'});worker.reply({type:'error',message:'Repeated failure'});
 assert.equal(errors.length,1);assert.equal(worker.terminated,true);
 detector.push(new Float32Array(512),16000);assert.equal(worker.sent.length,60);
});

test('stopping capture while the local model loads terminates its worker immediately',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'Worker');
 let spawned=0,worker!:WorkerFixture;
 Object.defineProperty(globalThis,'Worker',{configurable:true,value:class extends WorkerFixture {constructor(){super();spawned++;worker=this;}}});
 try{
  const controller=new AbortController();
  const starting=assert.rejects(WorkerSpeechDetector.create(()=>{},()=>{},controller.signal),{name:'AbortError'});
  controller.abort();await starting;
  assert.equal(spawned,1);assert.equal(worker.terminated,true);assert.equal(worker.onmessage,null);
  await assert.rejects(WorkerSpeechDetector.create(()=>{},()=>{},controller.signal),{name:'AbortError'});
  assert.equal(spawned,1,'Already cancelled capture must not spawn a worker');
 }finally{if(original)Object.defineProperty(globalThis,'Worker',original);else Reflect.deleteProperty(globalThis,'Worker');}
});
