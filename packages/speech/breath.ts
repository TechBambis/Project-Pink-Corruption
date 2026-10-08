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
export const breathDirection=[
 '=== BREATHING PROTOCOL ===',
 'Whenever you guide a breathing cycle, including within session narration, give short, direct pacing cues rather than describing the breath or the listener\'s body. Use In. and And out. with room to breathe between them. Keep other narration outside the paced steps.',
 'CORRECT: [breath:in] In. [breath:out] And out.',
 'WRONG: Feel your chest rising and falling. Feel the air filling your lungs as you breathe in, then slowly release it.',
 'The intended rhythm is In. [pause:long] And out. [pause:long]. With breath markers, playback already reserves the breathing interval: write the CORRECT marker example above without additional pause tags.',
 'Repeat only as requested, with a few cycles per reply. Do not start a breathing exercise during an unrelated question or correction.',
 'These private markers start a breathing circle and soft air sound at the first spoken word. Each step lasts four seconds; playback reserves that time automatically. Do not add pause tags, countdown filler or extra sound/device commands to those steps.',
 'Put the marker immediately before its short spoken instruction, as a separate sentence. For a different comfortable pace, use [breath:in:5000] or [breath:out:5000] (1000–10000 milliseconds). Never speak, quote or explain markers.',
 'Use a comfortable natural breath, with no forced breath holds. The listener may choose their own pace or stop. Do not claim breathing guarantees hypnosis, obedience or loss of choice.',
].join('\n');
