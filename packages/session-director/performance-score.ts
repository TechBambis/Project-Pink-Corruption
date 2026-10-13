// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { wavDurationMs } from './events/speech';
import type { OutputWord } from '../speech/output-evidence';
export const sceneBeatIds = ['motif-introduced', 'contrast-begins', 'scene-return', 'closing-complete'] as const;
const PhraseSchema = z.object({
  id: z.string().min(1).max(80), text: z.string().trim().min(1).max(180),
  pauseAfterMs: z.number().finite().min(0).max(10000),
  important: z.boolean(),
  beats: z.array(z.object({ beatId: z.enum(sceneBeatIds), afterWord: z.number().int().min(1).max(60) }).strict()).max(4),
}).strict().superRefine((p, ctx) => {
  if (/[\[\]<>\r\n]|```/.test(p.text) || !/[.!?]$/.test(p.text)) ctx.addIssue({code:'custom',message:'A synthesis arc must be a complete plain spoken thought'});
  if (p.beats.some(b => b.afterWord > scoreWords(p.text).length)) ctx.addIssue({code:'custom',message:'Beat anchor exceeds spoken words'});
});
export const PerformanceScoreSchema = z.object({
  version: z.literal(1), id: z.string().min(1).max(80), execution: z.literal('prepared-guided'),
  windowMs: z.number().finite().min(1000).max(90000),
  leadingPauseMs: z.number().finite().min(0).max(10000),
  endingReserveMs: z.number().finite().min(500).max(10000),
  phrases: z.array(PhraseSchema).min(1).max(16),
}).strict().superRefine((score, ctx) => {
  if (new Set(score.phrases.map(p=>p.id)).size !== score.phrases.length) ctx.addIssue({code:'custom',message:'Duplicate synthesis arc'});
  const beats=score.phrases.flatMap(p=>p.beats.map(b=>b.beatId));
  if(new Set(beats).size!==beats.length)ctx.addIssue({code:'custom',message:'Duplicate beat'});
});
export type PerformanceScore = z.infer<typeof PerformanceScoreSchema>;
export const scoreWords = (text:string) => text.match(/[\w]+(?:['’\-][\w]+)*/g) ?? [];
export interface MeasuredArc { id: string; bytes: Uint8Array; words: OutputWord[] }
export interface CompiledSpeechPlan {
  version: 1; scoreId: string; durationMs: number; windowMs: number;
  arcs: { id: string; text: string; atMs: number; durationMs: number; pauseAfterMs: number; important: boolean; words: OutputWord[] }[];
  beats: { beatId: typeof sceneBeatIds[number]; atMs: number; phraseId: string }[];
}
/** Second pass uses actual PCM lengths and word ends. Overflow is an explicit
 * fallback, never a clipped arc, a moved authored window or extra synthesis. */
export function compileSpeechPlan(raw: PerformanceScore, measured: MeasuredArc[]): CompiledSpeechPlan {
  const score=PerformanceScoreSchema.parse(raw);
  if(measured.length!==score.phrases.length||new Set(measured.map(a=>a.id)).size!==measured.length)throw Error('Incomplete score audio');
  let cursor=score.leadingPauseMs;
  const beats:CompiledSpeechPlan['beats']=[];
  const arcs=score.phrases.map(phrase=>{
    const audio=measured.find(a=>a.id===phrase.id);if(!audio)throw Error('Missing synthesis arc');
    const durationMs=wavDurationMs(audio.bytes), tokens=scoreWords(phrase.text);
    if (!audio.words.length || audio.words.length>tokens.length) throw Error('Missing measured word alignment');
    // Kokoro's honest aligner can omit weak function-word matches. Keep those
    // unavailable; a beat needs an unambiguous measured anchor, not interpolation.
    let previousEnd=0, tokenCursor=0;
    const anchored = new Map<number, OutputWord>();
    for(const word of audio.words) {
      const index=tokens.findIndex((token,i)=>i>=tokenCursor&&token.toLowerCase()===word.word.toLowerCase());
      if(index<0||!Number.isFinite(word.atMs)||!Number.isFinite(word.endMs)||word.atMs<previousEnd-.001||word.endMs!<word.atMs||word.endMs!>durationMs+.001)throw Error('Invalid measured word alignment');
      anchored.set(index+1,word);tokenCursor=index+1;previousEnd=word.endMs!;
    }
    const atMs=cursor;
    for(const beat of phrase.beats) {
      // A scene transition is authorized only in a verified trailing pause.
      const transition=beat.beatId==='contrast-begins'||beat.beatId==='scene-return';
      if(transition&&(beat.afterWord!==tokens.length||phrase.pauseAfterMs<500))throw Error('Scene change requires a complete thought and a pause');
      const word=anchored.get(beat.afterWord);
      if (!word || tokens.filter(t=>t.toLowerCase()===word.word.toLowerCase()).length>1) throw Error('Beat requires an unambiguous measured word');
      beats.push({beatId:beat.beatId,atMs:atMs+(transition?durationMs+150:word.endMs!),phraseId:phrase.id});
    }
    cursor+=durationMs+phrase.pauseAfterMs;
    return {...phrase,atMs,durationMs,words:structuredClone(audio.words)};
  });
  if(cursor+score.endingReserveMs>score.windowMs+.001)throw Error('Score audio overflow; use the approved fallback');
  return {version:1,scoreId:score.id,durationMs:cursor+score.endingReserveMs,windowMs:score.windowMs,arcs,beats};
}
