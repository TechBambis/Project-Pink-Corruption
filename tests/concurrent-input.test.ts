// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {ConcurrentInput} from '../apps/web/src/concurrent-input';
import {decideListening,ListeningDecisionSchema,ListeningInputSchema,isStopRequest} from '../packages/ai/listening';
import {Microphone} from '../packages/speech/capture';
import {LlamaBackend} from '../packages/ai';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('decisions stay ordered; acknowledgments do not erase meaningful input',async()=>{
 const continued:string[]=[];const releases:((action:'continue'|'adapt')=>void)[]=[];
 const inbox=new ConcurrentInput(()=>new Promise(resolve=>releases.push(resolve)),item=>continued.push(item.text),()=>{},()=>{});
 inbox.enqueue('Please slow down','speech');inbox.enqueue('mhm','speech');
 assert.equal(releases.length,1);releases.shift()!('adapt');await tick();
 assert.equal(releases.length,1);releases.shift()!('continue');await tick();
 assert.deepEqual(continued,[]);assert.deepEqual(inbox.takeAdaptation().map(item=>item.text),['Please slow down','mhm']);assert.equal(inbox.pending,0);
 inbox.enqueue('okay','text');releases.shift()!('continue');await tick();assert.deepEqual(continued,['okay']);
});
test('stop or mute invalidates stale decisions while typed input survives microphone mute',async()=>{
 const continued:string[]=[];const releases:((action:'continue'|'adapt')=>void)[]=[];
 const inbox=new ConcurrentInput(()=>new Promise(resolve=>releases.push(resolve)),item=>continued.push(item.text),()=>{},()=>{});
 inbox.enqueue('old speech','speech');inbox.enqueue('new typed input','text');inbox.clear('speech');
 releases.shift()!('continue');releases.shift()!('adapt');await tick();
 assert.deepEqual(continued,[]);assert.deepEqual(inbox.takeAdaptation().map(item=>item.text),['new typed input']);
 inbox.enqueue('old typed input','text');inbox.clear();releases.shift()!('adapt');await tick();assert.equal(inbox.pending,0);
});
test('planner failures adapt instead of silently dropping input; inbox stays bounded',async()=>{
 let errors=0;const inbox=new ConcurrentInput(async()=>{throw Error('offline');},()=>{},()=>{},()=>errors++);
 inbox.enqueue('question','text');await tick();assert.equal(errors,1);assert.equal(inbox.takeAdaptation()[0].text,'question');
 const blocked=new ConcurrentInput(()=>new Promise(()=>{}),()=>{},()=>{},()=>{});
 for(let i=0;i<8;i++)blocked.enqueue(String(i),'text');assert.throws(()=>blocked.enqueue('overflow','text'),/Too many/);blocked.clear();
 blocked.enqueue('a'.repeat(3999),'text');assert.throws(()=>blocked.enqueue('bb','text'),/too long/);blocked.clear();
});
test('muting releases an already decided typed acknowledgment behind spoken input',async()=>{
 const continued:string[]=[];
 const inbox=new ConcurrentInput(async item=>item.source==='speech'?'adapt':'continue',item=>continued.push(item.text),()=>{},()=>{});
 inbox.enqueue('spoken request','speech');inbox.enqueue('okay','text');await tick();
 assert.equal(inbox.pending,2);inbox.clear('speech');await tick();
 assert.deepEqual(continued,['okay']);assert.equal(inbox.pending,0);
});
test('headphone overlapping capture and speaker protection are independent of interruption',()=>{
 const mic=new Microphone(()=>{},()=>{},()=>{});
 mic.configure('headphones','balanced',650,false,true);assert.equal(mic.protectedPlayback,false);
 mic.configure('speakers','balanced',650,false,true);assert.equal(mic.protectedPlayback,true);
 mic.configure('headphones','balanced',650,false,false);assert.equal(mic.protectedPlayback,true);
});
test('only explicit standalone stop commands bypass model planning',()=>{
 for(const text of ['stop','Stop everything.','Please stop!','please stop talking','stop the session now'])assert.ok(isStopRequest(text),text);
 for(const text of ['do not stop','When you say stop, what do you mean?','I like the word stop','Stop by the shop'])assert.equal(isStopRequest(text),false,text);
});
test('planner output is schema validated and context cannot become system instructions',async()=>{
 const input=ListeningInputSchema.parse({text:'yes',heard:'Would you like it slower?',draft:'A discarded draft',question:'Speak to me.',model:'fixture',backend:'ollama',context:4096});
 let messages:any;const backend={name:'fixture',async models(){return [];},async *stream(){},async structured(m:any){messages=m;return {action:'adapt'};}};
 assert.deepEqual(await decideListening(input,backend,new AbortController().signal),{action:'adapt'});
 assert.equal(messages[1].role,'user');assert.equal(JSON.parse(messages[1].content).actuallyHeard,input.heard);
 assert.equal(ListeningDecisionSchema.safeParse({action:'ignore',text:'secret'}).success,false);
 backend.structured=async()=>({action:'invalid'});await assert.rejects(()=>decideListening(input,backend,new AbortController().signal));
});
test('internal classification disables creative samplers independently of spoken generation',async()=>{
 const originalFetch=globalThis.fetch;let request:any;
 globalThis.fetch=async(_url,init)=>{request=JSON.parse(init!.body as string);return new Response(JSON.stringify({choices:[{message:{content:'{"action":"continue"}'}}]}),{status:200});};
 try{
  assert.deepEqual(await new LlamaBackend().structured([{role:'user',content:'mhm'}],'fixture',new AbortController().signal,4096,{}),{action:'continue'});
  assert.equal(request.top_k,1);assert.equal(request.xtc_probability,0);assert.equal(request.dry_multiplier,0);assert.equal(request.temperature,0);assert.equal(request.min_p,0);
 }finally{globalThis.fetch=originalFetch;}
});
