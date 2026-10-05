// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { SessionPhase } from './phases';

export const narrationPauses: Record<SessionPhase, number> = {
  induction: 4, deepening: 5, conditioning: 6, anchor: 4, awakening: 8,
};

/** Session-clock scheduling: playback completion arms the next passage, not LLM completion. */
export class NarrationFlow {
  private revision = 0;
  private due: number | null = null;
  private inFlight = false;
  private awaitingAnswer = false;

  start(time: number) { this.cancel(); this.due = time; }
  cancel() { this.revision++; this.due = null; this.inFlight = false; this.awaitingAnswer = false; }
  valid(ticket: number) { return ticket === this.revision && this.inFlight; }
  defer(time: number, pause: number) {
    if (this.awaitingAnswer) return;
    this.cancel(); this.due = time + this.delay(pause);
  }
  turnStarted() { this.cancel(); this.inFlight = true; }
  completed(time: number, pause: number, awaitingAnswer = false) {
    if (!this.inFlight) return;
    this.inFlight = false;
    this.awaitingAnswer = awaitingAnswer;
    this.due = awaitingAnswer ? null : time + this.delay(pause);
  }
  next(time: number, duration: number, ready: boolean): number | null {
    if (time >= duration) { this.cancel(); return null; }
    if (!ready || this.inFlight || this.due === null || time < this.due) return null;
    this.due = null; this.inFlight = true; this.revision++;
    return this.revision;
  }
  private delay(seconds: number) { return Number.isFinite(seconds) ? Math.min(30, Math.max(0, seconds)) : 4; }
}

export function narrationDirective(phase: SessionPhase, first: boolean, remainingSeconds: number) {
  return [
    first ? 'Begin the selected session with a complete opening passage.' : 'Continue the selected session from the last heard passage. Do not restart or repeat a welcome.',
    `Current phase: ${phase}. Remaining session time: ${Math.max(0, Math.ceil(remainingSeconds))} seconds.`,
    'This is continuous narration chosen by the listener. Do not ask questions that require a reply. Silence provides no information about the listener, their presence, agreement or state.',
    phase === 'awakening' ? 'Give a clear closing passage and reorientation. The session ends at its configured duration; do not promise another passage or a loop.' : 'Keep the passage within the current phase. The app controls playback, pauses and the session end.',
  ].join('\n');
}
