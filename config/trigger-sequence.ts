// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** User-defined sound associations, separate from the pinned content archive. */
export const triggerEffectMap = {
  'IQ LOCK':'wiper','IQ DROP':'wiper','BRAINDEAD BOBBLEHEAD':'wiper','AIRHEAD BARBIE':'wiper',
  'MENTAL WINDSHIELD WIPERS':'wiper','WINDSHIELD WIPERS':'wiper','WIPERS':'wiper',
  'BAMBI POP':'pop','BUBBLE':'pop','BUBBLE INDUCTION':'pop','BLONDE MOMENT':'pop','BLANK MINDLESS DOLL':'pop',
  'SNAP AND FORGET':'bell','BAMBI RESET':'bell','BAMBI AWAKENS':'bell','RESTRAINED AND MILKED':'bell',
} as const;
export const pauseOnlyTriggers = ['BAMBI SLEEP','BAMBI FREEZE','BAMBI LIMB','BAMBI LIMP','BAMBI WAKE AND OBEY','BAMBI CUM AND COLLAPSE','BAMBI DOES AS SHE IS TOLD','GOOD GIRL','BIMBO DOLL','DROP FOR COCK','COCK ZOMBIE NOW','ZAP COCK DRAIN OBEY','GIGGLE TIME','SAFE AND SECURE','PRIMPED','PAMPERED','POSTURE LOCK','UNIFORM LOCK','TITS LOCK','WAIST LOCK','BUTT LOCK','LIPS LOCK','THROAT LOCK','HIPS LOCK','CUNT LOCK','BAMBI YES TIME','BAMBI YOU ARE NOTHING'];
// A spoken "Snap" is a one-shot cue. Longer names still win during matching.
export const triggerAliases = [...Object.keys(triggerEffectMap),...pauseOnlyTriggers,'BODY LOCK','ATTITUDE LOCK','SNAP'];
/** Bambi is also the listener's ordinary name. Text alone cannot distinguish
 * that address from the catalog's standalone cue. Only a dedicated engine
 * action schedules that cue; longer phrases retain ordinary trigger matching. */
export function implicitTriggerNames(names:readonly string[]){return [...new Set(names)].filter(name=>name.trim().toLowerCase()!=='bambi');}
export function isSpokenSnap(name:string){return name.trim().toUpperCase()==='SNAP';}
export function isSpokenOneShot(name:string){return isSpokenSnap(name)||name.trim().toUpperCase()==='BUBBLE';}
export function effectForTrigger(name:string):'wiper'|'pop'|'bell'|undefined {
 const key=name.toUpperCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
 return triggerEffectMap[key as keyof typeof triggerEffectMap];
}
export const triggerSequenceDefaults={snap:true,moan:true,effects:true,moanMaxSeconds:.5,moanGain:.3,wiperSeconds:5,bubbleInflate:true,bubbleSqueak:true,bubbleGapMs:400,bubbleSqueakGain:.5,effectPauseMs:2500,plainPauseMs:5000};
export type TriggerSequenceOptions={trigger:string;spokenSeconds:number;prePauseMs?:number;postPauseMs?:number;sequenceEnabled?:boolean;snap?:boolean;moan?:boolean;effects?:boolean;wiperSeconds?:number;bubbleInflate?:boolean;bubbleSqueak?:boolean;bubbleGapMs?:number;effectPauseMs?:number;plainPauseMs?:number};
