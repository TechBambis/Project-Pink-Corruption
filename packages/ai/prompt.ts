// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {dualVoiceDirection} from '../content/dual-voice';
import {appendSoundDirection} from '../content/sound-direction';
import {appendPhasePrompt} from '../content/phases';
import {appendSessionState,type SessionState} from './session-state';
import {buildCharacterPrefix} from './character';
import {replyWordBudget,replyBlockBudget,replyTaskDirection,replyTaskContract} from './response';
import {situationalVoiceDirection} from '../content/situational';
import {situationalReplyDirection} from './situational';
import type {Interaction} from './request';
import {conversationDirection,type ConversationTopic} from '../content/conversation';
import {languageStyleDirection,type LanguageStyle} from './language-style';
import {narratorIdentityReminder} from '../content/voice';
import {breathDirection} from '../speech/breath';
import {deliveryDirection,type DeliveryMode} from '../session-director/delivery';
import {spokenBlockProtocol} from './spoken-blocks';

type ReplyStyle=LanguageStyle&{narrationStyle?:string};
export interface ReplyDelivery {mode:DeliveryMode;words:number;visuals?:boolean}
const focused=(base:string)=>base.startsWith('=== BAMBI COMPANION ===');
/** The prompt and native grammar share the same current marker capabilities. */
export function replyControlPrefixes(request:string,narration:boolean,dialogue:boolean,interaction:Interaction,soundDesign=false,delivery=false,devices=false){
 if(delivery)return [];
 const prefixes=['pause'];
 if(narration||/\b(?:breath(?:e|ing|s)?|inhale|exhale)\b/i.test(request))prefixes.push('breath');
 if(narration&&!dialogue&&interaction==='reactive'){
  if(soundDesign)prefixes.push('SFX','sound','tick');
  if(devices)prefixes.push('vib','rot','both');
 }
 return prefixes;
}
/** The reusable prefix contains no phase-specific budget or transport marker examples. */
export function buildFixedReplyPrompt(base:string,interaction:Interaction='reactive',languageStyle:ReplyStyle={}){
 return [buildCharacterPrefix(base,languageStyle.narrationStyle),replyTaskContract,spokenBlockProtocol,
  interaction==='situational'?situationalVoiceDirection:'',languageStyleDirection(languageStyle),
 ].filter(Boolean).join('\n\n');
}

/** One current output contract, one current task/budget and one session state. */
export function buildReplyPrompt(base:string,request:string,soundDesign:boolean,deviceDirection:string,session?:SessionState,playbackContext='',dialogue=false,narration=!dialogue,interaction:Interaction='reactive',conversationContext='',dualVoice=false,conversationTopic:ConversationTopic='general',languageStyle:ReplyStyle={},delivery?:ReplyDelivery){
 const fixed=buildFixedReplyPrompt(base,interaction,languageStyle);
 const words=replyWordBudget(request,narration,{phase:session?.phase,focused:focused(base),interaction,engineWords:delivery?.words});
 const blocks=replyBlockBudget(request,narration,words);
 const controls=narration&&!dialogue&&interaction==='reactive'&&!delivery;
 const output=[
  '=== CHAT OUTPUT CONTRACT ===',
  'Use the SPOKEN BLOCK FORMAT above. Only the private metadata admitted below may accompany the spoken words. This output contract overrides conflicting character-format examples.',
  `Use ${blocks.min}-${blocks.max} complete spoken lines total. Stop when the answer is complete; do not fill unused lines.`,
  dualVoiceDirection(dualVoice&&narration&&!dialogue,session?.phase),
  interaction==='situational'&&dualVoice&&narration?'Use INNER only for [turn:guide] or [turn:close]; [turn:ask] and [turn:respond] use Owner alone.':'',
  delivery?deliveryDirection(delivery.mode,delivery.visuals,delivery.words,false):[
   'Supported pauses: [pause:normal], [pause:medium], [pause:long], [pause:transition]. Never speak private markers.',
   replyControlPrefixes(request,narration,dialogue,interaction).includes('breath')?breathDirection:'No breath cues in this response.',
   controls&&soundDesign?appendSoundDirection('',true):'Sound and tick metadata are disabled. No sound, SFX or tick markers.',
   controls?deviceDirection:'No device commands.',
   interaction==='reactive'&&!narration&&base.startsWith('You are Bambi Local,')?'The selected custom character may append its validated <action> scene metadata only for an explicitly requested visible scene change.':'No presentation actions.',
  ].filter(Boolean).join('\n\n'),
 ].filter(Boolean).join('\n\n');
 return [fixed,output,
  narration?appendPhasePrompt('',session):appendSessionState('',session),
  playbackContext,interaction==='situational'?situationalReplyDirection(request,narration,session,conversationContext):'',
  replyTaskDirection(request,narration,false,words),!narration?conversationDirection(conversationTopic):'',
  narratorIdentityReminder,
 ].filter(Boolean).join('\n\n');
}
