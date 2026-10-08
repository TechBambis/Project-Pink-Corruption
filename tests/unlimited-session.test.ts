// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {TimelineScheduler} from '../packages/timeline';
import {SessionDirector} from '../packages/session-director';
import {AdaptiveDirector} from '../packages/session-director/adaptive';
import {phasePosition,sessionPhaseAt} from '../packages/session-director/phases';
import {ProgramSchema,eventDurationMs,parentPhaseMs} from '../packages/session-director/events/contract';
import {EventRuntime,compileEvent} from '../packages/session-director/events/runtime';
import {withHapticMappings,withProgramTriggers} from '../packages/session-director/events/program';
import {NarrationFlow,narrationDirective} from '../packages/session-director/narration';
import {snapshotSession,SessionStateSchema,buildSessionState} from '../packages/ai/session-state';
import {DeviceController} from '../packages/devices/controller';

test('Unlimited repeats the fixed five phases on a monotonic clock without completing or losing Pause/Stop',()=>{
 let now=0;const clock=new TimelineScheduler(()=>now),director=new SessionDirector(clock);
 director.unlimited=true;director.ready();director.start();
 for(const cycle of [0,1,2,100])for(const [position,phase] of [[0,'induction'],[288,'deepening'],[480,'conditioning'],[960,'anchor'],[1080,'awakening']] as const){
  now=cycle*1200+position;director.update();
  assert.equal(clock.running,true);assert.equal(director.active,true);
  assert.equal(sessionPhaseAt(director.phaseTime,director.duration).phase,phase);
  assert.equal(director.phaseTime,position);assert.ok(director.level>=0&&director.level<=.45);
 }
 now=120000;director.update();assert.equal(director.state,'PREPARE');
 director.togglePause();const paused=clock.time;now+=50;director.update();assert.equal(clock.time,paused);assert.equal(clock.running,false);
 director.togglePause();now+=1;director.update();assert.equal(clock.time,paused+1);
 director.abort();assert.equal(director.state,'ABORTED');assert.equal(clock.running,false);
 const timed=new SessionDirector(new TimelineScheduler(()=>now));timed.duration=60;timed.ready();timed.start();now+=60;timed.update();assert.equal(timed.state,'FINISHED');
});

test('adaptive Unlimited generates fresh bounded episodes across multiple journeys and beyond 24 hours',()=>{
 const options={speech:true,visuals:true,reducedMotion:false,triggers:['Good Girl'],voiceAvailable:true};
 const director=new AdaptiveDirector(1200000,.7,7,true),runtime=new EventRuntime(director.initial(options));
 const ids=new Set<string>(),forms=new Set<string>();let at=0,episodes=0;
 while(at<3600000){
  const event=runtime.program.events.at(-1)!;
  assert.equal(ids.has(event.id),false);ids.add(event.id);episodes++;
  const cycle=Math.floor(event.atMs/1200000)*1200000,bounds=parentPhaseMs(event.phase,1200000);
  assert.ok(event.atMs>=cycle+bounds.start);assert.ok(event.atMs+eventDurationMs(event)<=cycle+bounds.end+.001);
  assert.equal(event.softReturn?.final===true,false);assert.equal(event.speech.fixedText,undefined);
  const compiled=compileEvent(event),end=event.atMs+eventDurationMs(event);
  for(let time=event.atMs;time<end;time+=1000){
   const state=runtime.snapshot(time).state;forms.add(state.motifForm??'ring');
   director.observe(event,state,time,true,compiled.speech.some(slot=>time>=slot.atMs&&time<slot.endMs));runtime.tick(time);
  }
  at=end;
  const next=director.plan(at,options);runtime.append(next.event,next.motifs);
  assert.equal(runtime.snapshot(at).complete,false);
  assert.ok(runtime.compiled.length<=64);assert.ok(director.decisions.length<=128);
 }
 assert.ok(episodes>100);assert.equal(forms.size,3);assert.equal(director.complete(1200000),false);
 const later=director.plan(86400000+500000,options),program=ProgramSchema.parse({...runtime.program,events:[later.event]});
 assert.equal(new EventRuntime(program).snapshot(later.event.atMs).complete,false);
 assert.doesNotThrow(()=>withHapticMappings(program));
 const timed=new AdaptiveDirector(1200000,.7,7);assert.throws(()=>timed.plan(1200000,options),/complete/);
 assert.equal(ProgramSchema.safeParse({...program,continuous:false}).success,false,'Timed packs cannot declare events after their end');
});

test('trigger eligibility uses phase progress within the current Unlimited journey',()=>{
 const director=new AdaptiveDirector(1200000,.7,1,true),options={speech:true,visuals:true,reducedMotion:false,triggers:[],voiceAvailable:true};
 const next=director.plan(1200000+500000,options);let observed=-1;
 const program=director.initial(options);
 withProgramTriggers({...program,events:[next.event],motifs:next.motifs},(_phase,progress)=>{observed=progress;return [];});
 assert.ok(observed>=0&&observed<=100);
});

test('Unlimited narration and AI metadata remain valid after the first journey and beyond 24 hours',()=>{
 const flow=new NarrationFlow();flow.start(1201);assert.notEqual(flow.next(1201,1200,true,true),null);
 flow.completed(1202,4);assert.equal(flow.next(1205,1200,true,true),null);assert.notEqual(flow.next(1206,1200,true,true),null);
 assert.equal(narrationDirective('awakening',false,30,false,true).includes('The session ends at its configured duration'),false);
 const session=snapshotSession({elapsedSeconds:86500,totalSeconds:1200,continuous:true,scene:'Spiral Focus',intensityPercent:45,activeTriggers:[],lastTrigger:null});
 assert.equal(SessionStateSchema.safeParse(session).success,true);assert.equal(session.cycleElapsedMin,phasePosition(86500,1200,true)/60);
 assert.ok(session.elapsedMin>1440);assert.match(buildSessionState(session),/unlimited session/);
});

test('device Unlimited heartbeats preserve caps, Pause, lost-heartbeat stop and explicit disarm',()=>{
 let now=0;const packets:string[]=[],owner={};
 const devices=new DeviceController({send:packet=>packets.push(packet),close(){}},()=>now,()=>.5,false);
 devices.bridgeStatus({connected:true});devices.configure(owner,{enabled:true,vibrationChannel:1,rotationChannel:2,vibrationMax:.2,phaseDefaults:true,transitionMs:0});
 const beat=(elapsed:number,paused=false)=>devices.heartbeat(owner,{running:true,paused,elapsed,duration:1200,continuous:true});
 beat(1200);devices.tick();assert.equal(devices.status.enabled,true);assert.ok(devices.status.channels[0]>0&&devices.status.channels[0]<=20);
 beat(1200,true);devices.tick();assert.deepEqual(devices.status.channels,[0,0,0,0]);
 beat(1201);devices.tick();assert.ok(devices.status.channels[0]<=20);
 beat(86500);devices.tick();assert.equal(devices.status.enabled,true);
 now=2.1;devices.tick();assert.equal(devices.status.enabled,false);assert.deepEqual(devices.status.channels,[0,0,0,0]);
 devices.close();assert.ok(packets.includes('STOP'));
});
