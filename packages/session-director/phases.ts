// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { clamp } from '../safety/actions';

export const sessionPhases = ['induction', 'deepening', 'conditioning', 'anchor', 'awakening'] as const;
export type SessionPhase = typeof sessionPhases[number];
export const phaseStarts = [0, .24, .4, .8, .9] as const;

/** Shared by presentation and AI metadata, including during conversation and seeking. */
export function sessionPhaseAt(elapsed: number, duration: number) {
  const progress = clamp(elapsed / clamp(duration, 1, 86400));
  const index = phaseStarts.reduce<number>((best, start, index) => progress >= start ? index : best, 0);
  return { phase: sessionPhases[index], progress: clamp((progress - phaseStarts[index]) / ((phaseStarts[index + 1] ?? 1) - phaseStarts[index])) };
}
