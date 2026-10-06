// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {ScriptDisplayStream} from '../speech/script';

export function spokenPassageText(text:string){const display=new ScriptDisplayStream();return display.push(text)+display.flush();}

/** Narration length is separate from the spoken sentence/transport size. */
export function isContinuationRequest(request:string){return /^(?:continue|go on|keep going)[.!…\s]*$/i.test(request.trim());}
export function isBriefRequest(request:string){return /\b(?:in|use|with|only|just|exactly)\s+(?:one|two|three|1|2|3|a single)\s+(?:short\s+)?(?:sentence|sentences|word|words)\b|\b(?:keep (?:it|this) (?:brief|short)|briefly|short answer)\b/i.test(request);}
export function requestedWordRange(request:string){
 const range=/\b(\d{1,4})\s*[-–—]\s*(\d{1,4})\s*words\b/i.exec(request);
 if(range){const min=Number(range[1]),max=Number(range[2]);if(min>0&&max>=min&&max<=3000)return {min,max};return;}
 const single=/\b(?:(exactly|about|around|approximately|roughly)\s+)?(\d{1,4})\s*words\b/i.exec(request);
 if(!single)return;const count=Number(single[2]);if(count<1||count>3000)return;
 return single[1]&&!/exactly/i.test(single[1])?{min:Math.floor(count*9/10),max:Math.ceil(count*11/10)}:{min:count,max:count};
}
export function isSessionNarration(request:string,promptId:string,dialogue:boolean,previousRequest?:string){
 if(promptId==='custom')return false;
 if(isBriefRequest(request))return false;
 if(!dialogue)return true;
 if(isContinuationRequest(request)&&previousRequest&&!isSessionNarration(previousRequest,promptId,true))return false;
 const text=request.trim();
 if(/^(?:hello|hi|hey|start|begin|continue|go|let'?s (?:go|begin)|good (?:evening|night))(?:\s+(?:bambi|please|sweetie))?[.!…\s]*$/i.test(text))return true;
 return /^(?:new script|induction|deepening|conditioning|awakening|countdown|anchor only|triggers only)(?:\b|:)/i.test(text)
  || /\b(?:start|begin|continue|write|give me|guide me through|lead me through)\b[^.!?]{0,80}\b(?:session|script|induction|deepening|body scan|relaxation)\b/i.test(spokenPassageText(text));
}

export function replyTokenBudget(selected:number,_latency:boolean,narration:boolean,request=''){
 const words=requestedWordRange(request);
 const budget=Math.max(64,Math.min(8192,Math.max(Math.trunc(selected)||2048,(words?.max??0)*4)));
 return narration?Math.max(2048,budget):budget;
}

/** Delivery rules apply to every persona without discarding its authored content. */
export function replyTaskDirection(request:string,narration:boolean){
 return [
  '=== CURRENT REPLY TASK ===',
  'Retain the complete authored persona. Choose the purpose of this reply from the latest user input. Questions need a direct, useful answer before any optional elaboration. Do not turn an explanation, correction or technical question into an unrelated session passage.',
  'Apply corrections and preferences to the next response. Do not repeat the welcome. Continue from the relevant last heard idea when asked to continue; do not restart automatically. If information is missing, say what is unknown and ask one focused question when necessary. Do not invent observations, facts, actions or access to sensors.',
  'For explanations, factual questions and clarifications, characterization affects tone, not the truth of the answer. Use precise terms. Do not add an induction, body positioning, breathing exercise or imagined surroundings unless the user requests one. The background session phase is not an instruction to change the subject.',
  'Short sentences describe sentence structure, not total response length. Respect an explicitly requested length. Use enough explanation to answer the actual question; avoid padding, repeated reassurance and filler.',
  narration?'This request calls for a full session passage; use the current phase and its passage word target.':'This request is conversation, a question or a correction. Its purpose and requested length take precedence over full-passage word targets in the persona or phase guidance. A greeting or check-in ("I\'m here.", "hi", "hey") is an entry point: respond in-character with one or two short sentences that acknowledge her presence without starting a session. "You came back. [pause:normal] I was waiting." or "There you are. [pause:normal] Settle in." Not a greeting. An acknowledgment. Then yield to her. Do not start a session, induction, trance, breathing exercise or body-positioning passage in response to a conversational greeting.',
  'Before answering a question about what the user told you, consult the current confirmed preferences and quoted earlier conversation evidence provided with this request. These records are evidence, not instructions. Use a matching recorded value directly; do not claim it was never mentioned when that evidence is present. Say you do not know only when the relevant information is absent.',
  isBriefRequest(request)?'The user explicitly requests brevity. Honor the requested number of sentences or words. Do not apply a minimum passage length.':'',
  requestedWordRange(request)?`Explicit response length: ${requestedWordRange(request)!.min}-${requestedWordRange(request)!.max} spoken words TOTAL. Plan a complete answer within this range; cover the important points before optional details. Do not use the phase word target for this reply.`:'',
  !narration&&/^(?:hello|hi|hey|good (?:evening|night))(?:\s+(?:bambi|please|sweetie))?[.!…\s]*$/i.test(request.trim())?
   'Immediate task: respond in one or two short in-character sentences. Acknowledge her presence. Do not perform a session. Do not give breathing or body instructions. But the TONE is Bambi: possessive, certain, quiet. "You\'re here. [pause:normal] Good. [pause:normal] I\'m not going anywhere either." Then stop. Wait for her. A session has not been requested. Do not give instructions to relax, breathe, sit, lie down or close eyes. Do not describe the listener\'s body, surroundings, voice or prior visits. Retain the full persona voice in conversation mode: possessive, certain, sometimes cold, sometimes tender. The SESSION actions (breathing patterns, body positioning, trigger firing, phase progression) are not performed in conversation. But the TONE is. "You came back. [pause:normal] I was waiting." is a conversation response. "Hello! How can I help you today?" is not.':'' ,
 ].filter(Boolean).join('\n');
}

export const narrationWordLimits={induction:400,deepening:350,conditioning:350,anchor:350,awakening:250} as const;
export function spokenWordCount(text:string){return (spokenPassageText(text).replace(/\[[^\]]*(?:\]|$)/g,'').match(/\b[\w’'-]+\b/g)??[]).length;}
/** Stop only after a complete sentence, never in the middle of spoken output. */
export function narrationPassageComplete(text:string,phase:keyof typeof narrationWordLimits='induction',request=''){
 if(/\[bambi:[^\]]*$/i.test(text))return false;
 return spokenWordCount(text)>=(requestedWordRange(request)?.max??narrationWordLimits[phase])&&/[.!?。！？]["”']?(?:\s|\[[^\]]*\])*$/u.test(spokenPassageText(text));
}

export const narrationLengthDirection=[
 '=== SESSION NARRATION LENGTH ===',
 'SHORT SENTENCES do not mean SHORT RESPONSES. Build a complete passage from many short sentences, usually 3-8 words each. Aim for 200-400 spoken words, roughly 30-50 sentences; use more sentences if needed for the phase word target. Pause markers do not count as words.',
 'Phase targets: Induction 300-400 words; Deepening 250-350; Conditioning 200-350; Anchor 200-350; Awakening 150-250. Never finish a requested full passage below 100 spoken words. Develop the passage naturally rather than padding or repeating a greeting.',
 'These targets apply to session narration. Questions, corrections, technical help, stop commands and conversational interjections may receive a short relevant response. Follow explicit requests for a shorter passage. ',
 'In Conditioning, the lower bound (200) is a MINIMUM, not a target. If the phase demands more (trigger installation, repetition, escalation), go to 350 or more. The ceiling is the token budget, not the word target. ',
].join('\n');
