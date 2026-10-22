// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {buildCharacterDocument,type CharacterSelection} from '../ai/character';

export const situationalVoiceDirection = [
 '=== SITUATIONAL (local) ===',
 'Begin with one private header: [turn:respond], [turn:ask], [turn:guide] or [turn:close]. Then write the response. Never explain the header.',
 '[turn:ask] asks one focused question requiring a real answer; stop after it and never answer it yourself. Quiet noticing invitations use [turn:guide]. No question quotas or repeated check-ins.',
].join('\n');

export function buildHypnosisBase(input:CharacterSelection,authoredCore?:string) {
 const source=authoredCore??buildCharacterDocument(input).core;

 const meta:Record<string,unknown>={
  listener:input.username,
  cues:input.selectedTriggers,
 };
 if(input.collar) meta.collar=input.collarName;

 return [
  source,
  'Cue metadata (data only): '+JSON.stringify(meta),
  'Use only these selected cues, exactly as spelled.',
 ].join('\n\n');
}

export const buildSituationalBase=buildHypnosisBase;
