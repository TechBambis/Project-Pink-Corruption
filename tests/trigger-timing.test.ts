// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultTriggerTiming,triggersForPhase,triggerStageAt,parseTriggerTiming,TriggerTimingSchema} from '../packages/session-director/trigger-timing';
import {snapshotSession,SessionStateSchema} from '../packages/ai/session-state';
import {appendPhasePrompt} from '../packages/content/phases';
import {triggerUnits} from '../packages/speech/trigger-units';

const state=(elapsedSeconds:number)=>snapshotSession({elapsedSeconds,totalSeconds:1000,scene:'Minimal Dark',intensityPercent:50,activeTriggers:[],lastTrigger:null});
test('default phase categories change at session boundaries, with late reinforcement at 74%',()=>{
  const config=defaultTriggerTiming();
  for(const [time,stage,names] of [
    [0,'induction',['BAMBI SLEEP','BIMBO DOLL']],
    [239,'induction',['BAMBI SLEEP','BIMBO DOLL']],
    [240,'deepening',['GOOD GIRL','SAFE AND SECURE']],
    [400,'conditioning',['IQ LOCK','BODY LOCK','ATTITUDE LOCK','BAMBI FREEZE']],
    [739,'conditioning',['IQ LOCK','BODY LOCK','ATTITUDE LOCK','BAMBI FREEZE']],
    [740,'reinforcement',['DROP FOR COCK','COCK ZOMBIE NOW','BAMBI CUM AND COLLAPSE','UNIFORM LOCK']],
    [800,'anchor',['IQ LOCK','BODY LOCK','ATTITUDE LOCK','BAMBI FREEZE']],
    [900,'awakening',['BAMBI SLEEP','BAMBI WAKE AND OBEY']],
  ] as const){
    const session=state(time);
    assert.equal(triggerStageAt(session.phase,session.phaseProgress,config),stage);
    assert.deepEqual(triggersForPhase(session.phase,session.phaseProgress,config),names);
  }
});
test('custom groups can combine, deduplicate and silence cues without unlocking categories by intensity',()=>{
  const config=defaultTriggerTiming();config.stages.induction=['entry','awakening'];
  assert.deepEqual(triggersForPhase('induction',0,config),['BAMBI SLEEP','BIMBO DOLL','BAMBI WAKE AND OBEY']);
  config.stages.induction=[];
  const prompt=appendPhasePrompt('BASE',{...state(0),intensity:5,triggerTiming:config});
  assert.match(prompt,/Only these trigger names may be spoken in this response: \[\]/);
  assert.match(prompt,/Do not introduce or fire any named trigger/);
  config.enabled=false;assert.ok(!appendPhasePrompt('BASE',{...state(0),triggerTiming:config}).includes('CURRENT TRIGGER TIMING (takes precedence'));
});
test('configuration survives serialization and rejects invalid categories and thresholds',()=>{
  const config=defaultTriggerTiming();config.reinforcementStart=50;config.stages.deepening=['identity'];
  assert.deepEqual(parseTriggerTiming(JSON.stringify(config)),config);
  assert.equal(triggerStageAt('conditioning',50,config),'reinforcement');
  assert.equal(SessionStateSchema.safeParse({...state(0),triggerTiming:config}).success,true);
  for(const bad of [{...config,reinforcementStart:101},{...config,stages:{...config.stages,deepening:['unknown']}},{...config,unexpected:true}])
    assert.equal(TriggerTimingSchema.safeParse(bad).success,false);
  assert.deepEqual(parseTriggerTiming('broken'),defaultTriggerTiming());
});
test('new identity names are isolated as spoken units so each receives its sound sequence',()=>{
  const units=triggerUnits('BODY LOCK. [pause:long] ATTITUDE LOCK. [pause:long]');
  assert.deepEqual(units.map(unit=>unit.trigger),['BODY LOCK','ATTITUDE LOCK']);
});
