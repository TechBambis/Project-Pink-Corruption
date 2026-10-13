// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {dualVoiceDirection} from '../content/dual-voice';
import {scriptFormatDirection,scriptSoundDirection,scriptCommandDirection} from '../content/script-direction';
import {appendSoundDirection} from '../content/sound-direction';
import {appendPhasePrompt} from '../content/phases';
import {appendSessionState,type SessionState} from './session-state';
import {buildCharacterPrefix} from './character';
import {narrationLengthDirection,replyTaskDirection,replyTaskContract} from './response';
import {situationalVoiceDirection} from '../content/situational';
import {situationalReplyDirection} from './situational';
import type {Interaction} from './request';
import {conversationDirection,type ConversationTopic} from '../content/conversation';

/** Flags belong after this prefix: changing them must not invalidate its recurrent state. */
export function buildFixedReplyPrompt(base:string,interaction:Interaction='reactive'){
 return [buildCharacterPrefix(base),scriptFormatDirection,...(interaction==='situational'?[situationalVoiceDirection]:[replyTaskContract])].join('\n\n');
}

/** Keep the full fixed instructions before changing state so inference can reuse its prefix. */
export function buildReplyPrompt(base:string,request:string,soundDesign:boolean,deviceDirection:string,session?:SessionState,playbackContext='',dialogue=false,narration=!dialogue,interaction:Interaction='reactive',conversationContext='',dualVoice=false,conversationTopic:ConversationTopic='general'){
 const fixed=buildFixedReplyPrompt(base,interaction);
 if(interaction==='situational')return [fixed,
  'Use only the single turn header and supported pause or breath markers, plus voice markers when Dual Voice is enabled. Sound, tick and device commands and actions are disabled in situational conversation.',
  playbackContext,situationalReplyDirection(request,narration,session,conversationContext),dualVoiceDirection(dualVoice&&narration&&!dialogue,session?.phase),
  dualVoice&&narration?'In situational mode, use two voices only for [turn:guide] or [turn:close]. For [turn:ask] or [turn:respond], use Owner alone. Background feelings are fictional imagery within the chosen passage, never factual observations about the listener.':'',
  !narration?conversationDirection(conversationTopic):'',
 ].filter(Boolean).join('\n\n');
 return [fixed,deviceDirection,dualVoiceDirection(dualVoice&&narration&&!dialogue,session?.phase),
  soundDesign&&!dialogue?appendSoundDirection(scriptSoundDirection,true):'',
  soundDesign&&!dialogue?'Current response: sound and tick metadata are enabled when appropriate.':'Current response: sound and tick metadata are disabled. Do not add sound, SFX or tick markers.',
  (narration?appendPhasePrompt('',session):appendSessionState('',session)).trim(),scriptCommandDirection(request),playbackContext,
  dialogue?'Live conversation alongside a running session: media, background sounds, visuals and session time continue independently. Do not include device, sound or tick control markers. For guided breathing requested by the user, [breath:in] and [breath:out] are allowed as the only playback metadata in conversation. Listen to the latest user input and adapt to corrections. An interrupted response is unfinished: do not assume its unplayed ending was heard. Do not speak playback metadata or interruption markers.':'',
  narration?narrationLengthDirection+'\nCurrent response is a complete session passage. A simple greeting to the selected session companion is an entry into the current phase, not a request for a generic chatbot greeting. Begin Induction with comfortable body support, contact with the chair or bed, feet and breathing. Never open an induction with Hello or Hi. Do not claim to see the listener or know their posture. If their position is unknown, invite them to notice where their body is supported.':
   'Current response is a conversation or interjection. Use short, clear sentences; this describes each sentence, not the total answer length. Give the latest input as much explanation as it needs, and honor any requested response length. The full-session word targets do not force a long script in response to a question or correction. Stay with the latest input.',
  replyTaskDirection(request,narration,false),
  !narration?conversationDirection(conversationTopic):'',
 ].filter(Boolean).join('\n\n');
}
