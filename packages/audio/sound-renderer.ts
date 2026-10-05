// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {soundNames,soundSpecs,soundDuration,synthesizeDesignSound,type SoundCue} from './sound-design';

export interface SoundDesignEvent {name:string;time:number;duration:number;gainDb:number;gain:number;source:'asset'|'generated'|'local';reason:string}
export interface SelectedDesignSample {buffer:AudioBuffer;source:'local'|'generated';output:AudioNode;gainDb:number}
/** Buffer sources share the narration AudioContext; no HTMLAudio or setTimeout controls audio. */
export class SoundRenderer {
  readonly events:SoundDesignEvent[]=[];
  private buffers=new Map<string,{buffer:AudioBuffer;source:'asset'|'generated'}>();
  private sources=new Map<AudioBufferSourceNode,GainNode>();
  private playback=new Map<AudioBufferSourceNode,{start:number;duration:number;offset:number;output:AudioNode}>();
  private paused:{buffer:AudioBuffer;loop:boolean;duration:number;offset:number;level:number;output:AudioNode}[]=[];
  private loading:Promise<void>|undefined;
  constructor(private context:AudioContext,private output:AudioNode,
    private window:(source:AudioBufferSourceNode,start:number,end:number)=>void,
    private finished:(source:AudioBufferSourceNode)=>void){}
  init(){return this.loading??=this.load();}
  private async load(){
    if(!/^http:\/\/(?:127\.0\.0\.1|localhost):6969$/.test(globalThis.location?.origin??''))return;
    const files=[...soundNames,'sub_rise',...['sub_dive','sub_fall','sinking','descent','sub_rise'].map(name=>name+'_120')];
    await Promise.allSettled(files.map(async name=>{
      const response=await fetch('/assets/sounds/'+name+'.wav',{signal:AbortSignal.timeout(5000)});
      if(!response.ok)return;
      const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
      const original=name.replace(/_120$/,'');
      const base=(original==='sub_rise'?'sub_dive':original) as keyof typeof soundSpecs;
      if(buffer.numberOfChannels!==1||Math.abs(buffer.duration-soundSpecs[base].duration)>.025)return;
      this.buffers.set(name,{buffer,source:'asset'});
    }));
  }
  private sound(cue:SoundCue,audible:boolean){
    const base=cue.inverted?'sub_rise':cue.name;
    const key=base+(audible&&soundSpecs[cue.name].frequency?'_120':'');
    let sound=this.buffers.get(key);
    if(!sound){
      const samples=synthesizeDesignSound(cue.name,this.context.sampleRate,cue.inverted,audible);
      const buffer=this.context.createBuffer(1,samples.length,this.context.sampleRate);buffer.getChannelData(0).set(samples);
      sound={buffer,source:'generated'};this.buffers.set(key,sound);
    }
    return sound;
  }
  schedule(cue:SoundCue,time:number,voiceRms:number,audible:boolean,reason:string,selected?:SelectedDesignSample){
    const sound=selected??this.sound(cue,audible),duration=soundDuration(cue),db=selected?.gainDb??soundSpecs[cue.name].gainDb;
    const level=selected?10**(db/20):Math.min(1,Math.max(0,voiceRms)/Math.max(.00001,bufferRms(sound.buffer))*10**(db/20));
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=sound.buffer;source.loop=cue.name==='wiper';
    gain.gain.setValueAtTime(level,time);gain.gain.setValueAtTime(level,time+duration-.005);gain.gain.linearRampToValueAtTime(0,time+duration);
    const output=selected?.output??this.output;
    source.connect(gain);gain.connect(output);this.sources.set(source,gain);this.playback.set(source,{start:time,duration,offset:0,output});this.window(source,time,time+duration);
    source.onended=()=>{this.sources.delete(source);this.playback.delete(source);this.finished(source);source.disconnect();gain.disconnect();};
    this.events.push({name:cue.inverted?'sub_rise':cue.name,time,duration,gainDb:db,gain:level,source:sound.source,reason});
    if(this.events.length>256)this.events.shift();
    source.start(time);source.stop(time+duration);return duration;
  }
  pause(){
    if(this.paused.length)return;
    const now=this.context.currentTime;
    for(const [source,gain] of this.sources){const window=this.playback.get(source);if(source.buffer&&window&&now>=window.start&&now<window.start+window.duration)this.paused.push({buffer:source.buffer,loop:source.loop,duration:window.start+window.duration-now,offset:window.offset+now-window.start,level:gain.gain.value,output:window.output});}
    this.stop(false);
  }
  resume(){
    const now=this.context.currentTime,paused=this.paused;this.paused=[];
    for(const sound of paused){
      const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=sound.buffer;source.loop=sound.loop;
      gain.gain.setValueAtTime(sound.level,now);gain.gain.setValueAtTime(sound.level,now+Math.max(0,sound.duration-.005));gain.gain.linearRampToValueAtTime(0,now+sound.duration);
      source.connect(gain);gain.connect(sound.output);this.sources.set(source,gain);this.playback.set(source,{start:now,duration:sound.duration,offset:sound.offset,output:sound.output});this.window(source,now,now+sound.duration);
      source.onended=()=>{this.sources.delete(source);this.playback.delete(source);this.finished(source);source.disconnect();gain.disconnect();};
      source.start(now,sound.loop?sound.offset%sound.buffer.duration:sound.offset);source.stop(now+sound.duration);
    }
  }
  stop(clearPaused=true){if(clearPaused)this.paused=[];for(const [source,gain] of this.sources){source.onended=null;try{source.stop();}catch{}this.finished(source);source.disconnect();gain.disconnect();}this.sources.clear();this.playback.clear();}
  get activeCount(){return this.sources.size;}
}

export function bufferRms(buffer:AudioBuffer,seconds=buffer.duration){
  const frames=Math.min(buffer.length,Math.max(0,Math.round(seconds*buffer.sampleRate)));
  if(!frames)return 0;
  let sum=0;
  for(let channel=0;channel<buffer.numberOfChannels;channel++){
    const data=buffer.getChannelData(channel);for(let i=0;i<frames;i++)sum+=data[i]*data[i];
  }
  return Math.sqrt(sum/(frames*buffer.numberOfChannels));
}
