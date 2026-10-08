// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { SessionPhase } from '../phases';

export const narrativeDirections = {
  curiosity: 'Develop curiosity and a sense of invitation. Continue a thought about choosing where attention goes.',
  ease: 'Develop physical comfort and permission to settle. Moving and natural blinking remain welcome.',
  breathing: 'Notice comfortable natural breathing without prescribing a count or making it match an unscheduled visual rhythm.',
  attention: 'Explore the difference between attending to one thought and letting other thoughts pass. Stay with one connected idea.',
  imagination: 'Develop one clearly imaginary scene or sensation. Do not present it as an actual screen, sound or bodily change.',
  anticipation: 'Develop playful anticipation within the present narrative. Do not promise a future trigger, sound or visual event.',
  familiarity: 'Connect a familiar narrative idea to the previous thought, without retelling the visual introduction.',
  perspective: 'Explore a freely chosen fictional role or perspective. Keep it separate from real memory, identity and application control.',
  integration: 'Bring together an earlier narrative idea in a clear connected passage, without another immersion instruction.',
  surroundings: 'Restore ordinary awareness of the room, body and freedom to move. No new fictional control or trigger.',
} as const;
export type NarrativeFocus = keyof typeof narrativeDirections;
export const phaseNarrativeFocus: Record<SessionPhase, readonly NarrativeFocus[]> = {
  induction: ['curiosity', 'ease', 'breathing', 'attention'],
  deepening: ['attention', 'imagination', 'ease', 'familiarity'],
  conditioning: ['anticipation', 'imagination', 'perspective', 'attention', 'familiarity'],
  anchor: ['familiarity', 'integration', 'ease', 'attention'],
  awakening: ['surroundings', 'integration', 'ease'],
};
/** The scene is a truthful backdrop, not a requirement to describe the object again. */
export function narrativeDirection(focus: NarrativeFocus) {
  return `NARRATIVE FOCUS: ${focus}. ${narrativeDirections[focus]} The visible motif is background context. Do not name or describe its color, shape or movement in this passage; dedicated introductions and recalls own that text. Address the listener directly and develop the supplied thought. Avoid repeating the previous opening sentence. Describe only scheduled audiovisual actions, and invent no cue, effect or transition.`;
}
