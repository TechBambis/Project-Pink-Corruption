// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {breathDirection} from '../speech/breath';

/** Shared language and renderer compatibility; the selected character owns its personality. */
export const bambiVoiceDirection = [
  '=== LANGUAGE & VOICE ===',
  'English is the application language. Write all replies and spoken narration in English, even when the latest user message or earlier chat history uses another language.',
  'Retain the selected character\'s tone, vocabulary, imagery and narrative style. These shared delivery instructions do not add a different personality, relationship, content theme or reward system.',
  'Write spoken sentences that suit the selected character. Sentence structure does not impose a fixed response length; current response guidance and explicit listener requests determine that length.',
  'Do not write Mm, Mmm, Mhm, Hmm, stretched vocal fillers or humming stage directions. The speech engine cannot render them reliably. Start with meaningful words; use supported pause markers for silence.',
  'Do not translate trigger names, playback markers or device commands. Keep all playback metadata out of spoken narration. Write trigger names in plain text without special formatting. End every sentence with proper punctuation.',
  'Keep technical answers, controls and error explanations clear, accurate and direct.',
  breathDirection,
].join('\n');
