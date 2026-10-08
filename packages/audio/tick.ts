// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {SessionPhase} from '../session-director/phases';
import {isAppAudioOrigin} from './app-origin';
import {bufferRms} from './sound-renderer';
import {synthesizeDesignSound} from './sound-design';

export const tickGainDb=-12;
export interface TickCue {type:'tick';operation:'on'|'off'|'fade';bpm?:number}
export function parseTickMarker(marker:string):TickCue|undefined {
  if(/^\[tick:off\]$/i.test(marker))return {type:'tick',operation:'off'};
  if(/^\[tick:fade:0\]$/i.test(marker))return {type:'tick',operation:'fade'};
  const match=/^\[tick:on:(\d{2,3})\]$/i.exec(marker);
  if(match&&Number(match[1])>=20&&Number(match[1])<=120)return {type:'tick',operation:'on',bpm:Number(match[1])};
}
export function validTickCue(value:unknown):value is TickCue {
  if(!value||typeof value!=='object')return false;const cue=value as TickCue;
  return cue.type==='tick'&&(['off','fade'].includes(cue.operation)&&cue.bpm===undefined||cue.operation==='on'&&Number.isInteger(cue.bpm)&&cue.bpm!>=20&&cue.bpm!<=120);
}
export function tickBpmForPhase(phase:SessionPhase,progress=0){
  return phase==='induction'?(progress<.5?60:50):phase==='deepening'?40:phase==='awakening'?0:30;
}
/** Dry 65 ms wood-like single tick, rather than an alternating tick/tock recording. */
export function synthesizeTick(rate=44100){
  const samples=new Float32Array(Math.round(.065*rate));let seed=0x71151;
  for(let i=0;i<samples.length;i++){
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    const t=i/rate,noise=(seed>>>0)/0x80000000-1;
    samples[i]=Math.min(1,t/.0005)*Math.exp(-t/.009)*(.7*Math.sin(2*Math.PI*970*t)+.3*Math.sin(2*Math.PI*1510*t)+.14*noise);
  }
  let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
  for(let i=0;i<samples.length;i++)samples[i]*=.89125/peak;
  return samples;
}

export class TickEngine {
  private sample:AudioBuffer|undefined;
  private sources=new Set<AudioBufferSourceNode>();
  private current:AudioBufferSourceNode|undefined;
  private gain:GainNode;
  private diveGain:GainNode;
  private diveSamples=new Map<boolean,AudioBuffer>();
  private dives=false;
  private audible=false;
  private level=.08;
  private origin=0;
  private startedAt=0;
  private loopInterval=0;
  private bpmValue=0;
  private fadeEnd=0;
  private source='generated';
  private loading:Promise<void>|undefined;
  private held:{bpm:number;offset:number;fadeRemaining:number;gain:number;diveGain:number}|undefined;
  readonly events:{operation:string;bpm:number;time:number;interval:number;gainDb:number;source:string}[]=[];
  constructor(private context:AudioContext,output:AudioNode){this.gain=context.createGain();this.gain.connect(output);this.diveGain=context.createGain();this.diveGain.connect(output);}
  configureDives(enabled:boolean,audible:boolean){
    if(enabled===this.dives&&audible===this.audible)return;
    this.dives=enabled;this.audible=audible;
    if(this.active)this.apply({type:'tick',operation:'on',bpm:this.bpm},this.context.currentTime+.035,true);
  }
  init(){return this.loading??=this.load();}
  private async load(){
    if(!isAppAudioOrigin())return;
    // The user prefers the earlier clock/metronome attack for the BPM loop.
    // Prefer the shipped attack on every OS; local authoring extras are fallbacks.
    for(const file of ['tick_main.wav','tick.wav'])try{const response=await fetch('/assets/sounds/'+file,{signal:AbortSignal.timeout(5000)});if(!response.ok)continue;
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
      if(buffer.numberOfChannels===1&&buffer.duration>=.05&&buffer.duration<=.12){this.sample=buffer;this.source='asset';break;}
    }catch{/* Deterministic dry tick remains available offline. */}
    await Promise.allSettled([false,true].map(async audible=>{
      const response=await fetch('/assets/sounds/sub_dive'+(audible?'_120':'')+'.wav',{signal:AbortSignal.timeout(5000)});if(!response.ok)return;
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());if(buffer.numberOfChannels===1&&Math.abs(buffer.duration-4)<.025)this.diveSamples.set(audible,buffer);
    }));
  }
  private buffer(){
    if(!this.sample){const samples=synthesizeTick(this.context.sampleRate);this.sample=this.context.createBuffer(1,samples.length,this.context.sampleRate);this.sample.getChannelData(0).set(samples);}
    return this.sample;
  }
  get bpm(){return this.held?.bpm??(this.bpmValue&&(!this.fadeEnd||this.context.currentTime<this.fadeEnd)?this.bpmValue:0);}
  get active(){return !this.held&&this.bpm>0;}
  get interval(){return this.bpm?60/this.bpm:0;}
  phaseMs(time=this.context.currentTime){return this.interval?Math.max(0,(this.held?.offset??time-this.origin)%this.interval)*1000:0;}
  visualSignal(time:number){
    const active=!this.held&&this.bpmValue>0&&time>=this.startedAt&&(!this.fadeEnd||time<this.fadeEnd);
    return {active,phaseMs:active?Math.max(0,(time-this.origin)%this.loopInterval)*1000:0,
      level:active?(this.fadeEnd?Math.min(1,Math.max(0,(this.fadeEnd-time)/10)):1):0};
  }
  get activeCount(){return this.sources.size;}
  setVoiceLevel(rms:number){
    if(!Number.isFinite(rms)||rms<=0)return;this.level=rms;
    if(!this.fadeEnd){this.gain.gain.setTargetAtTime(this.level/Math.max(.00001,bufferRms(this.buffer()))*10**(tickGainDb/20),this.context.currentTime,.03);this.setDiveGain(this.context.currentTime);}
  }
  private diveBuffer(){
    let buffer=this.diveSamples.get(this.audible);
    if(!buffer){const samples=synthesizeDesignSound('sub_dive',this.context.sampleRate,false,this.audible);buffer=this.context.createBuffer(1,samples.length,this.context.sampleRate);buffer.getChannelData(0).set(samples);this.diveSamples.set(this.audible,buffer);}
    return buffer;
  }
  private setDiveGain(time:number){this.diveGain.gain.setValueAtTime(this.level/Math.max(.00001,bufferRms(this.diveBuffer()))*10**(-6/20),time);}
  apply(cue:TickCue,time=this.context.currentTime+.035,force=false,offset=0){
    if(cue.operation==='off'){this.stop(time);return;}
    if(cue.operation==='fade'){
      if(!this.active||this.fadeEnd)return;
      for(const node of [this.gain,this.diveGain]){const value=node.gain.value;node.gain.cancelScheduledValues(time);node.gain.setValueAtTime(value,time);node.gain.linearRampToValueAtTime(0,time+10);}
      for(const source of this.sources)source.stop(time+10);this.fadeEnd=time+10;
      this.log('fade',time);return;
    }
    if(!cue.bpm||!force&&cue.bpm===this.bpm&&!this.fadeEnd)return;
    const sample=this.buffer(),interval=60/cue.bpm;
    const loop=this.context.createBuffer(1,Math.round(interval*this.context.sampleRate),this.context.sampleRate);
    loop.getChannelData(0).set(sample.getChannelData(0));
    // Replace tempo at a shared start time; no timer-based drift accumulates.
    this.stop(time);this.bpmValue=cue.bpm;this.origin=time-offset;this.startedAt=time;this.loopInterval=loop.duration;this.fadeEnd=0;
    const source=this.context.createBufferSource();source.buffer=loop;source.loop=true;source.connect(this.gain);this.sources.add(source);this.current=source;
    this.gain.gain.cancelScheduledValues(time);this.gain.gain.setValueAtTime(this.level/Math.max(.00001,bufferRms(sample))*10**(tickGainDb/20),time);
    source.onended=()=>{this.sources.delete(source);source.disconnect();if(this.current===source){this.current=undefined;this.bpmValue=0;}};
    source.start(time,offset%interval);this.log('on',time);
    if(this.dives){
      const dive=this.diveBuffer(),period=this.context.createBuffer(1,Math.round(interval*4*this.context.sampleRate),this.context.sampleRate);
      const data=period.getChannelData(0),samples=dive.getChannelData(0);
      // Start this repeating source on the fourth tick; no dive tail plays before that first event.
      for(let i=0;i<samples.length;i++)data[i%data.length]+=samples[i];
      const source=this.context.createBufferSource();source.buffer=period;source.loop=true;source.connect(this.diveGain);this.sources.add(source);
      this.diveGain.gain.cancelScheduledValues(time);this.setDiveGain(time);
      source.onended=()=>{this.sources.delete(source);source.disconnect();};source.start(time+Math.max(0,interval*3-offset),Math.max(0,offset-interval*3)%(interval*4));
    }
  }
  private log(operation:string,time:number){this.events.push({operation,bpm:this.bpmValue,time,interval:this.bpmValue?60/this.bpmValue:0,gainDb:tickGainDb,source:this.source});if(this.events.length>128)this.events.shift();}
  pause(){
    if(this.held||!this.active)return;
    const time=this.context.currentTime;
    const snapshot={bpm:this.bpm,offset:Math.max(0,time-this.origin),fadeRemaining:this.fadeEnd?Math.max(0,this.fadeEnd-time):0,gain:this.gain.gain.value,diveGain:this.diveGain.gain.value};
    this.stop(time);this.held=snapshot;this.log('pause',time);
  }
  resume(){
    const snapshot=this.held;if(!snapshot)return;this.held=undefined;
    const time=this.context.currentTime;
    this.apply({type:'tick',operation:'on',bpm:snapshot.bpm},time,true,snapshot.offset);
    if(snapshot.fadeRemaining){
      this.fadeEnd=time+snapshot.fadeRemaining;
      for(const [node,value] of [[this.gain,snapshot.gain],[this.diveGain,snapshot.diveGain]] as const){node.gain.cancelScheduledValues(time);node.gain.setValueAtTime(value,time);node.gain.linearRampToValueAtTime(0,this.fadeEnd);}
      for(const source of this.sources)source.stop(this.fadeEnd);
    }
    this.log('resume',time);
  }
  stop(time=this.context.currentTime){
    this.held=undefined;
    for(const source of this.sources){source.onended=time>this.context.currentTime?()=>source.disconnect():null;try{source.stop(time);}catch{}if(time<=this.context.currentTime)source.disconnect();}
    this.sources.clear();this.current=undefined;this.bpmValue=0;this.fadeEnd=0;
    this.gain.gain.cancelScheduledValues(time);this.gain.gain.setValueAtTime(0,time);
    this.diveGain.gain.cancelScheduledValues(time);this.diveGain.gain.setValueAtTime(0,time);
  }
}
