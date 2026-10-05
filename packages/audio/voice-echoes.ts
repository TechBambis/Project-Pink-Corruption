// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {SessionPhase} from '../session-director/phases';

export const voiceEchoStages = [
 {delay:.4,gainDb:-12,semitones:-.5},
 {delay:.8,gainDb:-24,semitones:-1},
] as const;
export function echoesInPhase(phase:SessionPhase|undefined){return phase==='induction'||phase==='awakening';}
export interface VoiceEchoEvent {phase:SessionPhase;time:number;end:number;gainDb:number;semitones:number;rate:number}

/** Two fixed-position, single-pass copies. The dry voice/captions never move. */
export class VoiceEchoes {
 private sources=new Map<AudioBufferSourceNode,GainNode>();
 enabled=true;
 readonly events:VoiceEchoEvent[]=[];
 constructor(private context:AudioContext,private output:AudioNode,
  private started:(source:AudioBufferSourceNode,start:number,end:number)=>void,
  private ended:(source:AudioBufferSourceNode)=>void){}
 get activeCount(){return this.sources.size;}
 configure(enabled:boolean){this.enabled=enabled;if(!enabled)this.stop();}
 phase(phase:SessionPhase){if(!echoesInPhase(phase))this.stop();}
 schedule(decoded:AudioBuffer,wordTime:number,spokenSeconds:number,wordOffset:number,phase:SessionPhase|undefined){
  const dryEnd=wordTime+Math.max(0,spokenSeconds-wordOffset);
  if(!this.enabled||!echoesInPhase(phase)||spokenSeconds<=wordOffset)return dryEnd;
  const first=Math.round(wordOffset*decoded.sampleRate),last=Math.min(decoded.length,Math.round(spokenSeconds*decoded.sampleRate));
  if(last<=first)return dryEnd;
  const buffer=this.context.createBuffer(decoded.numberOfChannels,last-first,decoded.sampleRate);
  for(let channel=0;channel<decoded.numberOfChannels;channel++)buffer.getChannelData(channel).set(decoded.getChannelData(channel).subarray(first,last));
  let end=dryEnd;
  for(const stage of voiceEchoStages){
   const source=this.context.createBufferSource(),gain=this.context.createGain();
   const rate=2**(stage.semitones/12),start=wordTime+stage.delay,until=start+buffer.duration/rate;
   source.buffer=buffer;source.playbackRate.value=rate;source.connect(gain);gain.connect(this.output);
   const level=10**(stage.gainDb/20),fade=Math.min(.005,(until-start)/4);
   gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(level,start+fade);
   gain.gain.setValueAtTime(level,until-fade);gain.gain.linearRampToValueAtTime(0,until);
   this.sources.set(source,gain);this.started(source,start,until);
   source.onended=()=>{this.sources.delete(source);this.ended(source);source.disconnect();gain.disconnect();};
   source.start(start);source.stop(until);end=Math.max(end,until);
   this.events.push({phase:phase!,time:start,end:until,gainDb:stage.gainDb,semitones:stage.semitones,rate});
  }
  if(this.events.length>128)this.events.splice(0,this.events.length-128);
  return end;
 }
 stop(){for(const [source,gain] of this.sources){source.onended=null;try{source.stop();}catch{}this.ended(source);source.disconnect();gain.disconnect();}this.sources.clear();}
}
