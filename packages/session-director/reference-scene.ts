// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { EventSchema, ProgramSchema, type BambiEvent, type PresentationState } from './events/contract';
import { sessionPhaseAt } from './phases';
import { type CompiledSpeechPlan } from './performance-score';
import { compileEvent } from './events/runtime';
export const referenceDurationMs=240000;
export const referenceSettings={experimentProfile:'next-gen-ab' as const,model:'bambi-qwen35-9b-hauhau:q4_k_m',voice:'bambi_classic',speed:.9,preset:'bambi_local_clean' as const,sampling:'qwen' as const,context:24576,persona:'A calm English guide. Use clear connected thoughts and imagined imagery. Preserve listener freedom and ordinary orientation.',promptId:'custom' as const,username:'Listener',selectedTriggers:[],collar:false,collarName:'',allowedTriggers:[]};
const density={intensity:.2,effectDensity:.1,speechDensity:.4,audioDensity:.2,visualDensity:.15};
export function referenceState(scene:PresentationState['scene']='Soft Pink',spoken=true):PresentationState {
  return {activeLayers:spoken?['main_voice','drone','transition_sfx','base_visual']:['drone','base_visual'],foreground:spoken?'main_voice':'base_visual',density,visualState:scene==='Minimal Dark'?'black':'sparse',narrationState:spoken?'speaking':'paused',ambientState:'reduced',scene};
}
/** Exact event windows stay inside the existing fixed parents. */
export function referenceEvent(id:string,atMs:number,windowMs:number,scene:PresentationState['scene'],instruction:string,words=60):BambiEvent {
  return EventSchema.parse({id,type:'layer_shift',phase:sessionPhaseAt(atMs/1000,referenceDurationMs/1000).phase,atMs,
    timing:{prepMs:0,activeMs:windowMs,returnMs:0},state:referenceState(scene),baseline:referenceState(scene),
    speech:{mode:'narrate',targetMs:windowMs,instruction,wordTarget:words,delivery:'guide'},
    audio:[],visual:[],haptics:[],entry:{kind:'hard_cut',durationMs:0,subtitle:'clear'},exit:{kind:'hard_cut',durationMs:0,subtitle:'clear'},
    rhythm:{offsetMs:500,untilMs:windowMs,stepMs:3000}});
}
export function referenceProgram(plans: {atMs:number; plan:CompiledSpeechPlan}[], live?:BambiEvent) {
  const boundaries=[0,57600,96000,192000,216000,referenceDurationMs];
  const contrasts=plans.flatMap(p=>p.plan.beats.filter(b=>b.beatId==='contrast-begins').map(b=>p.atMs+b.atMs));
  const returns=plans.flatMap(p=>p.plan.beats.filter(b=>b.beatId==='scene-return').map(b=>p.atMs+b.atMs));
  const darkAt=contrasts[0]??114000,lightAt=returns[0]??145000;
  const sceneAt=(at:number)=>at>=darkAt&&at<lightAt?'Minimal Dark' as const:'Soft Pink' as const;
  const events=plans.flatMap(({atMs,plan})=>plan.arcs.map(arc=>referenceEvent(arc.id,atMs+arc.atMs,arc.durationMs+150,sceneAt(atMs+arc.atMs),'Prepared complete synthesis arc; no model generation.')));
  if(live)events.push(live);
  events.sort((a,b)=>a.atMs-b.atMs);
  const filled:BambiEvent[]=[];
  let end=0,serial=0;
  const gap=(from:number,to:number)=>{
    const cuts=[from,...boundaries.filter(b=>b>from&&b<to),...[darkAt,lightAt].filter(b=>b>from&&b<to),to].sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++)if(cuts[i+1]>cuts[i]) {
      const state=referenceState(sceneAt(cuts[i]),false);
      filled.push(EventSchema.parse({id:`quiet-${serial++}`,type:'silence',phase:sessionPhaseAt(cuts[i]/1000,240).phase,atMs:cuts[i],timing:{prepMs:0,activeMs:cuts[i+1]-cuts[i],returnMs:0},state,baseline:state,speech:{mode:'silent',targetMs:0,instruction:''},audio:[],visual:[],haptics:[],entry:{kind:'silence_cut',durationMs:0,subtitle:'retain'},exit:{kind:'hard_cut',durationMs:0,subtitle:'retain'}}));
    }
  };
  for(const event of events){if(event.atMs<end-.001)throw Error('Reference speech overlap');gap(end,event.atMs);filled.push(event);end=event.atMs+event.timing.activeMs;}
  gap(end,referenceDurationMs);
  const program=ProgramSchema.parse({version:1,durationMs:referenceDurationMs,baseline:referenceState('Soft Pink',false),motifs:[],events:filled});
  for(const event of program.events)compileEvent(event);
  return program;
}
