// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {DeviceCommand} from '../devices/commands';
import type {SessionPhase} from '../session-director/phases';
import {layeredBassSweep} from './bass-design';

export const soundNames = ['sub_dive', 'sub_fall', 'sinking', 'descent', 'wiper', 'pop', 'snap'] as const;
export type SoundName = typeof soundNames[number];
export interface SoundCue {type:'sound'; name:SoundName; durationMs?:number; inverted?:boolean}
export interface SoundDesignSettings {enabled:boolean; defaults:boolean; bassFallback:boolean}
export const soundSpecs:Record<SoundName,{duration:number;gainDb:number;frequency?:readonly [number,number]}> = {
  sub_dive:{duration:4,gainDb:-6,frequency:[80,30]},
  sub_fall:{duration:5,gainDb:-6,frequency:[70,25]},
  sinking:{duration:4,gainDb:-8,frequency:[60,20]},
  descent:{duration:6,gainDb:-6,frequency:[50,20]},
  wiper:{duration:3,gainDb:-10}, pop:{duration:.2,gainDb:-4}, snap:{duration:.1,gainDb:-4},
};

/** Only the named assets can be selected; arbitrary paths and unbounded loops are rejected. */
export function parseSoundMarker(marker:string):SoundCue|undefined {
  const match=/^\[sound:([a-z_]+)(?::(\d{1,5}))?\]$/i.exec(marker);
  if(!match || !soundNames.includes(match[1].toLowerCase() as SoundName))return;
  const name=match[1].toLowerCase() as SoundName;
  if(match[2] && (name!=='wiper' || Number(match[2])<100 || Number(match[2])>20000))return;
  return {type:'sound',name,...(match[2]?{durationMs:Number(match[2])}:{})};
}
export function validSoundCue(value:unknown):value is SoundCue {
  if(!value || typeof value!=='object')return false;
  const cue=value as SoundCue;
  return cue.type==='sound' && soundNames.includes(cue.name) &&
    (cue.durationMs===undefined || cue.name==='wiper' && Number.isInteger(cue.durationMs) && cue.durationMs>=100 && cue.durationMs<=20000) &&
    (cue.inverted===undefined || cue.name==='sub_dive' && typeof cue.inverted==='boolean');
}
export function soundDuration(cue:SoundCue){return cue.name==='wiper'?(cue.durationMs??3000)/1000:soundSpecs[cue.name].duration;}

export function soundDeviceCommands(cue:SoundCue,bassFallback=false):DeviceCommand[] {
  const pattern=(channel:'vib'|'rot',pattern:DeviceCommand['pattern']):DeviceCommand=>({type:'device',channel,operation:'pattern',pattern});
  const off=(channel:'vib'|'rot'):DeviceCommand=>({type:'device',channel,operation:'off'});
  switch(cue.name){
    case 'sub_dive':return [bassFallback?{type:'device',channel:'vib',operation:'on',intensity:.5}:pattern('vib','breathe'),off('rot')];
    case 'sub_fall':return [pattern('vib','wave'),pattern('rot','slow')];
    case 'sinking':return [pattern('vib','strobe'),pattern('rot','strobe')];
    case 'descent':return [pattern('vib','constant'),pattern('rot','slow')];
    case 'wiper':return [off('vib'),off('rot')];
    case 'pop':return [pattern('vib','pulse'),off('rot')];
    case 'snap':return [{type:'device',channel:'vib',operation:'on',intensity:.3},off('rot')];
  }
}

const normalize=(text:string)=>text.toUpperCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
function count(text:string){
  const match=/^(?:step\s+)?(10|9|8|7|6|5|4|3|2|1|ten|nine|eight|seven|six|five|four|three|two|one)\b[.!,:;\s]*(?:\[pause:[^\]]+\]\s*)*$/i.exec(text.trim());
  if(!match)return;
  const word=match[1].toLowerCase();
  return /^\d+$/.test(word)?Number(word):['zero','one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(word);
}
export interface PlannedSound {cue:SoundCue;at:'start'|'end';reason:'marker'|'trigger'|'phase'}
/** Entry cues are consumed on the first spoken word, where an explicit marker can override them. */
export class PhaseSoundDefaults {
  private phase:SessionPhase|undefined;
  private entry=false;
  private counts=new Set<number>();
  reset(){this.phase=undefined;this.entry=false;this.counts.clear();}
  updatePhase(phase:SessionPhase|undefined){if(phase!==this.phase){this.phase=phase;this.entry=phase==='conditioning';this.counts.clear();}}
  plan(text:string,trigger:string|undefined,phase:SessionPhase|undefined,explicit:SoundCue[]=[]):PlannedSound[]{
    this.updatePhase(phase);
    const entry=this.entry;this.entry=false;
    const step=count(text),fresh=step!==undefined&&!this.counts.has(step);
    if(step!==undefined)this.counts.add(step);
    if(explicit.length)return explicit.map(cue=>({cue,at:'start',reason:'marker'}));
    if(entry)return [{cue:{type:'sound',name:'descent'},at:'start',reason:'phase'}];
    if(phase==='induction'&&!trigger)return [];
    if(phase==='deepening'&&fresh&&[10,7,4,1].includes(step!))return [{cue:{type:'sound',name:'sub_fall'},at:'start',reason:'phase'}];
    if(phase==='awakening'&&fresh&&step===5)return [{cue:{type:'sound',name:'sub_dive',inverted:true},at:'start',reason:'phase'}];
    if(!trigger)return [];
    if(phase==='anchor')return [{cue:{type:'sound',name:'snap'},at:'start',reason:'phase'}];
    const name=normalize(trigger);
    const sound:SoundName=name==='BAMBI SLEEP'?'sub_dive':name==='BAMBI CUM AND COLLAPSE'?'sinking':
      /^(IQ (DROP|LOCK)|BRAINDEAD BOBBLEHEAD|AIRHEAD BARBIE|(?:MENTAL )?WINDSHIELD WIPERS|WIPERS)$/.test(name)?'wiper':
      /^(BAMBI POP|BUBBLE(?: INDUCTION)?|BLONDE MOMENT|BLANK MINDLESS DOLL)$/.test(name)?'pop':'snap';
    return [{cue:{type:'sound',name:sound},at:'start',reason:'trigger'}];
  }
}

/** Deterministic dry fallback if a local recording is unavailable (including extension overlays). */
export function synthesizeDesignSound(name:SoundName,rate:number,inverted=false,audible=false):Float32Array {
  const spec=soundSpecs[name],samples=new Float32Array(Math.round(spec.duration*rate));
  let seed=0x513a5c27;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/0x80000000-1;};
  let frequency=spec.frequency;
  if(frequency){
    let [from,to]=frequency;if(inverted)[from,to]=[to,from];
    if(audible){const shift=120-Math.min(from,to);from+=shift;to+=shift;}
    return layeredBassSweep(name,rate,spec.duration,from,to);
  }else for(let i=0;i<samples.length;i++){
    const t=i/rate,noise=random();
    if(name==='wiper')samples[i]=noise*.4*Math.sin(Math.PI*(t%1.5)/1.5)**2;
    else samples[i]=(noise+.2*Math.sin(2*Math.PI*(name==='pop'?110:1600)*t))*Math.min(1,t/.0007)*Math.exp(-t/(name==='pop'?.018:.008));
  }
  let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
  if(peak)for(let i=0;i<samples.length;i++)samples[i]*=.89125/peak;
  return samples;
}
