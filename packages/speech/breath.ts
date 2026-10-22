// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {stripSpeechFormatting} from './formatting';

export interface BreathCue {direction:'in'|'out';durationMs:number}
export function parseBreathMarker(marker:string):BreathCue|undefined {
 const match=/^\[breath:(in|out)(?::(\d{4,5}))?\]$/i.exec(marker);
 if(!match)return;
 const durationMs=Number(match[2]??4000);
 if(durationMs<1000||durationMs>10000)return;
 return {direction:match[1].toLowerCase() as BreathCue['direction'],durationMs};
}
export function validBreathCue(value:unknown):value is BreathCue {
 const cue=value as BreathCue|undefined;
 return !!cue&&['in','out'].includes(cue.direction)&&Number.isInteger(cue.durationMs)&&cue.durationMs>=1000&&cue.durationMs<=10000;
}
/** Older prompts can still provide an unambiguous, standalone breathing instruction. */
export function breathInstruction(text:string):BreathCue|undefined {
 const instruction=stripSpeechFormatting(text).replace(/\[pause:[^\]]*\]/gi,'').replace(/[.!…"“”]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
 const suffix='(?:\\s+(?:slowly|gently|comfortably|now|again|for me|please))*';
 if(new RegExp('^(?:and )?(?:in|breathe in|inhale)'+suffix+'$').test(instruction))return {direction:'in',durationMs:4000};
 if(new RegExp('^(?:and )?(?:out|breathe out|exhale)'+suffix+'$').test(instruction))return {direction:'out',durationMs:4000};
}
/** Recognize an explicit paired pacing instruction, not a mention of breathing
 * or an ordinary spatial phrase such as "in and out of the room". */
export function pacedBreathCycle(text:string){
 const modifiers='(?:\\s+(?:slowly|gently|comfortably|now|again|for me|please))*';
 const pattern=new RegExp('(?:^|(?<=[.!?…])\\s+)(?:and\\s+)?(?:breathe\\s+in|inhale|in)'+modifiers+'[\\s.!?…,:;]+(?:(?:and|then|and then)\\s+)?(?:breathe\\s+out|exhale|out)'+modifiers+'(?:[.!?…]+|$)','i');
 const match=pattern.exec(text);if(!match)return;
 return {before:text.slice(0,match.index).trim(),after:text.slice(match.index+match[0].length).trim()};
}
/** Direct paced instructions belong to engine breath steps, including longer
 * imperatives. Generic prose, spatial movement and negation do not match. */
export function hasPacedBreathInstruction(text:string){
 return /(?:^|(?<=[.!?…])\s+)(?:now\s+)?(?:(?:breathe\s+(?:in|out)|inhale|exhale)\b|(?:and\s+)?(?:in|out)[.!?…])/i.test(text);
}
/** An explicit bounded cycle count is a transport requirement, not a stylistic
 * suggestion. No inference from generic mentions of natural breathing. */
export function requestedBreathCycles(request:string){
 const match=/\b(one|two|three|[123])\s+(?:(?:comfortable|paced|slow|gentle|breathing|breath)\s+){0,5}cycles?\b/i.exec(request);
 if(match)return ({one:1,two:2,three:3} as Record<string,number>)[match[1].toLowerCase()]??Number(match[1]);
}
export const breathDirection=[
 '=== BREATHING PROTOCOL ===',
 'Only an explicitly requested paced exercise uses breath markers. Each step is one short sentence: [breath:in] In. [breath:out] And out.',
 'Each marker reserves four seconds and starts the circle/air sound at its spoken onset. Use [breath:in:5000] or [breath:out:5000] for another 1000–10000 ms pace, without additional pause tags, countdown filler or device/sound commands.',
 'Keep other narration outside paced steps. Repeat only as requested. Use comfortable natural breathing, no forced holds; the listener may change pace or stop.',
].join('\n');
