// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { sceneNames } from '../../safety/actions';
import type { SessionDirection } from '../direction';
import type { SessionPhase } from '../phases';

/** These cards describe owned engine capabilities, not fixed episode sequences. */
export const capabilities = [
  { id: 'guide', purpose: 'Develop one connected idea; introduce an image or prepare a later action.' },
  { id: 'hold', purpose: 'Remove narration and independently thin picture/ambient sound; allow contrast and recovery.' },
  { id: 'reply', purpose: 'Invite a contextual first-person inner answer; preview its exact text in pink before the answer and protect listening input.' },
  { id: 'challenge', purpose: 'Playfully negotiate a requested scene: give a contextual condition and pink response phrase, then listen for a REAL answer before judging whether to grant, motivate another attempt, or resume the original journey.' },
  { id: 'breath', purpose: 'Use the existing paced breathing circle and optional air sound with measured In / And out voice cues, without forced holds.' },
  { id: 'wipe', purpose: 'Erase a specifically named, grounded mental target using the selected wiper recording and its centered label.' },
  { id: 'sleep_return', purpose: 'Selected snap with the exact sleep cue, picture withdrawal, then an explicit spoken eye reopening as the scene returns.' },
  { id: 'trigger', purpose: 'Choose an eligible selected trigger phrase, prepare its contextual meaning and align the original snap with its measured word. Wiper-associated phrases need the same grounded target as a wipe.' },
  { id: 'contrast', purpose: 'Alternate narrow and expanded compositions with complete spoken thoughts; retain continuity across both.' },
  { id: 'repeat', purpose: 'Recur to one contextual inner-answer phrase, with the same pink text and measured spacing.' },
  { id: 'peak', purpose: 'Build a brief foreground climax with a chosen motif and optional selected rhythmic sound; require quieter recovery.' },
  { id: 'recall', purpose: 'Return to an actually introduced motif and its established meaning, rather than introducing unrelated imagery.' },
  { id: 'reset', purpose: 'Close a narrative chapter and set a fresh starting point while preserving orientation.' },
  { id: 'self', purpose: 'Use Original/Old Self as an imagined narrative perspective, never a computer operating system.' },
  { id: 'blink', purpose: 'A measured spoken eye cue followed by explicit reopening; selected sounds only.' },
] as const;
export const moduleIds = capabilities.map(c => c.id) as [typeof capabilities[number]['id'], ...typeof capabilities[number]['id'][]];
export const spiralStyles = ['original','vortex','infinity','prism','orb','tunnel','loop','fractal'] as const;
export const PoolSchema = z.object({
  modules: z.array(z.enum(moduleIds)).min(1).max(moduleIds.length),
  scenes: z.array(z.enum(sceneNames)).min(1).max(sceneNames.length),
  motifs: z.array(z.enum(['ring','heart','gears'])).max(3),
  styles: z.array(z.enum(spiralStyles)).max(spiralStyles.length),
  mainVoice: z.boolean(), innerVoice: z.boolean(), visuals: z.boolean(), reducedMotion: z.boolean(),
  playfulRequests:z.boolean().default(true), breathing:z.boolean().default(false),
  sounds: z.object({ wiper:z.boolean(), snap:z.boolean(), rhythm:z.boolean() }).strict(),
  triggers: z.array(z.string().trim().min(1).max(100)).max(64),
}).strict().superRefine((pool, ctx) => {
  for (const values of [pool.modules,pool.scenes,pool.motifs,pool.styles,pool.triggers]) if(new Set(values).size!==values.length) ctx.addIssue({code:'custom',message:'Pool entries must be unique'});
});
export type RegiePool = z.infer<typeof PoolSchema>;
export function availableModules(pool:RegiePool, phase:SessionPhase) {
  return capabilities.filter(c => pool.modules.includes(c.id)).filter(c => {
    if (phase==='awakening' && !['guide','hold','recall'].includes(c.id)) return false;
    if (c.id==='hold') return true;
    if (!pool.mainVoice) return false;
    if(c.id==='challenge'&&!pool.playfulRequests)return false;
    if(c.id==='breath'&&!pool.breathing)return false;
    if (['reply','repeat'].includes(c.id) && !pool.innerVoice) return false;
    if (c.id==='wipe' && (!pool.visuals || !pool.sounds.wiper)) return false;
    if (c.id==='sleep_return' && (!pool.sounds.snap || !pool.triggers.some(t=>t.toUpperCase()==='BAMBI SLEEP'))) return false;
    if(c.id==='trigger'&&!pool.triggers.some(t=>!['BAMBI SLEEP','BLINK'].includes(t.toUpperCase())))return false;
    if (c.id==='blink' && !pool.triggers.includes('Blink')) return false;
    return true;
  });
}
export function directionPool(direction:SessionDirection, access:Omit<RegiePool,'modules'|'scenes'|'motifs'|'styles'|'playfulRequests'|'breathing'>&Partial<Pick<RegiePool,'playfulRequests'|'breathing'>>):RegiePool {
  const enabled = new Set<string>(direction.mechanisms);
  const visuals=access.visuals&&(direction.regie?.scenes?.length??1)>0;
  const mapping:Partial<Record<typeof moduleIds[number],string>>={wipe:'mindwipe',sleep_return:'fractionation',contrast:'fractionation',repeat:'mantra',peak:'peak',reset:'reset',self:'self',blink:'blink'};
  return PoolSchema.parse({...access,playfulRequests:(access.playfulRequests??true)&&direction.regie?.playfulRequests!==false&&direction.regie?.interactive!==false,breathing:!!access.breathing&&direction.regie?.breathing!==false,visuals,modules:moduleIds.filter(id=>(!mapping[id]||enabled.has(mapping[id]!))&&(id!=='sleep_return'||direction.regie?.withdrawal!==false)),
    scenes:visuals?(direction.regie?.scenes??[...sceneNames]):['Audio Only'], motifs:visuals?(direction.motifs==='mixed'?['ring','heart','gears']:[direction.motifs]):[], styles:visuals?(direction.regie?.styles??[...spiralStyles]):[]});
}

/** Original composition rules distilled from existing private reference analyses. */
export const compositionCards = [
  'Introduce a motif and its meaning before recalling it; preserve identity while changing scale, motion and surrounding layers.',
  'Prepare important changes with a complete thought and a pause. Use strong contrast in occupancy, not continuous maximum effect density.',
  'Treat narration spacing, visual density, motion, ambient level and effects gain as separate decisions.',
  'An inner answer belongs to the listener. Its exact contextual phrase is both the large pink preview and the spoken answer.',
  'Use the original selected wipe and snap recordings. Wipe a named contextual target; never substitute an unrelated generic label.',
  'Build peaks through preparation and repetition, then remove lanes for recovery. Feedback may change the future approach and imagery.',
] as const;
