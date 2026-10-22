// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import type {SessionDirection} from './direction';
import type {SessionPhase} from './phases';
import type {spiralStyles} from './regie/registry';

export const journeyIds=['pink-cinema','velvet-drift','echo-ritual','mirror-story','clean-slate','breath-and-glow'] as const;
export type JourneyId=typeof journeyIds[number];
interface Journey {
  id:JourneyId;name:string;description:string;signature:string;
  arc:Record<SessionPhase,string>;variation:string;
  direction:Omit<SessionDirection,'regie'>;
  innerResponses:boolean;breathing:boolean;withdrawal:boolean;
  styles:(typeof spiralStyles)[number][];
}
/** Original creative briefs, not scripts or compulsory action sequences. */
export const sessionJourneys:Journey[]=[
  {id:'pink-cinema',name:'Pink cinema',description:'A turning heart, dramatic scene changes and a recurring pink answer.',signature:'Prepare the reveal → change the picture → return to the familiar heart.',
   arc:{induction:'Establish one turning heart and a concrete meaning from the starting idea.',deepening:'Use sparse and expansive versions of that same image. Prepare every reveal.',conditioning:'Develop the introduced meaning through contextual pink answers, permitted sleep-and-return contrasts and one earned visual highlight.',anchor:'Bring the familiar heart back with the phrase whose meaning has developed.',awakening:'Close the cinematic idea, reopen the eyes explicitly and return attention to the room.'},variation:'Change framing, surrounding spiral and spacing while preserving the heart identity. Avoid constant peaks and unrelated scenery.',
   direction:{contrast:.9,repetition:.65,rhythm:'expressive',motifs:'heart',theme:'imagination',mechanisms:['blink','fractionation','mindwipe','mantra','peak']},innerResponses:true,breathing:false,withdrawal:true,styles:['infinity','tunnel','vortex','prism']},
  {id:'velvet-drift',name:'Velvet drift',description:'Spacious voice, soft imagery and a slow, connected unfolding.',signature:'One image unfolds gently instead of a parade of effects.',
   arc:{induction:'Introduce a simple ring or soft imagined place and comfortable body support.',deepening:'Develop texture, distance and rhythm in that one image with room between thoughts.',conditioning:'Let a contextual idea unfold through restrained imagery and optional short inner answers.',anchor:'Recall the same image in its simplest, quietest form.',awakening:'Let the imagined image recede; invite open eyes and ordinary surroundings.'},variation:'Use fewer layers, longer quiet moments and changing perspective. Keep speech connected; do not fill every pause.',
   direction:{contrast:.3,repetition:.3,rhythm:'slow',motifs:'ring',theme:'ease',mechanisms:['mantra']},innerResponses:true,breathing:true,withdrawal:false,styles:['orb','loop','original']},
  {id:'echo-ritual',name:'Echo ritual',description:'A meaningful phrase returns with rhythm, variation and a quieter landing.',signature:'The same phrase changes meaning as the journey develops.',
   arc:{induction:'Choose one concise first-person phrase grounded in the starting idea; introduce why it matters.',deepening:'Revisit that exact phrase with pink previews and carefully spaced changes of rhythm.',conditioning:'Develop its meaning through a connected contrast and a brief optional rhythmic highlight.',anchor:'Repeat the familiar phrase in a much quieter composition.',awakening:'Close the ritual without demanding continued repetition; open the eyes and orient to the room.'},variation:'Preserve the core phrase; vary invitation, image, pace and context. Repetition must earn a new meaning, not become filler.',
   direction:{contrast:.7,repetition:.9,rhythm:'driving',motifs:'heart',theme:'attention',mechanisms:['fractionation','mantra','peak']},innerResponses:true,breathing:false,withdrawal:true,styles:['loop','infinity','vortex']},
  {id:'mirror-story',name:'Mirror story',description:'An imagined perspective develops through reflections and familiar callbacks.',signature:'Introduce a perspective → explore it → return with a changed image.',
   arc:{induction:'Introduce a fictional perspective and one visual motif connected to the user idea.',deepening:'Explore a contrast between imagined viewpoints without inventing listener facts.',conditioning:'Develop a small narrative turning point with optional inner answers and an original/old-self perspective.',anchor:'Recall the first image and show how its fictional meaning has changed.',awakening:'Close the fictional perspective, explicitly reopen the eyes and return to the actual room.'},variation:'Keep one coherent story and recurring motif. Avoid random fantasy settings, psychological diagnoses and permanent identity claims.',
   direction:{contrast:.65,repetition:.45,rhythm:'expressive',motifs:'mixed',theme:'perspective',mechanisms:['self','reset','mantra','fractionation']},innerResponses:true,breathing:false,withdrawal:true,styles:['prism','orb','infinity']},
  {id:'clean-slate',name:'Clean slate',description:'Name one thing to set aside, wipe that exact word and return to a clearer scene.',signature:'The wipe belongs to your concrete topic, never a generic label.',
   arc:{induction:'Find a concrete word in the starting idea or already heard speech and introduce a home motif.',deepening:'Give that named topic a specific imagined form and build a meaningful contrast.',conditioning:'When permitted, prepare a wipe using exactly that grounded topic, then reveal a simpler composition.',anchor:'Return to the original motif with a contextual first-person phrase about setting the topic aside for this session.',awakening:'End the temporary imagined reset; reopen the eyes and return to ordinary surroundings.'},variation:'Do not invent a problem, erase memories or use a generic distractions label. If no grounded topic or wipe sound is available, use a spoken transition and quiet contrast.',
   direction:{contrast:.8,repetition:.5,rhythm:'expressive',motifs:'heart',theme:'attention',mechanisms:['mindwipe','reset','mantra','fractionation']},innerResponses:true,breathing:false,withdrawal:true,styles:['tunnel','infinity','orb']},
  {id:'breath-and-glow',name:'Breath & glow',description:'Paced breathing, a gently expanding image and small moments of pink.',signature:'Voice, breath circle and image share the same measured rhythm.',
   arc:{induction:'Introduce the familiar image and invite an easy, unforced breathing pace.',deepening:'Use a few permitted paced in/out cycles, then return to connected speech and quiet.',conditioning:'Develop the starting idea through the image and optional short inner answers; return to breathing when it serves that idea.',anchor:'Recall the familiar image with fewer layers and an easy ordinary breath.',awakening:'Finish pacing, invite normal breathing, reopen the eyes and orient to the room.'},variation:'Alternate breathing with connected narration. No breath holds, forced large breaths or constant counting. When paced breathing is disabled, retain the soft image and spoken continuity.',
   direction:{contrast:.35,repetition:.4,rhythm:'slow',motifs:'ring',theme:'ease',mechanisms:['mantra']},innerResponses:true,breathing:true,withdrawal:false,styles:['orb','loop','original']},
];
export function journeyBrief(id:string,phase:SessionPhase){
  const journey=sessionJourneys.find(j=>j.id===id);
  return journey?{name:journey.name,signature:journey.signature,focus:journey.arc[phase],variation:journey.variation}:null;
}
export function journeyPreset(id:JourneyId,previous:SessionDirection):SessionDirection {
  const journey=sessionJourneys.find(j=>j.id===id)!;
  return {...previous,...structuredClone(journey.direction),regie:{...previous.regie,
    enabled:true,intent:previous.regie?.intent??'',journey:id,interactive:previous.regie?.interactive!==false,
    innerResponses:journey.innerResponses,breathing:journey.breathing,withdrawal:journey.withdrawal,
    styles:[...journey.styles],playfulRequests:previous.regie?.playfulRequests!==false,
  }};
}
