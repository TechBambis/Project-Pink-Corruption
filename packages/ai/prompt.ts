// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {scriptFormatDirection,scriptSoundDirection,scriptCommandDirection} from '../content/script-direction';
import {appendSoundDirection} from '../content/sound-direction';
import {appendPhasePrompt} from '../content/phases';
import {appendSessionState,type SessionState} from './session-state';
import {bambiVoiceDirection} from '../content/voice';
import {narrationLengthDirection,replyTaskDirection} from './response';

/** Flags belong after this prefix: changing them must not invalidate its recurrent state. */
export function buildFixedReplyPrompt(base:string){
 return [base,bambiVoiceDirection,scriptFormatDirection].join('\n\n');
}

/** Keep the full fixed instructions before changing state so inference can reuse its prefix. */
export function buildReplyPrompt(base:string,request:string,soundDesign:boolean,deviceDirection:string,session?:SessionState,playbackContext='',dialogue=false,narration=!dialogue){
 const fixed=buildFixedReplyPrompt(base);
 return [fixed,deviceDirection,
  soundDesign&&!dialogue?appendSoundDirection(scriptSoundDirection,true):'',
  soundDesign&&!dialogue?'Current response: sound and tick metadata are enabled when appropriate.':'Current response: sound and tick metadata are disabled. Do not add sound, SFX or tick markers.',
  (narration?appendPhasePrompt('',session):appendSessionState('',session)).trim(),scriptCommandDirection(request),playbackContext,
  dialogue?'Live conversation alongside a running session: media, background sounds, visuals and session time continue independently. Do not include device, sound or tick control markers. For guided breathing requested by the user, [breath:in] and [breath:out] are allowed as the only playback metadata in conversation. Listen to the latest user input and adapt to corrections. An interrupted response is unfinished: do not assume its unplayed ending was heard. Do not speak playback metadata or interruption markers.':'',
  narration?narrationLengthDirection+'\nCurrent response is a complete session passage. A simple greeting to the selected session companion is an entry into the current phase, not a request for a generic chatbot greeting. Begin Induction with comfortable body support, contact with the chair or bed, feet and breathing. Never open an induction with Hello or Hi. Do not claim to see the listener or know their posture. If their position is unknown, invite them to notice where their body is supported.':
   'Current response is a conversation or interjection. Use short, clear sentences; this describes each sentence, not the total answer length. Give the latest input as much explanation as it needs, and honor any requested response length. The full-session word targets do not force a long script in response to a question or correction. Stay with the latest input.',
  replyTaskDirection(request,narration),
 ].filter(Boolean).join('\n\n');
}
