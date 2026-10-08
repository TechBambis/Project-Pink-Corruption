// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Engine-owned semantic cue recognition; only measured speech word positions are used. */
export function giggleOffset(words: readonly {word:string;atMs:number}[], text='') {
  if (/\b(?:don't|do not|stop|no|without)\s+(?:\w+\s+){0,2}(?:giggl\w*|laugh\w*|chuckl\w*)\b/i.test(text)) return undefined;
  const match=words.find(w=>/^(?:giggl\w*|laugh\w*|chuckl\w*)$/i.test(w.word.replace(/[^a-z]/gi,'')) && Number.isFinite(w.atMs) && w.atMs>=0);
  return match?.atMs;
}
