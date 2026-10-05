// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Match only the spoken word itself, using measured alignment, never draft text. */
export function pinkWordOffsets(words: readonly {word: string; atMs: number}[], durationMs = Infinity) {
  return [...new Set(words.filter(w => /^pink$/i.test(w.word.replace(/^[^a-z]+|[^a-z]+$/gi, '')) &&
    Number.isFinite(w.atMs) && w.atMs >= 0 && w.atMs < durationMs).map(w => w.atMs))].sort((a, b) => a - b);
}
