// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {validBreathCue,type BreathCue} from '../speech/breath';
export interface BreathEvent {cue:BreathCue;time:number;duration:number;soundDuration:number}
/** Original airy sound; generated locally, rather than labelled as a human recording. */
export function breathSamples(direction:'in'|'out',rate:number,duration=3){
 const samples=new Float32Array(Math.round(rate*duration));let seed=93811,air=0,phase=0;
 for(let i=0;i<samples.length;i++){
  const p=i/samples.length,t=i/rate;seed=(1664525*seed+1013904223)>>>0;
  air=.84*air+.16*(seed/4294967296*2-1);
  const frequency=direction==='in'?200+200*p:400-200*p;phase+=2*Math.PI*frequency/rate;
  const envelope=Math.sin(Math.PI*p)**1.6*Math.min(1,t/.08);
  samples[i]=(air*.8+Math.sin(phase)*.07)*envelope;
 }
 return samples;
}
export class BreathAudio {
 readonly events:BreathEvent[]=[];
 private sources=new Map<AudioBufferSourceNode,GainNode>();private buffers=new Map<string,AudioBuffer>();
 constructor(private context:AudioContext,private output:AudioNode,private window:(source:AudioBufferSourceNode,start:number,end:number)=>void,private finished:(source:AudioBufferSourceNode)=>void){}
 schedule(cue:BreathCue,time:number,voiceRms:number,sound=true){
  if(!validBreathCue(cue)||!Number.isFinite(time))return;
  const duration=cue.durationMs/1000,soundDuration=Math.min(3,duration*.75),event={cue,time,duration,soundDuration};
  this.events.push(event);if(this.events.length>64)this.events.shift();
  if(sound){
   const key=cue.direction+soundDuration;let buffer=this.buffers.get(key);
   if(!buffer){const samples=breathSamples(cue.direction,this.context.sampleRate,soundDuration);buffer=this.context.createBuffer(1,samples.length,this.context.sampleRate);buffer.getChannelData(0).set(samples);if(this.buffers.size>=16)this.buffers.clear();this.buffers.set(key,buffer);}
   const pcm=buffer.getChannelData(0),rms=Math.sqrt(pcm.reduce((sum,x)=>sum+x*x,0)/pcm.length);
   const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;
   gain.gain.value=Math.min(1,Math.max(.005,voiceRms)/Math.max(.0001,rms)*10**(-14/20));
   source.connect(gain);gain.connect(this.output);this.sources.set(source,gain);this.window(source,time,time+soundDuration);
   source.onended=()=>{this.sources.delete(source);this.finished(source);source.disconnect();gain.disconnect();};source.start(time);
  }
  return event;
 }
 stop(){for(const [source,gain] of this.sources){source.onended=null;try{source.stop();}catch{}this.finished(source);source.disconnect();gain.disconnect();}this.sources.clear();}
}
