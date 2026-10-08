// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {z} from 'zod';
import type {SessionPhase} from './phases';

export const triggerCategories = ['entry','deepener','identity','reinforcement','awakening'] as const;
export const triggerStages = ['induction','deepening','conditioning','reinforcement','anchor','awakening'] as const;
export type TriggerCategory = typeof triggerCategories[number];
export type TriggerStage = typeof triggerStages[number];
export const categoryTriggers: Record<TriggerCategory, readonly string[]> = {
  entry: ['BAMBI SLEEP','BIMBO DOLL'],
  deepener: ['GOOD GIRL','SAFE AND SECURE'],
  identity: ['IQ LOCK','BODY LOCK','ATTITUDE LOCK','BAMBI FREEZE'],
  reinforcement: ['DROP FOR COCK','COCK ZOMBIE NOW','BAMBI CUM AND COLLAPSE','UNIFORM LOCK'],
  awakening: ['BAMBI SLEEP','BAMBI WAKE AND OBEY'],
};
const categories = z.array(z.enum(triggerCategories)).max(triggerCategories.length);
export const TriggerTimingSchema = z.object({
  enabled: z.boolean(),
  reinforcementStart: z.number().finite().min(0).max(100),
  stages: z.object({induction:categories,deepening:categories,conditioning:categories,
    reinforcement:categories,anchor:categories,awakening:categories}).strict(),
}).strict();
export type TriggerTiming = z.infer<typeof TriggerTimingSchema>;
export function defaultTriggerTiming(): TriggerTiming {
  return {enabled:true,reinforcementStart:85,stages:{
    induction:['entry'],deepening:['deepener'],conditioning:['identity'],
    reinforcement:['reinforcement'],anchor:['identity'],awakening:['awakening'],
  }};
}
export function parseTriggerTiming(value:string):TriggerTiming {
  try {return TriggerTimingSchema.parse(JSON.parse(value));} catch {return defaultTriggerTiming();}
}
export function triggerStageAt(phase:SessionPhase,progress:number,config:TriggerTiming):TriggerStage {
  return phase==='conditioning'&&progress>=config.reinforcementStart?'reinforcement':phase;
}
export function triggersForCategories(selected:readonly TriggerCategory[]):string[] {
  return [...new Set(selected.flatMap(category=>categoryTriggers[category]))];
}
export function triggersForPhase(phase:SessionPhase,progress:number,config:TriggerTiming):string[] {
  return triggersForCategories(config.stages[triggerStageAt(phase,progress,config)]);
}
export function triggerTimingDirection(phase:SessionPhase,progress:number,config:TriggerTiming,compact=false):string {
  if(!config.enabled)return '';
  const stage=triggerStageAt(phase,progress,config),allowed=triggersForPhase(phase,progress,config);
  if(compact)return [
    `CURRENT TRIGGER TIMING: ${stage}. Only these exact cue names may be spoken: ${JSON.stringify(allowed)}.`,
    allowed.length?'Speak selected cues when guiding. No unselected cues, including examples or compliments.':'No named cues.',
    stage==='deepening'&&allowed.includes('GOOD GIRL')?'Use GOOD GIRL 3–5 times in a complete segment, less in short replies.':'',
    'Intensity unlocks no other categories. No permanent conditioning, guaranteed subconscious effects or point of no return.',
  ].filter(Boolean).join('\n');
  return [
    'CURRENT TRIGGER TIMING (takes precedence over trigger examples in earlier instructions):',
    `Stage: ${stage}. Selected categories: ${JSON.stringify(config.stages[stage])}.`,
    `Only these trigger names may be spoken in this response: ${JSON.stringify(allowed)}.`,
    allowed.length?'Use the selected triggers as spoken cues, not merely descriptions.':'No triggers are selected. Do not introduce or fire any named trigger.',
    'Do not fire unselected triggers, including in examples, closing compliments or sound markers. Intensity does not unlock additional categories.',
    stage==='deepening'&&allowed.includes('GOOD GIRL')?'For a complete deepening segment, use GOOD GIRL 3–5 times; avoid repeating it unnecessarily in a short response.':'',
    'These are user-selected session cues. Do not claim permanent conditioning, guaranteed subconscious effects or a point of no return.',
  ].filter(Boolean).join('\n');
}
