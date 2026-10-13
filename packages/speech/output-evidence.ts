// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { speechTextAt } from './reveal';
export interface OutputWord { word: string; atMs: number; endMs?: number }
export interface OutputOccurrence {
  id: string; requestId: string; epoch: number; text: string;
  sessionStartMs: number; audioStartSeconds: number; durationMs: number; words: OutputWord[];
}
export interface OutputProjection {
  occurrenceId: string; requestId: string; epoch: number; elapsedMs: number;
  sessionStartMs: number; audioStartSeconds: number; durationMs: number; historyEnd: number;
  evidence: 'output-clock-estimate'; caption: string; history: string;
  statements: string[];
}
/** Onset is display evidence only. Without word ends, wait for the whole WAV.
 * Output clocks estimate device delivery; neither projection proves perception. */
export function projectOutput(occurrence: OutputOccurrence, elapsedMs: number): OutputProjection {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(-1, elapsedMs) : -1;
  let end = 0, cursor = 0;
  if (elapsed >= occurrence.durationMs) end = occurrence.text.length;
  else if (elapsed >= 0) for (const word of occurrence.words) {
    const index = occurrence.text.indexOf(word.word, cursor);
    if (index < 0 || !Number.isFinite(word.endMs) || word.endMs! < word.atMs || word.endMs! > occurrence.durationMs || word.endMs! > elapsed) break;
    cursor = index + word.word.length; end = cursor;
    // Attach punctuation only after a completed word, never the following word.
    while (end < occurrence.text.length && /[.!?,;:'"”’]/.test(occurrence.text[end])) end++;
    cursor = end;
  }
  const history = occurrence.text.slice(0, end);
  return { occurrenceId: occurrence.id, requestId: occurrence.requestId, epoch: occurrence.epoch,
    elapsedMs: elapsed, sessionStartMs:occurrence.sessionStartMs, audioStartSeconds:occurrence.audioStartSeconds, durationMs:occurrence.durationMs, historyEnd:end, evidence: 'output-clock-estimate',
    caption: speechTextAt(occurrence.text, elapsed, occurrence.durationMs, occurrence.words), history,
    statements: (history.match(/[^.!?]+[.!?]+(?:["”'])?/g) ?? []).map(s => s.trim()) };
}
/** Bounded local diagnostics. Epoch changes prevent old work from being projected. */
export class OutputEvidence {
  private occurrences = new Map<string, OutputOccurrence>();
  private projections = new Map<string, OutputProjection>();
  constructor(private epoch = 0, readonly cap = 64) { if (!Number.isInteger(cap) || cap < 1 || cap > 128) throw Error('Invalid evidence cap'); }
  schedule(occurrence: OutputOccurrence) {
    if (occurrence.epoch !== this.epoch) return false;
    if (!occurrence.id || !occurrence.requestId || occurrence.text.length > 6000 || occurrence.words.length > 500 || !Number.isFinite(occurrence.durationMs) || occurrence.durationMs <= 0 || !Number.isFinite(occurrence.audioStartSeconds) || !Number.isFinite(occurrence.sessionStartMs)) throw Error('Invalid output occurrence');
    if (this.occurrences.has(occurrence.id)) return false;
    while (this.occurrences.size >= this.cap) { const id = this.occurrences.keys().next().value!; this.occurrences.delete(id); this.projections.delete(id); }
    this.occurrences.set(occurrence.id, structuredClone(occurrence)); return true;
  }
  sample(id: string, outputTimeSeconds: number, epoch: number) {
    const occurrence = this.occurrences.get(id);
    if (!occurrence || epoch !== this.epoch || !Number.isFinite(outputTimeSeconds)) return undefined;
    const elapsed = (outputTimeSeconds - occurrence.audioStartSeconds) * 1000;
    const previous = this.projections.get(id);
    const next = projectOutput(occurrence, Math.max(previous?.elapsedMs ?? -1, elapsed));
    this.projections.set(id, next); return next;
  }
  snapshot() { return [...this.projections.values()].map(p => structuredClone(p)); }
  reset(epoch: number) { this.epoch = epoch; this.occurrences.clear(); this.projections.clear(); }
}
