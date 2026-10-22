// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {ScriptDisplayStream} from '../speech/script';
import {stripSpeechFormatting} from '../speech/formatting';

export function spokenPassageText(text:string){const display=new ScriptDisplayStream();return stripSpeechFormatting(display.push(text)+display.flush());}

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
 // A conversational greeting/continuation must not start a scene in this personality.
 if(promptId==='english-conversation'&&/^(?:hello|hi|hey|start|begin|continue|go on|keep going|go|let'?s (?:go|begin)|good (?:evening|night))(?:\s+(?:bambi|please|sweetie))?[.!…\s]*$/i.test(request.trim()))return false;
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

/** Identical across replies: keep these rules inside the reusable character prefix. */
export const replyTaskContract=[
  '=== REPLY TASK CONTRACT ===',
  'Answer the latest real request in the selected character. Questions need a useful direct answer; corrections apply immediately. Ordinary questions and greetings do not request an induction. A conversational greeting gets one or two short in-character sentences, then yield.',
  'Continue the last heard idea when asked; do not repeat a welcome. If necessary, ask one focused question. Short sentences describe sentence structure, not total response length. Current task, format and response budget override conflicting examples or length targets in the character.',
].join('\n');

export interface ReplyWordRange {min:number;max:number}
/** Spoken framing must have a finite, complete end, even if a roleplay model
 * keeps offering more sentences instead of selecting EOS. */
export function replyBlockBudget(request:string,narration:boolean,words?:ReplyWordRange){
 const count=/\b(?:in|use|with|only|just|exactly)\s+(one|two|three|[1-9]\d?)\s+(?:(?:short|complete|spoken|brief)\s+)?(?:sentences?|questions?)\b/i.exec(request);
 if(count){const exact=({one:1,two:2,three:3} as Record<string,number>)[count[1].toLowerCase()]??Number(count[1]);return {min:exact,max:exact};}
 const max=words?Math.max(1,Math.min(128,Math.ceil(words.max/3))):isBriefRequest(request)?1:narration?128:6;
 return {min:1,max};
}
/** One budget for prompt wording and the existing runtime completion guard. */
export function replyWordBudget(request:string,narration:boolean,options:{phase?:keyof typeof narrationWordLimits;focused?:boolean;interaction?:'reactive'|'situational';engineWords?:number}={}):ReplyWordRange|undefined {
 if(options.engineWords!==undefined)return {min:Math.max(1,options.engineWords-15),max:options.engineWords};
 const explicit=requestedWordRange(request);if(explicit)return explicit;
 if(!narration||isBriefRequest(request))return;
 if(options.focused)return {min:60,max:100};
 if(options.interaction==='situational')return {min:80,max:160};
 const phase=options.phase??'induction';return {min:({induction:300,deepening:250,conditioning:200,anchor:200,awakening:150})[phase],max:narrationWordLimits[phase]};
}

/** Complete contract for callers; the prompt owner already places its fixed part in the prefix. */
export function replyTaskDirection(request:string,narration:boolean,includeContract=true,budget:ReplyWordRange|undefined=requestedWordRange(request)){
 return [
  includeContract?replyTaskContract:'',
  '=== CURRENT REPLY TASK ===',
  narration?'Current response is a complete session passage in the current phase.':'Answer the current conversation, question or correction. Then yield to the listener.',
  narration&&/^(?:continue|go on|keep going)\b/i.test(request.trim())?'CONTINUATION CONTRACT: The session is already in progress. Develop the last actually heard thought in the current phase. Begin with its next meaningful sentence. Do not repeat a welcome, announce a new beginning or restart body positioning and initial relaxation. This current continuation task takes precedence over induction-opening examples and setup instructions in the persona or phase guidance.':'',
  isBriefRequest(request)?'The user explicitly requests brevity. Honor the requested number of sentences or words. Do not apply a minimum passage length.':'',
  budget?`Current response length: ${budget.min}-${budget.max} spoken words TOTAL. Finish a complete thought within this budget; it replaces other passage targets.`:'',
  !narration&&/^(?:hello|hi|hey|good (?:evening|night))(?:\s+(?:bambi|please|sweetie))?[.!…\s]*$/i.test(request.trim())?
   'Immediate task: respond in one or two short in-character sentences. Acknowledge the listener\'s presence in the selected character\'s own tone and vocabulary. A session has not been requested. Do not give instructions to relax, breathe, sit, lie down or close eyes. Do not describe the listener\'s body, surroundings, voice or prior visits. Then stop and wait for their next input.':'' ,
 ].filter(Boolean).join('\n');
}

export const narrationWordLimits={induction:400,deepening:350,conditioning:350,anchor:350,awakening:250} as const;
export function spokenWordCount(text:string){return (spokenPassageText(text).replace(/\[[^\]]*(?:\]|$)/g,'').match(/\b[\w’'-]+\b/g)??[]).length;}
/** Nested pause/control tags do not close an outer inline voice fragment. */
export function incompleteSpeechMarker(text:string){let depth=0;for(const char of text){if(char==='[')depth++;else if(char===']')depth=Math.max(0,depth-1);}return depth>0;}
/** Stop only after a complete sentence, never in the middle of spoken output. */
export function narrationPassageComplete(text:string,phase:keyof typeof narrationWordLimits='induction',request=''){
 if(incompleteSpeechMarker(text))return false;
 return spokenWordCount(text)>=(requestedWordRange(request)?.max??narrationWordLimits[phase])&&/[.!?。！？]["”']?(?:\s|\[[^\]]*\])*$/u.test(spokenPassageText(text));
}

export const narrationLengthDirection=[
 '=== SESSION NARRATION LENGTH ===',
 'SHORT SENTENCES do not mean SHORT RESPONSES. Build a complete passage from many short sentences, usually 3-8 words each. Aim for 200-400 spoken words, roughly 30-50 sentences; use more sentences if needed for the phase word target. Pause markers do not count as words.',
 'Phase targets: Induction 300-400 words; Deepening 250-350; Conditioning 200-350; Anchor 200-350; Awakening 150-250. Never finish a requested full passage below 100 spoken words. Develop the passage naturally rather than padding or repeating a greeting.',
 'These targets apply to session narration. Questions, corrections, technical help, stop commands and conversational interjections may receive a short relevant response. Follow explicit requests for a shorter passage. ',
 'In Conditioning, the lower bound (200) is a MINIMUM, not a target. If the phase demands more (trigger installation, repetition, escalation), go to 350 or more. The ceiling is the token budget, not the word target. ',
].join('\n');
