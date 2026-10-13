// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import type { EpisodeRecipe } from './events/episodes';
import { EventSchema, type BambiEvent, type SpeechSpec } from './events/contract';
import { deliveryProfiles } from './delivery';
import { spiralStyles } from './regie/registry';
import { sceneNames } from '../safety/actions';
import {journeyIds} from './journeys';

export const directionMechanisms = ['blink', 'fractionation', 'mindwipe', 'reset', 'self', 'mantra', 'peak'] as const;
export const DirectionSchema = z.object({
  contrast: z.number().finite().min(0).max(1),
  repetition: z.number().finite().min(0).max(1),
  rhythm: z.enum(['expressive', 'slow', 'driving']),
  motifs: z.enum(['mixed', 'ring', 'heart', 'gears']),
  theme: z.enum(['varied', 'attention', 'imagination', 'perspective', 'ease']),
  mechanisms: z.array(z.enum(directionMechanisms)).max(directionMechanisms.length),
  regie:z.object({enabled:z.boolean(),innerResponses:z.boolean(),intent:z.string().max(800),withdrawal:z.boolean().optional(),
    playfulRequests:z.boolean().optional(),breathing:z.boolean().optional(),interactive:z.boolean().optional(),journey:z.enum([...journeyIds,'custom']).optional(),
    scenes:z.array(z.enum(sceneNames)).max(sceneNames.length).optional(),styles:z.array(z.enum(spiralStyles)).max(spiralStyles.length).optional()}).strict().optional(),
}).strict();
export type SessionDirection = z.infer<typeof DirectionSchema>;
const base: SessionDirection = { contrast: .5, repetition: .5, rhythm: 'expressive', motifs: 'mixed', theme: 'varied', mechanisms: [...directionMechanisms] };

/** Original engine compositions. Influence metadata is separate from voice identity. */
export const sessionDirections = [
  { id: 'balanced', name: 'Balanced', description: 'Varied scenes, expressive narration and room between peaks.', influence: null, settings: base },
  { id: 'reference-contrast', name: 'Reference contrast', description: 'Sparse holds, sharper A/B switches and staged peaks.', influence: 'Tom Tame-inspired audiovisual structure; original presentation.', settings: { ...base, contrast: .9, repetition: .65 } },
  { id: 'velvet', name: 'Slow immersion', description: 'Spacious narration, restrained imagery and a gradual build.', influence: null, settings: { ...base, contrast: .65, repetition: .35, rhythm: 'slow', motifs: 'ring' } },
  { id: 'driving', name: 'Rhythmic immersion', description: 'Tighter passages and more recurring anchors, with quieter recovery.', influence: null, settings: { ...base, contrast: .7, repetition: .8, rhythm: 'driving' } },
] as const;
export function directionPreset(id: string): SessionDirection {
  return DirectionSchema.parse(structuredClone(sessionDirections.find(style => style.id === id)?.settings ?? base));
}
export function normalizeDirection(value: unknown): SessionDirection {
  const parsed = DirectionSchema.safeParse(value);
  return parsed.success ? parsed.data : directionPreset('balanced');
}
export function directionRejection(recipe: EpisodeRecipe, direction: SessionDirection): string | undefined {
  if ((directionMechanisms as readonly string[]).includes(recipe) && !direction.mechanisms.includes(recipe as typeof directionMechanisms[number])) return 'disabled session mechanism';
  if ((recipe === 'heart' || recipe === 'gears') && direction.motifs !== 'mixed' && recipe !== direction.motifs) return 'selected visual motif';
}
export function directionScore(recipe: EpisodeRecipe, direction: SessionDirection) {
  const recurring = ['mantra', 'fractionation', 'recall'].includes(recipe);
  const sparse = ['quiet', 'dark_hold', 'return'].includes(recipe);
  const layered = ['fractionation', 'peak'].includes(recipe);
  return (recurring ? (direction.repetition - .5) * 1.4 : 0)
    + (direction.contrast - .5) * (sparse ? 1.2 : layered ? .6 : 0);
}

/** Tune an uncommitted grammar without changing event boundaries or blank ownership. */
export function directEpisode(event: BambiEvent, direction: SessionDirection): BambiEvent {
  const tune = (speech: SpeechSpec) => {
    if (speech.mode === 'silent' || speech.fixedText || speech.fixedCue) return;
    const paceEligible = speech.mode === 'narrate' && event.phase !== 'awakening';
    if (paceEligible && direction.rhythm === 'slow') speech.delivery = 'settle';
    if (paceEligible && direction.rhythm === 'driving' && ['deepening', 'conditioning'].includes(event.phase)) speech.delivery = 'drive';
    if (paceEligible && speech.delivery) speech.wordTarget = Math.max(1, Math.floor(speech.targetMs / 1000 * 1.2 * deliveryProfiles[speech.delivery].speedMultiplier));
  };
  tune(event.speech);
  const fraction = event.fractionation;
  if (fraction) {
    tune(fraction.speechA); tune(fraction.speechB);
    fraction.transitionMs = Math.round(1500 - direction.contrast * 1000);
    fraction.stateA.density.visualDensity = .12 - .08 * direction.contrast;
    fraction.stateA.density.effectDensity = .12 - .08 * direction.contrast;
    fraction.stateB.density.visualDensity = .3 + .5 * direction.contrast;
    fraction.stateB.density.effectDensity = .25 + .5 * direction.contrast;
  }
  if (event.type === 'peak') {
    event.state.density.effectDensity = .45 + .4 * direction.contrast;
    event.state.density.visualDensity = .45 + .4 * direction.contrast;
  }
  return EventSchema.parse(event);
}
