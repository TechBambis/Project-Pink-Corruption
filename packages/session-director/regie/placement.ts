// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { PresentationState } from '../events/contract';
import type { CompiledScene } from './compiler';
import {compileEvent} from '../events/runtime';
import {eventDurationMs} from '../events/contract';

/** Bind section receipts to the admitted events before committing any playback.
 * A response cannot omit one of an exchange's required output slots. */
export function validateSceneSections(scene:Pick<CompiledScene,'plan'|'sections'|'events'|'atMs'|'endMs'>){
  if(!Array.isArray(scene.sections)||scene.sections.length!==scene.plan.sections.length)throw Error('Invalid compiled section evidence');
  let cursor=scene.atMs;
  for(const [index,section] of scene.sections.entries()){
    if(section.id!==scene.plan.sections[index].id||section.fromMs!==cursor||!Number.isFinite(section.toMs)||section.toMs<=cursor||section.toMs>scene.endMs||!Array.isArray(section.speechIds))throw Error('Invalid compiled section evidence');
    const events=scene.events.filter(e=>e.atMs>=section.fromMs&&e.atMs<section.toMs);
    if(!events.length||events.some(e=>e.atMs+eventDurationMs(e)>section.toMs))throw Error('Compiled section crosses its event boundary');
    const expected=events.flatMap(e=>compileEvent(e).speech.map(s=>s.id));
    if(expected.length!==section.speechIds.length||expected.some((id,i)=>section.speechIds[i]!==id))throw Error('Compiled section must retain every required speech slot');
    cursor=section.toMs;
  }
  if(cursor!==scene.endMs||scene.events.some(e=>e.atMs<scene.atMs||e.atMs+eventDurationMs(e)>scene.endMs))throw Error('Compiled section does not cover its scene');
}

/** Only an uncommitted scene may move. Translate the whole measured composition;
 * never reschedule an expired cue or mutate already playing events. */
export function placePreparedScene<T extends CompiledScene>(scene:T,entryMs:number,phaseEndMs:number):T {
  const delta=entryMs-scene.atMs;
  if(!Number.isFinite(entryMs)||!Number.isFinite(phaseEndMs)||delta<0||scene.endMs+delta>phaseEndMs)throw Error('Prepared scene cannot fit its remaining parent phase');
  const placed=structuredClone(scene);
  const shiftState=(state:PresentationState|undefined)=>{
    // A baseline may refer to an earlier, already introduced animation.
    if(state?.motifMotion&&state.motifMotion.startMs>=scene.atMs&&state.motifMotion.startMs<=scene.endMs)state.motifMotion.startMs+=delta;
  };
  placed.atMs+=delta;placed.endMs+=delta;
  for(const event of placed.events){
    event.atMs+=delta;
    for(const state of [event.state,event.baseline,event.preparationState,event.fractionation?.stateA,event.fractionation?.stateB,event.blink?.openState,event.blink?.closedState,...(event.mantra?.perLoop??[]),...(event.softReturn?.steps.map(s=>s.state)??[])])shiftState(state);
  }
  for(const motif of placed.motifs)motif.firstIntroducedAtMs+=delta;
  for(const window of [...placed.responseWindows,...placed.responsePrompts,...placed.sections]){window.fromMs+=delta;window.toMs+=delta;}
  for(const window of placed.challenges??[]){window.fromMs+=delta;window.toMs+=delta;}
  return placed;
}
