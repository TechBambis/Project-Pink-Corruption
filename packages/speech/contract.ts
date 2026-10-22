// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {listenerAddressPolicy} from '../content/voice';
import {stripSpeechFormatting} from './formatting';

export type SpokenSpeaker='owner'|'bambi';
export class SpokenContractError extends Error {
 constructor(readonly code:'address'|'self-narration'|'fragment'|'repetition'|'inner-perspective',readonly rejectedText?:string){super({address:'Use Bambi or doll as an address, or omit the address.', 'self-narration':'Return only the words spoken to the listener. Omit first- or third-person stage directions, physical actions and reporting clauses such as I lean closer or I whisper. Preserve the meaning of the actual dialogue.',fragment:'Finish one complete spoken thought without isolated trailing words.',repetition:'Develop a new spoken sentence from the last heard idea. Do not copy a previously heard passage; use a brief reanchor if needed.','inner-perspective':'The inner voice is the listener speaking in first person. Do not address Bambi or doll as another person.'}[code]);this.name='SpokenContractError';}
}
/** Technical discussion may quote the undesired word; it is not an endearment.
 * The exemption is request-scoped, never inferred from a model's own output. */
function discussesAddress(request:string){return /\b(?:meaning of|definition of|define|translate|what does|what is the word)\s+(?:the (?:word|term)\s+)?["'“‘]?pet\b/i.test(request);}
/** Explicit discussion of writing may quote the form; generated roleplay may not
 * grant itself that exception. These narrow patterns are not a semantic parser. */
function discussesNarration(request:string){return /\b(?:explain|translate|analy[sz]e|meaning|example)\b/i.test(request)&&/\b(?:stage direction|narration|sentence|phrase|prose)\b/i.test(request);}
const firstPersonStageDirection=/(?:^|[.!?]\s+)["“']?I\s+(?:lean\s+(?:in|closer|forward|down|over)\b|(?:move|step)\s+closer\b|(?:stroke|caress|brush|touch)\s+your\b|(?:smile|smirk|chuckle|grin|purr|whisper|murmur)\s*[,;:]|(?:whisper|murmur)\s+(?:in|into)\s+your\s+ear\b)|\bmy\s+(?:lips\s+(?:brush\w*|curl\w*)|eyes\s+(?:darken\w*|gleam\w*|narrow\w*)|gaze\s+(?:drift\w*|linger\w*)|fingers\s+(?:trace\w*|brush\w*|stroke\w*))\b/i;
// A model can describe the same speaker using She/Her without ever naming the
// Owner. Check these action/reporting forms even in ordinary chat; do not ban
// pronouns themselves or ordinary factual references to another person.
const thirdPersonStageDirection=/\bher\s+(?:eyes\s+(?:narrow|darken|gleam|flash|sparkle)\w*|lips\s+(?:curl|brush|part)\w*|gaze\s+(?:drift|linger|settle|bore)\w*|fingers\s+(?:trace|brush|stroke)\w*|tone\s+brooks?\s+no\s+argument)\b|\bshe\s+(?:(?:steps?|moves?|leans?)\s+(?:closer\b|(?:in\s+)?close\b|(?:towards?\s+(?:you|your)\b))|(?:gazes?|stares?|looks?)\s+(?:down\s+)?at\s+you\b|taps?\s+her\s+foot\b|(?:whispers?|murmurs?|purrs?|says?|commands?)\s*(?:[,;:]|["“]))/i;
/** Reuse the same decision for output and historical examples without deleting
 * stored messages. A request to discuss/translate narration is still allowed. */
export function containsOwnerNarration(text:string,request='',narration=true){
 const spoken=stripSpeechFormatting(text);
 return !discussesNarration(request)&&(firstPersonStageDirection.test(spoken)||thirdPersonStageDirection.test(spoken)||narration&&/\bthe (?:owner|hypnotist)(?:['’]s (?:eyes|voice|lips|gaze)|\s+(?:gazes|leans|whispers|smiles|looks|says|speaks))\b/i.test(spoken));
}
export function validateSpokenText(text:string,options:{speaker?:SpokenSpeaker;request?:string;narration?:boolean;heardText?:string}={}){
 const spoken=stripSpeechFormatting(text);
 if(!discussesAddress(options.request??'')&&listenerAddressPolicy.disallowed.some(word=>new RegExp('\\b'+word+'\\b','i').test(spoken)))throw new SpokenContractError('address');
 if(options.speaker==='bambi'&&/(?:^|[,;.!?]\s*)(?:Bambi|doll)\s*[,;.!?]/i.test(spoken))throw new SpokenContractError('inner-perspective');
 // Only unambiguous descriptions of the speaker. A reference to another woman
 // or a technical explanation about narrators must remain possible.
 if(options.speaker!=='bambi'&&containsOwnerNarration(spoken,options.request,options.narration??false))throw new SpokenContractError('self-narration');
 if(options.narration&&(/\b(?:a|an|the|my|your|our)\s+[a-z][.!?]$/i.test(spoken.trim())||/,\s*(?:I|you|we|she|he|it|they)[.!?]$/i.test(spoken.trim())))throw new SpokenContractError('fragment');
 const words=(s:string)=>(s.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).join(' ');
 if(options.narration&&options.speaker!=='bambi'&&options.heardText&&!/^(?:repeat\b|say\b.*\bagain\b)/i.test(options.request?.trim()??'')){
  const normalized=words(spoken);if(normalized.split(' ').length>=12&&words(options.heardText).includes(normalized))throw new SpokenContractError('repetition',text);
 }
 return text;
}

/** One repair allowance per request, shared by every streamed sentence. The
 * caller owns the queue, deadline and cancellation. Nothing is released early. */
export class SpokenOutputGate {
 private repaired=false;
 constructor(private options:{request?:string;narration?:boolean;heardText?:string},private replace:(text:string,speaker:SpokenSpeaker,reason:string,signal:AbortSignal)=>Promise<string>){}
 async accept(raw:string,signal:AbortSignal){
  signal.throwIfAborted();const inner=/^\[bambi\]/i.test(raw),speaker=inner?'bambi':'owner',text=inner?raw.slice(7):raw;
  try{validateSpokenText(text,{...this.options,speaker});return raw;}catch(error){
   if(!(error instanceof SpokenContractError)||this.repaired)throw error;
   this.repaired=true;const replacement=await this.replace(text,speaker,error.message,signal);signal.throwIfAborted();
   if(!replacement.trim()||replacement.length>1800||/[\[\]<>`]/.test(replacement)||!/[.!?]["”']?$/.test(replacement.trim()))throw new SpokenContractError('fragment');
   validateSpokenText(replacement,{...this.options,speaker});
   return (inner?'[bambi]':'')+replacement.trim();
  }
 }
}
