// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionEvents} from '../apps/web/src/session-events';
import {referenceProgram,referenceEvent,referenceSettings} from '../packages/session-director/reference-scene';
import type {CompiledSpeechPlan} from '../packages/session-director/performance-score';
import type {RenderedEventSpeech} from '../packages/session-director/events/speech';
import type {AudioEngine} from '../packages/audio';
function fixture(){
 let contextTime=10,outputTime=10;
 const voices:{stopped:boolean;stop():void;onended:null}[]=[],notices:string[]=[];
 const audio={context:{get currentTime(){return contextTime;},decodeAudioData:async()=>({duration:1})},get outputTime(){return outputTime;},setEventMode(){},setNarrationDelivery(){},setEventGains(){},clearEventGains(){},stopEventCues(){},playEventCue(){},playEventVoice(){const source={stopped:false,onended:null,stop(){this.stopped=true;}};voices.push(source);return source;}} as unknown as AudioEngine;
 const element=()=>({hidden:true,style:{removeProperty(){}},dataset:{},append(){},setAttribute(){}});
 const saved=globalThis.document;let adapter:SessionEvents;
 try{globalThis.document={createElement:element} as unknown as Document;adapter=new SessionEvents(element() as unknown as HTMLElement,element() as unknown as HTMLCanvasElement,{audio:()=>audio,visuals:()=>null,settings:()=>referenceSettings,notice:t=>notices.push(t),narration(){},displayNarration(){},clearSpeech(){},clearDevices(){},cue(){},pink(){},allowVisuals:()=>false,paused:()=>false,triggers:()=>({}),haptics:()=>false,restore(){},allowSpeech:()=>true,allowTriggers:()=>false,allowTriggerSound:()=>false});}finally{globalThis.document=saved;}
 const plan=(id:string):CompiledSpeechPlan=>({version:1,scoreId:id,durationMs:2000,windowMs:4000,arcs:[{id,text:'Light stays.',atMs:0,durationMs:1000,pauseAfterMs:500,important:true,words:[{word:'Light',atMs:100,endMs:300},{word:'stays',atMs:500,endMs:950}]}],beats:[]});
 const plans=[{atMs:1000,plan:plan('entry')},{atMs:216000,plan:plan('closing')}];
 const program=referenceProgram(plans,referenceEvent('live-bridge',120000,21000,'Minimal Dark','Continue the imagined lantern.',26));
 const payloads:RenderedEventSpeech[]=plans.map(({plan})=>({payloadId:plan.arcs[0].id+':payload',requestId:'prepared-'+plan.scoreId,text:'Light stays.',audio:btoa('fixture'),durationMs:1000,targetMs:1000,textAttempts:0,words:plan.arcs[0].words}));
 const prepare=()=>adapter!.prepare(240000,.2,new AbortController().signal,program,false,undefined,{payloads,importantPayloads:payloads.map(p=>p.payloadId),liveWindows:[{payloadId:'live-bridge:payload',readyAfterMs:105000}]});
 const tick=(t:number)=>{contextTime=10+t/1000;outputTime=contextTime-.1;adapter!.tick(t);};
 const start=()=>{const saved=globalThis.document;try{globalThis.document={getElementById:element} as unknown as Document;adapter!.start();}finally{globalThis.document=saved;}};
 return {adapter:adapter!,voices,notices,prepare,tick,start};
}
function pending(){let resolve!:(r:Response)=>void;return {promise:new Promise<Response>(r=>resolve=r),resolve:(r:Response)=>resolve(r)};}
function rendered(request:{requestId:string;payloadId:string}){return Response.json({...request,text:'The imagined lantern stays.',audio:btoa('fixture'),durationMs:1000,targetMs:21000,textAttempts:1,words:[]});}

test('prepared history waits through output latency; backward seek restores immutable PCM with new occurrence evidence',async()=>{
 const f=fixture();try{await f.prepare();f.start();f.tick(1000);f.tick(2000);
 assert.equal(f.adapter.outputEvidence[0].history,'Light');assert.deepEqual(f.adapter.outputEvidence[0].statements,[]);
 f.tick(2100);assert.equal(f.adapter.outputEvidence[0].history,'Light stays.');
 f.adapter.seek(0);f.tick(1000);f.tick(1200);assert.equal(f.voices.length,2);assert.equal(f.adapter.outputEvidence.length,1);assert.ok(f.adapter.outputEvidence[0].epoch>1);
 }finally{f.adapter.stop();}
});
test('a prepared complete arc survives an ordinary late control tick within its fixed pause reserve',async()=>{
 const f=fixture();try{await f.prepare();f.start();f.tick(1060);assert.equal(f.voices.length,1);f.tick(2210);assert.equal(f.adapter.outputEvidence[0].history,'Light stays.');}finally{f.adapter.stop();}
});
test('one bounded live bridge starts after the engine gate; Pause and Stop discard delayed correlated replies',async()=>{
 const saved=globalThis.fetch,requests:{body:any;signal:AbortSignal}[]=[],replies=[pending(),pending()];let call=0;const f=fixture();
 try{globalThis.fetch=async(_url,init)=>{requests.push({body:JSON.parse(init!.body as string),signal:init!.signal as AbortSignal});return replies[call++].promise;};
 await f.prepare();f.start();f.tick(104999);assert.equal(requests.length,0);
 f.tick(105000);assert.equal(requests.length,1);assert.ok(requests[0].body.requestId);
 f.adapter.pause();assert.equal(requests[0].signal.aborted,true);replies[0].resolve(rendered(requests[0].body));await new Promise(r=>setImmediate(r));
 f.adapter.resume();f.tick(106000);assert.equal(requests.length,2);
 f.adapter.stop();replies[1].resolve(rendered(requests[1].body));await new Promise(r=>setImmediate(r));assert.equal(f.adapter.active,false);assert.equal(f.voices.length,0);assert.deepEqual(f.adapter.outputEvidence,[]);
 }finally{f.adapter.stop();globalThis.fetch=saved;}
});
test('overflow, wrong request IDs and packets beyond entry cannot start voice or shift the authored bridge',async()=>{
 for(const failure of ['overflow','request','late'] as const){const saved=globalThis.fetch,f=fixture(),reply=pending();let body:any;
 try{globalThis.fetch=async(_url,init)=>{body=JSON.parse(init!.body as string);return reply.promise;};await f.prepare();f.start();f.tick(105000);
 if(failure==='late')f.tick(120500);
 reply.resolve(failure==='overflow'?Response.json({error:'Measured speech overflow'},{status:422}):failure==='request'?rendered({...body,requestId:'stale'}):rendered(body));await new Promise(r=>setImmediate(r));f.tick(121000);
 assert.equal(f.voices.length,0);assert.equal(f.adapter.program!.events.find(e=>e.id==='live-bridge')!.atMs,120000);
 if(failure!=='late')assert.ok(f.notices.some(n=>n.includes('skipped')));
 }finally{f.adapter.stop();globalThis.fetch=saved;}}
});

test('live preparation cannot reopen requests inside its expired readiness margin',async()=>{
 const saved=globalThis.fetch,f=fixture(),reply=pending();let calls=0,signal:AbortSignal|undefined;
 try{globalThis.fetch=async(_url,init)=>{calls++;signal=init!.signal as AbortSignal;return reply.promise;};await f.prepare();f.start();f.tick(105000);assert.equal(calls,1);
 f.tick(119850);assert.equal(signal!.aborted,true);reply.resolve(Response.json({}));await new Promise(r=>setImmediate(r));
 for(const at of [119851,119900,119999,120000,120100])f.tick(at);
 assert.equal(calls,1);assert.equal(f.voices.length,0);
 }finally{f.adapter.stop();globalThis.fetch=saved;}
});
