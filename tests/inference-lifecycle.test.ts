// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {InferenceQueue,InferenceResources} from '../packages/ai/inference';
import {LlamaBackend,OllamaBackend} from '../packages/ai';

test('slow cloud work cannot block local listening while native and Ollama still share one GPU slot',async()=>{
 const resources=new InferenceResources(),signal=new AbortController().signal,events:string[]=[];
 let releaseCloud!:()=>void,releaseLocal!:()=>void;
 const cloud=resources.forBackend({name:'cloud'}).run(async()=>{events.push('cloud');await new Promise<void>(resolve=>releaseCloud=resolve);},signal);
 const native=resources.forBackend({name:'llama.cpp'}).run(async()=>{events.push('native');await new Promise<void>(resolve=>releaseLocal=resolve);},signal);
 await Promise.resolve();assert.deepEqual(events,['cloud','native']);
 const ollama=resources.forBackend({name:'ollama'}).run(async()=>{events.push('ollama');},signal);
 const listening=resources.forBackend({name:'llama.cpp'}).run(async()=>{events.push('listen');},signal,10);
 await Promise.resolve();assert.deepEqual(events,['cloud','native']);
 releaseLocal();await Promise.all([native,ollama,listening]);assert.deepEqual(events,['cloud','native','listen','ollama']);
 releaseCloud();await cloud;
});

test('cancellation after acquiring a slot prevents an obsolete operation from starting',async()=>{
 const queue=new InferenceQueue(),controller=new AbortController();let started=false;
 const job=queue.run(async()=>{started=true;},controller.signal);controller.abort();
 await assert.rejects(job,{name:'AbortError'});assert.equal(started,false);
 assert.equal(await queue.run(async()=>42,new AbortController().signal),42);
});

for(const kind of ['native','ollama'] as const)test(`${kind} yields abort only the current HTTP generation before releasing its inference slot`,async()=>{
 const original=globalThis.fetch,requests:AbortSignal[]=[];let cancelled=0;
 globalThis.fetch=async(_url,init)=>{
  requests.push(init!.signal!);
  const data=kind==='native'?'data: {"choices":[{"delta":{"content":"A sentence. "}}]}\n':'{"message":{"content":"A sentence. "}}\n';
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(data));},cancel(){cancelled++;}}));
 };
 try{
  const backend=kind==='native'?new LlamaBackend('http://fixture.invalid'):new OllamaBackend('http://fixture.invalid');
  const queue=new InferenceQueue(),jobController=new AbortController(),stream=queue.stream(backend,[{role:'user',content:'Hi'}],'fixture',jobController.signal,4096,128);
  assert.equal((await stream.next()).value?.text,'A sentence. ');assert.equal(requests[0].aborted,false);
  await stream.return(undefined);assert.equal(cancelled,1);assert.equal(requests[0].aborted,true);assert.equal(jobController.signal.aborted,false);
  await queue.run(async()=>assert.equal(requests[0].aborted,true),jobController.signal,10);
  // A fresh assistant continuation uses a fresh HTTP signal on the same reply.
  const continuation=queue.stream(backend,[{role:'user',content:'Hi'},{role:'assistant',content:'A sentence. '}],'fixture',jobController.signal,4096,128);
  await continuation.next();assert.equal(requests[1].aborted,false);await continuation.return(undefined);assert.equal(requests[1].aborted,true);
 }finally{globalThis.fetch=original;}
});
