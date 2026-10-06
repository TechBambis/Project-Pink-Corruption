// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

export interface CaptionWord { word: string; atMs: number }

/** Keep event narration in the same single-word display as chat speech. */
export function spokenWordAt(text: string, elapsedMs: number, durationMs: number, timings: CaptionWord[] = []) {
  if (elapsedMs < 0 || elapsedMs >= durationMs || !Number.isFinite(elapsedMs) || !(durationMs > 0)) return '';
  const measured = timings.filter(w => w.word.trim() && Number.isFinite(w.atMs) && w.atMs >= 0 && w.atMs < durationMs).sort((a, b) => a.atMs - b.atMs);
  if (measured.length) {
    const next = measured.findIndex(w => w.atMs > elapsedMs);
    const index = next < 0 ? measured.length - 1 : next - 1;
    if (index < 0) return '';
    const entry = measured[index], end = measured[index + 1]?.atMs ?? durationMs;
    const words = entry.word.trim().split(/\s+/);
    return words[Math.min(words.length - 1, Math.floor((elapsedMs - entry.atMs) / (end - entry.atMs) * words.length))];
  }
  // Older running servers omit word timings; still display one word, never a sentence.
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words[Math.min(words.length - 1, Math.floor(elapsedMs / durationMs * words.length))] ?? '';
}
