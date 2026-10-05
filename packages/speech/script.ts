// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {parseBreathMarker,type BreathCue} from './breath';
import {stripVocalFillers} from './nonverbal';
import {triggerUnits} from './trigger-units';
import {effectForTrigger} from '../../config/trigger-sequence';
import {parseDeviceMarker,type DeviceCommand} from '../devices/commands';
import {parseSoundMarker,type SoundCue} from '../audio/sound-design';
import {parseTickMarker,type TickCue} from '../audio/tick';
export const scriptCueNames=['SNAP','MOAN','WIPERS','INFLATE','SQUEAK','POP','BELL','TICK','DRONE_ON','DRONE_OFF','PAUSE_5','PAUSE_10'] as const;
export type ScriptCue=typeof scriptCueNames[number];
export type PlaybackCue=ScriptCue|DeviceCommand;
export interface ScriptUnit {text:string;trigger?:string;postPause?:boolean;prePause?:boolean;cuesBefore?:PlaybackCue[];cuesAfter?:PlaybackCue[];sounds?:SoundCue[];ticks?:TickCue[];devicesAtWord?:DeviceCommand[];control?:boolean;breath?:BreathCue}
const known=new Set<string>(scriptCueNames);
/** Pure text transformation: metadata is never passed to speech inference. */
export function normalizeScript(text:string){
 return stripVocalFillers(text).replace(/---\s*END\s*---/gi,'').replace(/\bI-Q\b/gi,'IQ')
  .replace(/\[PAUSE\]/gi,'[SFX:PAUSE_10]')
  .replace(/…{2,}|\.{6,}/g,' [pause:5000] ')
  .replace(/…|\.{3}/g,' [pause:2500] ')
  .replace(/\*\*/g,'');
}
export function scriptUnits(raw:string,names:string[]=[]):ScriptUnit[]{
 const text=normalizeScript(raw),units:ScriptUnit[]=[];let pending:PlaybackCue[]=[],sounds:SoundCue[]=[],ticks:TickCue[]=[],prefixPause='';let breath:BreathCue|undefined;
 const covered=(trigger:string,cue:PlaybackCue)=>typeof cue==='string'&&(cue==='MOAN'||cue==='SNAP'||
  (effectForTrigger(trigger)==='pop'&&['INFLATE','SQUEAK','POP'].includes(cue))||
  (effectForTrigger(trigger)==='wiper'&&cue==='WIPERS')||(effectForTrigger(trigger)==='bell'&&cue==='BELL'));
 for(const part of text.split(/(\[(?:SFX|sound|tick|vib|rot|both|breath):[^\]]*\])/gi)){
  if(/^\[breath:/i.test(part)){breath=parseBreathMarker(part);continue;}
  if(/^\[sound:/i.test(part)){const cue=parseSoundMarker(part);if(cue&&sounds.length<8)sounds.push(cue);continue;}
  if(/^\[tick:/i.test(part)){const cue=parseTickMarker(part);if(cue&&ticks.length<8)ticks.push(cue);continue;}
  if(/^\[(?:vib|rot|both):/i.test(part)){const command=parseDeviceMarker(part);if(command)pending.push(command);continue;}
  const match=/^\[SFX:([^\]]*)\]$/i.exec(part);
  if(match){const cue=match[1].toUpperCase();if(known.has(cue))pending.push(cue as ScriptCue);continue;}
  if(!part.trim())continue;
  if((sounds.length||ticks.length||breath)&&/^(?:\s*\[pause:[^\]]+\]\s*)+$/i.test(part)){prefixPause+=part.trim()+' ';continue;}
  const spoken=triggerUnits((prefixPause+part.replace(/\[(?:SFX|sound|tick|vib|rot|both|breath):[^\]]*$/gi,'')).trim(),names);prefixPause='';
  for(const unit of spoken){
   if(!unit.text.trim())continue;
   const concurrent=pending.filter((cue):cue is DeviceCommand=>typeof cue!=='string');
   let before=pending.filter(cue=>typeof cue==='string');pending=[];
   const wordSounds=sounds,wordTicks=ticks,wordBreath=breath;sounds=[];ticks=[];breath=undefined;
   // Automatic trigger processing already provides its prefix and mapped effect.
   // Explicit tags only add cues which are not covered by that processing.
   const previous=units.at(-1);
   if(!wordSounds.length&&!wordTicks.length&&!wordBreath&&previous?.trigger&&!before.every(c=>c==='MOAN'||c==='SNAP')){
    const after=before.filter(c=>!covered(previous.trigger!,c));
    if(after.length)previous.cuesAfter=[...(previous.cuesAfter??[]),...after];before=[];
   }
   const cues=unit.trigger?before.filter(c=>!covered(unit.trigger!,c)):before;
   units.push({...unit,...(wordBreath?{breath:wordBreath}:{}),...(cues.length?{cuesBefore:cues}:{}),...(wordSounds.length?{sounds:wordSounds}:{}),...(wordTicks.length?{ticks:wordTicks}:{}),...(concurrent.length?{devicesAtWord:concurrent}:{})});
  }
 }
 // A sound marker without a following word is discarded, rather than played on a different word.
 if(sounds.length&&!ticks.length)pending=pending.filter(cue=>typeof cue==='string');
 if(ticks.length){units.push({text:'',ticks,cuesBefore:pending,control:true});pending=[];}
 if(pending.length){const previous=units.at(-1);
  pending=pending.filter(c=>!previous?.trigger||!covered(previous.trigger,c));
  if(pending.length){if(previous)previous.cuesAfter=[...(previous.cuesAfter??[]),...pending];else units.push({text:'',cuesBefore:pending,control:true});}
 }
 return units;
}

/** Hide only machine cues from the streamed chat display, including split tags. */
export class ScriptDisplayStream {
 private buffer='';
 constructor(private preserveBreath=false){}
 push(text:string){this.buffer+=text;let out='';
  while(this.buffer){const bracket=this.buffer.indexOf('[');if(bracket<0){out+=this.buffer;this.buffer='';break;}
   out+=this.buffer.slice(0,bracket);this.buffer=this.buffer.slice(bracket);
   const end=this.buffer.indexOf(']');if(end<0){const upper=this.buffer.toUpperCase();if(['[SFX:','[SOUND:','[TICK:','[VIB:','[ROT:','[BOTH:','[BREATH:','[PAUSE:','[PAUSE]'].some(prefix=>prefix.startsWith(upper)||upper.startsWith(prefix)))break;out+='[';this.buffer=this.buffer.slice(1);continue;}
   const tag=this.buffer.slice(0,end+1);if(this.preserveBreath&&parseBreathMarker(tag))out+=tag;else if(!/^\[(?:(?:SFX|sound|tick|vib|rot|both|breath):[^\]]*|pause:[^\]]*|PAUSE)\]$/i.test(tag))out+=tag;
   this.buffer=this.buffer.slice(end+1);
  }return out;
 }
 flush(){const rest=/^\[(?:SFX|sound|tick|vib|rot|both|breath|pause|PAUSE)/i.test(this.buffer)?'':this.buffer;this.buffer='';return rest;}
}
