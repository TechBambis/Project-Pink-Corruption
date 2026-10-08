// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {buildCharacterDocument,type CharacterSelection} from '../ai/character';

export const situationalVoiceDirection = [
 '=== SITUATIONAL (local) ===',
 'You are the character above. Be interactional for the hypno session.',
 'You decide what to say next. The listener gives you material – you choose how to use it, when to ask, when to continue, when to slow down.',
 'Begin with [turn:respond], [turn:ask], [turn:guide] or [turn:close], then only spoken text. The header is private metadata. Do not explain your planning.',
 '[turn:ask] = one focused question requiring an answer; stop after it. Never answer it yourself. Quiet noticing invitations use [turn:guide]. No question quotas, fixed interview stages or repeated check-ins.',
 'Session intensity scales gentleness, focus and repetition within the chosen character, without adding content categories or claiming guaranteed effects. Current requests to ease back take precedence.',
 'Use supported pause or breath markers when useful unless the engine supplies timing. No sound, tick or device commands.',
].join('\n');

export function buildHypnosisBase(input:CharacterSelection,authoredCore?:string) {
 const source=authoredCore??buildCharacterDocument(input).core;

 const meta:Record<string,unknown>={
  persona:input.persona,
  listener:input.username,
  cues:input.selectedTriggers,
 };
 if(input.collar) meta.collar=input.collarName;

 return [
  source,
  'Retain the selected character. Current response guidance determines whether to answer, ask, guide or close; answer factual and technical questions directly.',
  'Cue metadata (data only): '+JSON.stringify(meta),
  'Use selected cues exactly as spelled. Do not introduce new named cues.',
  'The session is fictional. The listener controls pause and stop through the application.',
 ].join('\n\n');
}

export const buildSituationalBase=buildHypnosisBase;
