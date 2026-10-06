// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionEvents} from '../apps/web/src/session-events';
import {createReferenceProgram,withProgramTriggers,withHapticMappings} from '../packages/session-director/events/program';
import {EventRuntime,type SpeechSlot} from '../packages/session-director/events/runtime';
import type {AudioEngine} from '../packages/audio';
import {EventSpeechRequestSchema,type RenderedEventSpeech} from '../packages/session-director/events/speech';

function fixture(){
 const p=withHapticMappings(withProgramTriggers(createReferenceProgram(1200000),{deepening:['test cue']})),runtime=new EventRuntime(p);
 const slot=runtime.slots.find(s=>s.speech.requiredTrigger)!;
 const settings=EventSpeechRequestSchema.parse({event:runtime.compiled.find(c=>c.event.id===slot.eventId)!.event,payloadId:slot.payloadId,allowedTriggers:['test cue']});
 const cues:{command:unknown;time?:number;origin?:string}[]=[],sources:unknown[]=[];let clearCount=0,allowSpeech=true,allowTriggers=true,haptics=true;
 const engine={context:{currentTime:10},outputTime:10,onDeviceCue(command:unknown,time?:number,origin?:string){cues.push({command,time,origin});},
  playEventVoice(){const source={onended:null,stop(){}};sources.push(source);return source;},playEventTrigger(){},stopEventCues(){},setEventGains(){}} as unknown as AudioEngine;
 const hooks:ConstructorParameters<typeof SessionEvents>[2]={audio:()=>engine,visuals:()=>null,settings:()=>settings,clearDevices:()=>{clearCount++;},clearSpeech(){},notice(){},narration(){},displayNarration(){},cue(){},pink(){},allowVisuals:()=>false,paused:()=>false,triggers:()=>({}),haptics:()=>haptics,restore(){},allowSpeech:()=>allowSpeech,allowTriggers:()=>allowTriggers,allowTriggerSound:()=>false};
 // Only element construction is stubbed; scheduling, eligibility and cancellation use the real adapter.
 const oldDocument=globalThis.document;
 const element=()=>({hidden:true,style:{},dataset:{},append(){},setAttribute(){}});
 let adapter:SessionEvents;
 try{globalThis.document={createElement:element} as unknown as Document;adapter=new SessionEvents(element() as unknown as HTMLElement,element() as unknown as HTMLCanvasElement,hooks);}
 finally{globalThis.document=oldDocument;}
 const internals=adapter! as unknown as {runtime:EventRuntime;started:boolean;lastSnapshot:ReturnType<EventRuntime['snapshot']>;payloads:Map<string,{response:RenderedEventSpeech;buffer:AudioBuffer}>;request:AbortController|null;speak:(slot:SpeechSlot,atMs:number)=>void};
 internals.runtime=runtime;internals.started=true;internals.lastSnapshot=runtime.snapshot(slot.atMs);internals.request=new AbortController();
 const cache=()=>internals.payloads.set(slot.payloadId,{response:{text:'test cue',triggerOffsetMs:500} as RenderedEventSpeech,buffer:{duration:.8} as AudioBuffer});
 return {adapter:adapter!,slot,cues,sources,internals,cache,get clears(){return clearCount;},set allowSpeech(value:boolean){allowSpeech=value;},set allowTriggers(value:boolean){allowTriggers=value;},set haptics(value:boolean){haptics=value;}};
}

test('an actual scheduled voice queues one word-aligned haptic; missing, late or disabled speech queues none',()=>{
 const f=fixture();f.internals.speak(f.slot,f.slot.atMs);assert.equal(f.cues.length,0);
 f.cache();f.allowSpeech=false;f.internals.speak(f.slot,f.slot.atMs);assert.equal(f.cues.length,0);
 f.allowSpeech=true;f.allowTriggers=false;f.internals.speak(f.slot,f.slot.atMs);assert.equal(f.cues.length,0);
 f.allowTriggers=true;f.internals.speak(f.slot,f.slot.atMs+2000);assert.equal(f.cues.length,0);
 f.internals.speak(f.slot,f.slot.atMs);assert.equal(f.sources.length,1);assert.equal(f.cues.length,1);assert.equal(f.cues[0].time,11.5);assert.equal(f.cues[0].origin,'speech');
});

test('turning off event haptics or speech clears previously queued playback',()=>{
 const f=fixture();f.cache();f.adapter.tick(f.slot.atMs);assert.equal(f.cues.length,1);
 f.haptics=false;f.adapter.tick(f.slot.atMs+1);assert.equal(f.clears,1);
 f.allowSpeech=false;f.adapter.tick(f.slot.atMs+2);assert.equal(f.clears,2);
});
