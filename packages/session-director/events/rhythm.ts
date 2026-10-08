// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { BambiEvent } from './contract';

/** A stable four-beat identity; tempo variation changes spacing, never the phrase. */
export function rhythmBeats(event: BambiEvent) {
  const rhythm = event.rhythm;
  if (!rhythm) return [];
  const beats: { atMs: number; kind: 'pulse_a' | 'pulse_b' }[] = [];
  let offset = rhythm.offsetMs;
  while (offset < rhythm.untilMs && beats.length < 256) {
    const index = beats.length, progress = (offset - rhythm.offsetMs) / (rhythm.untilMs - rhythm.offsetMs);
    beats.push({ atMs: event.atMs + offset, kind: index % 4 === 3 ? 'pulse_b' : 'pulse_a' });
    offset += rhythm.stepMs + ((rhythm.endStepMs ?? rhythm.stepMs) - rhythm.stepMs) * progress;
  }
  return beats;
}
