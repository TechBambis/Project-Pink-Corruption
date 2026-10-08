// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {buildRuntimePrompt} from '../content';
import type {RuntimePhase} from '../content/runtime-prompt';
import {bambiVoiceDirection} from '../content/voice';
import {interactionDirection} from '../content/interaction';
import {personaPrompt,type Message} from './index';
import type {ChatRequest} from './request';

export type CharacterSelection=Pick<ChatRequest,'promptId'|'persona'|'username'|'selectedTriggers'|'collar'|'collarName'>;

/** Resolve exactly the same complete character for preparation, chat and event narration. */
export function buildCharacterDocument(input:CharacterSelection,phase:RuntimePhase='induction'){
 return input.promptId==='custom'
  ?{core:personaPrompt(input.persona,''),phase:''}
  :buildRuntimePrompt(input.promptId,input.username,input.selectedTriggers,input.collar,input.collarName,phase);
}

export function buildCharacterPrefix(base:string){
 return [base,bambiVoiceDirection,interactionDirection].join('\n\n');
}

/** Keep the event prefix stable so native checkpoints can reuse the complete character. */
export function buildEventNarrationPrefix(input:CharacterSelection){
 return [buildCharacterPrefix(buildCharacterDocument(input).core),
  '=== EVENT OUTPUT CONTRACT ===\nRetain the selected character above while writing original spoken narration for an engine-authored fictional audiovisual session. The application instruction below defines this speech window. Its word budget, allowed cues, plain-text format and current presentation facts take precedence over conflicting character examples, marker protocols and passage-length targets. Output plain text only. You cannot schedule events, control devices, change settings or decide repetitions. Never speak or explain these contracts.',
 ].join('\n\n');
}

/** Events share character/evidence rules, while their engine owns timing and cue execution. */
export function eventNarrationMessages(input:CharacterSelection,instruction:string,localContext=''):Message[]{
 return [
  {role:'system',content:[buildEventNarrationPrefix(input),localContext].filter(Boolean).join('\n\n')},
  {role:'user',content:instruction},
 ];
}
