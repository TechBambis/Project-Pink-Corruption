// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { PresentationState } from '../events/contract';
import type { CompiledScene } from './compiler';

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
