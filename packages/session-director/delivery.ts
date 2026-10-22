// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { sessionPhaseAt, phaseStarts, sessionPhases, type SessionPhase } from './phases';

export const deliveryModes = ['guide', 'settle', 'drive', 'hold', 'return'] as const;
export type DeliveryMode = typeof deliveryModes[number];
export interface DeliveryProfile {
  speedMultiplier: number;
  phrasePauseMs: number;
  passageWords: number;
  pauseMultiplier: number;
  syntax: string;
  visualStyle: 'orb' | 'loop' | 'tunnel' | 'vortex';
  visualSpeed: number;
  visualOpacity: number;
  mix: { drone: number; noise: number; support: number; effects: number };
}

/** Original delivery choices informed by reference contrast, not copied source timings. */
export const deliveryProfiles: Record<DeliveryMode, DeliveryProfile> = {
  guide: { speedMultiplier: 1, phrasePauseMs: 350, passageWords: 75, pauseMultiplier: 1,
    syntax: 'Connected clear sentences, usually 6–12 words. Develop one idea.',
    visualStyle: 'loop', visualSpeed: .3, visualOpacity: .8, mix: { drone: .65, noise: .55, support: .5, effects: .8 } },
  settle: { speedMultiplier: .9, phrasePauseMs: 650, passageWords: 50, pauseMultiplier: 1.5,
    syntax: 'Spacious connected sentences, usually 7–14 words. Leave room for the listener.',
    visualStyle: 'orb', visualSpeed: .18, visualOpacity: .65, mix: { drone: .5, noise: .35, support: .25, effects: .6 } },
  drive: { speedMultiplier: 1.35, phrasePauseMs: 140, passageWords: 85, pauseMultiplier: .55,
    syntax: 'Tighter rhythmic clauses, usually 3–7 words. Maintain a clear foreground; no new unscheduled cues.',
    visualStyle: 'vortex', visualSpeed: .55, visualOpacity: 1, mix: { drone: .85, noise: .65, support: .65, effects: .9 } },
  hold: { speedMultiplier: .86, phrasePauseMs: 900, passageWords: 35, pauseMultiplier: 1.8,
    syntax: 'One simple idea in short complete phrases, usually 2–5 words. Reduce semantic complexity.',
    visualStyle: 'orb', visualSpeed: .12, visualOpacity: .35, mix: { drone: .25, noise: .15, support: .15, effects: .45 } },
  return: { speedMultiplier: .96, phrasePauseMs: 500, passageWords: 150, pauseMultiplier: 1.2,
    syntax: 'Clear connected reorientation, usually 7–14 words. Restore ordinary surroundings and freedom to move.',
    visualStyle: 'loop', visualSpeed: .22, visualOpacity: .65, mix: { drone: .35, noise: .2, support: .15, effects: .5 } },
};

/** Microstates remain inside the fixed five phases. Select once per heard passage. */
export function narrationDeliveryAt(time: number, duration: number): DeliveryMode {
  const current = sessionPhaseAt(time, duration);
  const elapsed = Math.max(0, time - duration * phaseStarts[sessionPhases.indexOf(current.phase)]);
  if (current.phase === 'awakening') return 'return';
  if (current.phase === 'induction') return current.progress < .3 ? 'settle' : 'guide';
  if (current.phase === 'anchor') return current.progress < .5 ? 'hold' : 'guide';
  const sequence: DeliveryMode[] = current.phase === 'deepening' ? ['settle', 'guide', 'hold', 'guide'] : ['guide', 'drive', 'hold', 'guide', 'settle', 'drive'];
  return sequence[Math.floor(elapsed / 45) % sequence.length];
}

export function deliverySpeed(base: number, mode: DeliveryMode) {
  return Math.min(1.5, Math.max(.5, base * deliveryProfiles[mode].speedMultiplier));
}

export function eventDelivery(mode: string, phase: SessionPhase): DeliveryMode {
  if (phase === 'awakening') return 'return';
  return mode === 'fragment' ? 'hold' : mode === 'mantra' ? 'settle' : 'guide';
}

export function deliveryWordBudget(mode: DeliveryMode, remainingSeconds = Infinity) {
  return Math.max(1, Math.min(deliveryProfiles[mode].passageWords, Math.floor(Math.max(0, remainingSeconds - 8) * 1.1)));
}

export function deliveryDirection(mode: DeliveryMode, visuals = false, words = deliveryProfiles[mode].passageWords, includeBudget = true) {
  const profile = deliveryProfiles[mode];
  const appearance = profile.visualStyle === 'orb' ? 'a softly glowing pink orb with slow gentle breathing movement' : profile.visualStyle === 'vortex' ? 'a pink rotating spiral with denser inward movement' : 'a pink repeating spiral with gentle movement';
  return `ENGINE DELIVERY CONTRACT: ${mode}. ${includeBudget?`Supply one original connected passage of about ${Math.max(1, words - 15)}–${words} spoken words TOTAL. This engine budget overrides full-passage word targets. `:''}${profile.syntax} The engine renders the selected speech speed, phrase gaps and passage pause. Do not output pause or breath markers, effect/device commands, timings or new named triggers. ${visuals ? `The engine presents ${appearance} when this passage becomes audible. You may describe this current image.` : 'Do not describe visible movement, a changing light or a screen transition; visuals may be manual, reduced or disabled.'} Frame other imagery as imagination. Do not promise future audiovisual changes. Finish the current thought within this budget.`;
}

/** Explicit timing tags cannot override this engine-owned delivery window. */
export function deliveryText(text: string) {
  return text.replace(/\[pause:(?:\d+|normal|short|medium|long|transition)\]|\[PAUSE\]|\[SFX:PAUSE_(?:5|10)\]/gi, ' ');
}
