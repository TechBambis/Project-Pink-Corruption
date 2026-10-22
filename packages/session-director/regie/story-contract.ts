// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import {z} from 'zod';
import {availableModules,PoolSchema} from './registry';
import {requestedBreathCycles} from '../../speech/breath';
import type {PlanningContext} from './plan';

export const storyBeats=['introduce','explore','exchange','contrast','return','close','adapt'] as const;
export const StoryMomentSchema=z.object({journey:z.literal('pink-cinema'),beat:z.enum(storyBeats),step:z.number().int().min(0).max(1023),generation:z.number().int().min(0).max(1000000),motifId:z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),meaning:z.string().min(1).max(160)}).strict();
export type StoryMoment=z.infer<typeof StoryMomentSchema>;
export const StoryPresentationSchema=z.object({visualDensity:z.number().min(0).max(1),motion:z.number().min(0).max(1),ambient:z.number().min(0).max(1)}).strict();
export function storyPresentation(look:z.infer<typeof StoryPresentationSchema>){return {visualDensity:look.visualDensity,motion:look.motion,ambient:look.ambient};}
const StoryReceiptSchema=StoryMomentSchema.extend({utterances:z.array(z.string().min(1).max(300)).min(1).max(3).optional(),presentation:StoryPresentationSchema.optional()}).strict();
const counts=Object.fromEntries(storyBeats.map(beat=>[beat,z.number().int().min(0).max(1024).default(0)])) as Record<typeof storyBeats[number],z.ZodDefault<z.ZodNumber>>;
export const StoryProgressSchema=z.object({
 generation:z.number().int().min(0).max(1000000),completed:z.object(counts).strict(),
 committed:z.array(StoryReceiptSchema).max(4),
 associations:z.array(StoryReceiptSchema).max(12),
 adaptedGeneration:z.number().int().min(-1).max(1000000),
 presentation:StoryPresentationSchema.nullable().default(null),
 interrupted:StoryMomentSchema.nullable(),
}).strict();
export type StoryProgress=z.infer<typeof StoryProgressSchema>;
export function emptyStoryProgress(generation=0):StoryProgress{return {generation,completed:Object.fromEntries(storyBeats.map(id=>[id,0])) as StoryProgress['completed'],committed:[],associations:[],adaptedGeneration:-1,presentation:null,interrupted:null};}
export const storyMeanings:Record<StoryMoment['beat'],string>={introduce:'The heart marks a place for the chosen idea.',explore:'There is room around the same heart.',exchange:'An imagined inner perspective can question the image.',contrast:'The same image can remain while its surroundings recede.',return:'The familiar image carries its earlier associations together.',close:'The imagined scene closes and ordinary surroundings return.',adapt:'Respond to the current listener direction before resuming the story.'};

/** Engine selection only. Reservations describe preceding future scenes, never
 * output evidence. No beat is inferred from the model's prose. */
export function nextStoryMoment(c:PlanningContext):StoryMoment|null{
 if(c.journey!=='pink-cinema'||!c.pool.mainVoice||!c.pool.visuals||!c.pool.motifs.includes('heart')||c.interaction)return null;
 const legal=new Set(availableModules(PoolSchema.parse(c.pool),c.phase).map(m=>m.id));if(!legal.has('guide'))return null;
 // Preserve the existing exact-cycle and real-listening paths.
 const requested=requestedBreathCycles(c.feedback||c.userContext);
 if(requested!==undefined&&requested>(c.breathCyclesAlreadyCommitted??0))return null;
 const state=StoryProgressSchema.parse(c.story??emptyStoryProgress()),counts={...state.completed};
 for(const moment of state.committed)if(moment.generation===state.generation)counts[moment.beat]=Math.max(counts[moment.beat],moment.step+1);
 const adapted=state.adaptedGeneration===state.generation||state.committed.some(m=>m.beat==='adapt'&&m.generation===state.generation);
 let beat:StoryMoment['beat'];
 if(c.phase==='awakening')beat='close';
 else if(c.feedback.trim()&&!adapted)beat='adapt';
 else if(!counts.introduce)beat='introduce';
 else if(c.phase==='anchor')beat='return';
 else if(c.phase==='conditioning')beat=!counts.exchange||(counts.contrast+counts.exchange)%3===0?'exchange':'contrast';
 else if(c.phase==='deepening'&&counts.explore>=2)beat=(counts.explore+counts.exchange)%3===2?'exchange':'explore';
 else beat='explore';
 const motifId=state.associations.find(m=>m.beat==='introduce')?.motifId??state.committed.find(m=>m.beat==='introduce')?.motifId??c.knownMotifs.find(m=>m.form==='heart')?.id??c.committedMotifs?.find(m=>m.form==='heart')?.id??'story-heart';
 if(counts[beat]>=1024)throw Error('Story moment limit reached.');
 return {journey:'pink-cinema',beat,step:counts[beat],generation:state.generation,motifId,meaning:storyMeanings[beat]};
}
