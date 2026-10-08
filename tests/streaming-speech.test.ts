// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamingSpeech,type SpeechSocket} from '../packages/speech/streaming/client';

class SocketFixture implements SpeechSocket {
 readyState=1;bufferedAmount=0;sent:(string|ArrayBufferView)[]=[];
 onmessage:SpeechSocket['onmessage']=null;onclose:SpeechSocket['onclose']=null;onerror:SpeechSocket['onerror']=null;
 send(data:string|ArrayBufferView){this.sent.push(data);}
 close(){this.readyState=3;}
 reply(data:unknown){this.onmessage?.({data:JSON.stringify(data)} as MessageEvent);}
 get id(){return JSON.parse(this.sent.find(item=>typeof item==='string'&&JSON.parse(item).type==='start') as string).id;}
}
async function fixture(){
 const partials:string[]=[],finals:string[]=[];let fallback=0;
 const client=new StreamingSpeech({partial:text=>partials.push(text),final:text=>finals.push(text),changed(){},failed:error=>{throw error;}});
 const socket=new SocketFixture(),ready=client.connect(socket);socket.reply({type:'ready'});await ready;
 return {client,socket,partials,finals,fallback:()=>fallback++,get fallbackCount(){return fallback;}};
}
test('streaming keeps the quiet onset and only an explicit final commits a transcript once',async()=>{
 const f=await fixture();
 for(let i=0;i<28;i++)f.client.frame(new Float32Array(512).fill(i/100));
 f.client.begin(4);
 assert.equal(f.socket.sent.filter(item=>typeof item!=='string').length,28);
 f.socket.reply({type:'partial',id:f.socket.id,text:'A sentence beginning'});
 assert.deepEqual(f.finals,[]);assert.deepEqual(f.partials,['A sentence beginning']);
 assert.equal(f.client.finish(123,4,f.fallback),true);assert.equal(f.client.pending,true);
 f.socket.reply({type:'final',id:f.socket.id,text:'A complete sentence.'});
 f.socket.reply({type:'final',id:f.socket.id,text:'Duplicated result.'});
 assert.deepEqual(f.finals,['A complete sentence.']);assert.equal(f.fallbackCount,0);assert.equal(f.client.pending,false);f.client.close();
});
test('reset and mute discard in-flight hypotheses and finals without retrying cancelled input',async()=>{
 const f=await fixture();f.client.begin(1);const id=f.socket.id;f.client.finish(99,1,f.fallback);
 f.client.reset();f.socket.reply({type:'partial',id,text:'Obsolete'});f.socket.reply({type:'final',id,text:'Obsolete'});
 assert.deepEqual(f.partials,[]);assert.deepEqual(f.finals,[]);assert.equal(f.fallbackCount,0);
 f.client.close();assert.equal(f.socket.onmessage,null);assert.equal(f.socket.readyState,3);
});
test('lost streaming connection retries a completed WAV exactly once',async()=>{
 const f=await fixture();f.client.begin(1);f.client.finish(99,1,f.fallback);
 f.socket.onclose?.({} as CloseEvent);f.socket.onclose?.({} as CloseEvent);
 assert.equal(f.fallbackCount,1);assert.deepEqual(f.finals,[]);f.client.close();
});
test('overloaded streaming input is bounded and leaves the completed utterance to batch recognition',async()=>{
 const f=await fixture();f.client.begin(1);
 for(let i=0;i<40;i++)f.client.frame(new Float32Array(512));
 assert.ok(f.socket.sent.filter(item=>typeof item!=='string').length<=32);
 assert.equal(f.client.finish(99,1,f.fallback),false);assert.equal(f.socket.readyState,3);f.client.close();
});
test('muting during streaming model preparation cancels readiness immediately',async()=>{
 const client=new StreamingSpeech({partial(){},final(){},changed(){},failed(){}}),socket=new SocketFixture();
 const connecting=assert.rejects(client.connect(socket),{name:'AbortError'});client.close();await connecting;assert.equal(socket.readyState,3);
});
