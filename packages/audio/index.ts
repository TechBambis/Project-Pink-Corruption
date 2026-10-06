// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {connectVoiceTrack,backgroundVoiceWindow} from './dual-voice';
import type {VoiceTrack} from '../speech/dual-voice';
import {MoanVariations} from './moan-variations';
import {BreathAudio,type BreathEvent} from './breath';
import {breathInstruction,type BreathCue} from '../speech/breath';
import { BackgroundBed } from './background';
import type { AudioPreset } from './preset';
import { clamp } from '../safety/actions';
import { triggerSoundSettings, type TriggerSound } from '../../config/trigger-sounds';
import {effectForTrigger,isSpokenSnap,isSpokenOneShot,triggerSequenceDefaults,type TriggerSequenceOptions} from '../../config/trigger-sequence';
import { synthesizeTriggerSound } from './trigger-synthesis';
import { synthesizeEventCue, type EventCueSound } from './event-cues';
import { giggleOffset } from './giggle';
import {scriptCueNames,type PlaybackCue} from '../speech/script';
import {DeviceCommandSchema,type DeviceCommand,type DeviceCueOrigin} from '../devices/commands';
import {PhaseSoundDefaults,soundDeviceCommands,validSoundCue,type SoundCue,type SoundDesignSettings} from './sound-design';
import {SoundRenderer,bufferRms,type SoundDesignEvent} from './sound-renderer';
import {SpeechDucker} from './ducking';
import {DeliveryMix} from './delivery-mix';
import type {DeliveryMode} from '../session-director/delivery';
import type {SessionPhase} from '../session-director/phases';
import {TickEngine,tickBpmForPhase,validTickCue,type TickCue} from './tick';
import {VoiceEchoes} from './voice-echoes';
export const buses=['MASTER','SESSION','AI_VOICE','AMBIENCE','EFFECTS','MIC_MONITOR','main_voice','left_voice','right_voice','echo_voice','drone','noise','music_optional'] as const;
export type Bus=typeof buses[number];
/** PCM onset fallback only when a provider cannot supply model duration timing. */
function firstAudibleOffset(buffer:AudioBuffer,seconds:number){
 const frames=Math.min(buffer.length,Math.round(seconds*buffer.sampleRate)),data=buffer.getChannelData(0);
 let peak=0;for(let i=0;i<frames;i++)peak=Math.max(peak,Math.abs(data[i]));
 if(!peak)return 0;
 const threshold=peak*.001;for(let i=0;i<frames-2;i++)if(Math.abs(data[i])>threshold&&Math.abs(data[i+1])>threshold&&Math.abs(data[i+2])>threshold)return i/buffer.sampleRate;
 return 0;
}
export class AudioEngine {
 private deliveryMix:DeliveryMix;
 setNarrationDelivery(mode?:DeliveryMode,at=this.context.currentTime){this.deliveryMix.set(mode,at);}
 private dualGapStart:number|undefined;
 private dualVoiceCleanup=new Map<AudioBufferSourceNode,()=>void>();
 private eventMode=false;
 private eventGates:Partial<Record<Bus,GainNode>>={};
 private eventVoiceCleanup=new Map<AudioBufferSourceNode,()=>void>();
 private toneEventGate:GainNode;
 /** Presentation multipliers sit after user gains; even a background preset cannot unmute a blank. */
 setEventMode(enabled:boolean){this.setNarrationDelivery();this.stopEventCues();this.eventMode=enabled;if(enabled){this.tickEngine.stop();this.voiceEchoes.stop();this.designSounds.stop();this.breathAudio.stop();this.clearDesignSilence();}else this.clearEventGains();}
 setEventGains(gains:Partial<Record<Bus,number>>){for(const [bus,node] of Object.entries(this.eventGates)){node!.gain.value=clamp(gains[bus as Bus]??1);}this.toneEventGate.gain.value=clamp(gains.drone??1);}
 clearEventGains(){for(const node of Object.values(this.eventGates))node!.gain.value=1;this.toneEventGate.gain.value=1;}
 private eventCueBuffers=new Map<EventCueSound,AudioBuffer>();
 private giggleNext=0;
 private giggleVariation=0;
 playGiggle(time:number,deadline:number){
  if(!this.scriptSoundsEnabled||this.muted||this.context.state!=='running'||time<this.giggleNext||deadline<=time)return false;
  const ids=this.giggleVariation%2?['giggle_alt','giggle']:['giggle','giggle_alt'];
  const id=ids.find(id=>this.localSounds.has(id));if(!id)return false;
  const sound=this.localSounds.get(id)!,source=this.context.createBufferSource(),gain=this.context.createGain(),duration=Math.min(sound.buffer.duration,deadline-time);
  if(duration<.1)return false;
  source.buffer=sound.buffer;const level=10**(sound.gainDb/20);gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(level,time+.015);gain.gain.setValueAtTime(level,time+duration-.025);gain.gain.linearRampToValueAtTime(0,time+duration);source.connect(gain);gain.connect(this.nodes.EFFECTS);
  this.effectSources.add(source);this.effectPlayback.set(source,{start:time,duration,offset:0,gain,output:this.nodes.EFFECTS,eventCue:this.eventMode});this.foreground.set(source,{start:time,end:time+duration,bus:'EFFECTS'});
  this.scheduledSounds.push({trigger:'giggle_topic',kind:'giggle',phase:'after',time,duration,source:'local',assetId:id});if(this.scheduledSounds.length>128)this.scheduledSounds.shift();
  source.onended=()=>{this.foreground.delete(source);this.effectSources.delete(source);this.effectPlayback.delete(source);source.disconnect();gain.disconnect();};source.start(Math.max(time,this.context.currentTime));source.stop(time+duration);
  this.giggleNext=time+duration;this.giggleVariation++;return true;
 }
 playEventCue(kind:EventCueSound,time=this.context.currentTime,deadline=Infinity){
  if(this.context.state!=='running'||this.muted||!Number.isFinite(time)||time<this.context.currentTime-.15||deadline<=time||this.eventGates.EFFECTS?.gain.value===0)return false;
  let buffer=this.eventCueBuffers.get(kind);if(!buffer){const samples=synthesizeEventCue(kind,this.context.sampleRate);buffer=this.context.createBuffer(2,samples[0].length,this.context.sampleRate);for(let ch=0;ch<2;ch++)buffer.getChannelData(ch).set(samples[ch]);this.eventCueBuffers.set(kind,buffer);}
  const duration=Math.min(buffer.duration,deadline-time),source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.connect(gain);gain.connect(this.nodes.EFFECTS);
  this.effectSources.add(source);this.effectPlayback.set(source,{start:time,duration,offset:0,gain,output:this.nodes.EFFECTS,eventCue:true});this.foreground.set(source,{start:time,end:time+duration,bus:'EFFECTS'});
  this.scheduledSounds.push({trigger:'engine',kind:`event_${kind}`,phase:'after',time,duration,source:'generated',assetId:`event_${kind}`});if(this.scheduledSounds.length>128)this.scheduledSounds.shift();
  source.onended=()=>{this.foreground.delete(source);this.effectSources.delete(source);this.effectPlayback.delete(source);source.disconnect();gain.disconnect();};source.start(Math.max(time,this.context.currentTime));source.stop(time+duration);return true;
 }
 stopEventCues(namedOnly=false){
  this.pausedEffects=this.pausedEffects.filter(sound=>!(namedOnly?sound.eventTrigger:sound.eventCue));
  for(const [source,window] of this.effectPlayback)if(namedOnly?window.eventTrigger:window.eventCue){source.onended=null;try{source.stop();}catch{}source.disconnect();window.gain.disconnect();this.foreground.delete(source);this.effectSources.delete(source);this.effectPlayback.delete(source);}
 }
 /** Same selected sounds/faders as ordinary triggers, bounded by the engine episode. */
 playEventTrigger(trigger:string,time:number,deadline:number,spokenEnd=time){
  if(this.context.state!=='running'||this.muted||time<this.context.currentTime-.15||deadline<=time||this.eventGates.EFFECTS?.gain.value===0)return;
  const plan=this.triggerPlan(trigger),remaining=deadline-time;
  if(plan.moan)this.cue('moan',trigger,'before',time,Math.min(plan.moan,remaining),plan.settings.moanGain,undefined,plan.moanSound,true);
  if(plan.snap)this.cue('snap',trigger,'after',time,remaining,1,undefined,this.sound('snap'),true);
  for(const cue of plan.cues){const cueTime=cue.kind==='tick'?Math.max(time,spokenEnd):time+cue.offset;if(cueTime<deadline)this.cue(cue.kind,trigger,'after',cueTime,Math.min(cue.duration,deadline-cueTime),cue.gain,undefined,this.sound(cue.kind),true);}
 }
 /** Cached event payload: no text parser, echo, trigger synthesis, or effect scheduling. */
 playEventVoice(buffer:AudioBuffer,start:number,deadline:number,bus:'main_voice'|'left_voice'|'right_voice'|'echo_voice'='main_voice'){
  if(!Number.isFinite(start)||!Number.isFinite(deadline)||start<this.context.currentTime-.15||start+buffer.duration>deadline+.001)throw Error('Event voice does not fit scheduled window');
  const source=this.context.createBufferSource();source.buffer=buffer;
  const pan=bus==='left_voice'||bus==='right_voice'?this.context.createStereoPanner():null;
  if(pan){pan.pan.value=bus==='left_voice'?-.7:.7;source.connect(pan);pan.connect(this.nodes[bus]);}else source.connect(this.nodes[bus]);
  this.voiceSources.add(source);this.foreground.set(source,{start,end:start+buffer.duration,bus:'AI_VOICE'});
  const cleanup=()=>{this.foreground.delete(source);this.voiceSources.delete(source);this.eventVoiceCleanup.delete(source);source.disconnect();pan?.disconnect();};
  this.eventVoiceCleanup.set(source,cleanup);source.onended=cleanup;
  source.start(Math.max(start,this.context.currentTime));source.stop(deadline);return source;
 }
 private designSounds:SoundRenderer;
 private speechDucker:SpeechDucker;
 private bedDuck:GainNode;
 private sessionDuck:GainNode;
 private breathAudio:BreathAudio;private breathSound=true;private breathNextWord=0;onBreath:((event:BreathEvent)=>void)|undefined;
 get breathSoundEnabled(){return this.breathSound;}
 set breathSoundEnabled(enabled:boolean){this.breathSound=enabled;if(!enabled)this.breathAudio?.stop();}
 get scheduledBreaths(){return this.breathAudio.events;}
 onDesignSound:((event:SoundDesignEvent)=>void)|undefined;
 get ducked(){return this.speechDucker.active;}
 get duckingGains(){return {bed:this.bedDuck.gain.value,session:this.sessionDuck.gain.value};}
 private designDefaults=new PhaseSoundDefaults();
 private designSettings:SoundDesignSettings={enabled:false,defaults:true,bassFallback:false};
 private silenceGate:GainNode;
 private tickEngine:TickEngine;
 private tickEnabled=true;
 private tickDefaults=true;
 private tickPhase:SessionPhase|undefined;
 private echoPhase:SessionPhase|undefined;
 private voiceEchoes:VoiceEchoes;
 get scheduledVoiceEchoes(){return this.voiceEchoes.events;}
 get activeVoiceEchoes(){return this.voiceEchoes.activeCount;}
 configureVoiceEchoes(enabled:boolean){this.voiceEchoes.configure(enabled);}
 private tickDefaultBpm=-1;
 private tickOverride=false;
 private pulseCommand:DeviceCommand|undefined;
 private sessionHeld=false;
 private heldBedGains:Partial<Record<Bus,number>>={};
 get outputTime(){
  const timestamp=this.context.getOutputTimestamp?.();
  return timestamp?.contextTime&&timestamp.performanceTime?Math.min(this.context.currentTime,timestamp.contextTime+(this.context.state==='running'?Math.max(0,performance.now()-timestamp.performanceTime)/1000:0)):Math.max(0,this.context.currentTime-(this.context.outputLatency||this.context.baseLatency||0));
 }
 /** Planned audio time mapped to when samples reach the output device. */
 outputDelayMs(time:number){return Math.max(0,(time-this.outputTime)*1000);}
 updateSessionPhase(phase:SessionPhase,progress:number,running:boolean){
  if(!running||this.sessionHeld||this.eventMode)return;
  this.echoPhase=phase;this.voiceEchoes.phase(phase);
  this.designDefaults.updatePhase(phase);this.updateTickPhase(phase,progress,true);
 }
 pauseSession(){if(this.sessionHeld)return;this.heldBedGains={drone:this.nodes.drone.gain.value,noise:this.nodes.noise.gain.value};this.sessionHeld=true;this.tickEngine.pause();this.designSounds.pause();this.pauseEffects();for(const bus of ['SESSION','EFFECTS','AMBIENCE','drone','noise'] as Bus[])this.apply(bus,.015);if(this.tones)this.tones.gain.gain.setTargetAtTime(0,this.context.currentTime,.005);}
 resumeSession(){if(!this.sessionHeld)return;this.sessionHeld=false;for(const bus of ['SESSION','EFFECTS','AMBIENCE','drone','noise'] as Bus[])this.apply(bus,.015);if(this.preset)this.bed.start(this.preset);for(const bus of ['drone','noise'] as Bus[])if(this.heldBedGains[bus]!==undefined)this.nodes[bus].gain.setTargetAtTime(this.heldBedGains[bus]!,this.context.currentTime,.005);this.heldBedGains={};this.designSounds.resume();this.resumeEffects();if(this.tickEnabled)this.tickEngine.resume();}
 get tickStatus(){return {bpm:this.tickEngine.bpm,active:this.tickEngine.active,interval:this.tickEngine.interval,phaseMs:this.tickEngine.phaseMs(),activeCount:this.tickEngine.activeCount};}
 get scheduledTicks(){return this.tickEngine.events;}
 configureTick(enabled:boolean,defaults=true,dives=false){
  if(enabled!==this.tickEnabled||defaults!==this.tickDefaults){this.tickPhase=undefined;this.tickDefaultBpm=-1;this.tickOverride=false;}
  this.tickEnabled=enabled;this.tickDefaults=defaults;if(!enabled)this.tickEngine.stop();
  this.tickEngine.configureDives(dives,this.designSettings.bassFallback);
 }
 updateTickPhase(phase:SessionPhase,progress:number,running:boolean){
  if(!running||!this.tickEnabled||!this.tickDefaults)return;
  if(this.tickPhase!==phase){this.tickPhase=phase;this.tickOverride=false;this.tickDefaultBpm=-1;}
  const bpm=tickBpmForPhase(phase,progress);
  if(this.tickOverride||bpm===this.tickDefaultBpm)return;this.tickDefaultBpm=bpm;
  this.applyTicks([{type:'tick',operation:bpm?'on':'fade',...(bpm?{bpm}:{})}],this.context.currentTime+.035,false);
 }
 private applyTicks(cues:readonly TickCue[],time:number,explicit=true){
  if(!this.tickEnabled)return;
  for(const cue of cues.filter(validTickCue).slice(0,8)){
   if(explicit)this.tickOverride=true;this.tickEngine.apply(cue,time);
   if(cue.operation==='on'&&this.pulseCommand)this.scheduleDeviceCommands([this.pulseCommand],time);
   if(cue.operation==='off')this.pulseCommand=undefined;
  }
 }
 get scheduledDesignSounds(){return this.designSounds.events;}
 get activeDesignSounds(){return this.designSounds.activeCount;}
 configureSoundDesign(settings:Partial<SoundDesignSettings>){
  if(settings.enabled!==undefined&&settings.enabled!==this.designSettings.enabled||settings.defaults!==undefined&&settings.defaults!==this.designSettings.defaults)this.designDefaults.reset();
  this.designSettings={...this.designSettings,...settings};if(!this.designSettings.enabled){this.designSounds.stop();this.clearDesignSilence();}
 }
 resetSoundDesignSession(){this.designDefaults.reset();this.tickPhase=undefined;this.tickDefaultBpm=-1;this.tickOverride=false;}
 private clearDesignSilence(){this.silenceGate.gain.cancelScheduledValues(this.context.currentTime);this.silenceGate.gain.setValueAtTime(1,this.context.currentTime);}
 private bed:BackgroundBed;
 private preset:AudioPreset|undefined;
 private scriptSoundsEnabled=true;
 setScriptSoundsEnabled(enabled:boolean){this.scriptSoundsEnabled=enabled;}
 private controlSources=new Set<AudioBufferSourceNode>();
 private effectPlayback=new Map<AudioBufferSourceNode,{start:number;duration:number;offset:number;gain:GainNode;output:AudioNode;eventCue?:boolean;eventTrigger?:boolean}>();
 private pausedEffects:{buffer:AudioBuffer;loop:boolean;duration:number;offset:number;gain:number;output:AudioNode;eventCue?:boolean;eventTrigger?:boolean}[]=[];
 onDeviceCue:((command:DeviceCommand,time?:number,origin?:DeviceCueOrigin)=>void)|undefined;
 private foreground=new Map<AudioScheduledSourceNode,{start:number;end:number;bus:'EFFECTS'|'AI_VOICE'}>();
 /** Playback windows exclude queued future speech and trigger silence. Background beds stay independent. */
 foregroundOutputActive(bus?:'EFFECTS'|'AI_VOICE'){if(this.context.state!=='running'||this.muted||this.levels.MASTER===0||bus&&this.eventGates[bus]?.gain.value===0)return false;const now=this.context.currentTime;return [...this.foreground.values()].some(w=>(!bus||w.bus===bus)&&this.levels[w.bus]>0&&now>=w.start&&now<w.end);}
 private soundBuses={} as Record<TriggerSound|'moan',GainNode>;
 setSoundGain(kind:TriggerSound|'moan',db:number){const level=Number.isFinite(db)?Math.max(-24,Math.min(12,db)):0;this.soundBuses[kind].gain.setTargetAtTime(10**(level/20),this.context.currentTime,.02);}
 private wiperDuration(){const seconds=this.sequenceSettings.wiperSeconds;return Number.isFinite(seconds)?Math.min(20,Math.max(5,seconds)):5;}
 private variants={pop:'pop_ccp',wiper:'wiper',moan:'random'};
 private moanVariations=new MoanVariations();
 private sequenceSettings={...triggerSequenceDefaults};
 readonly scheduledSounds:{trigger:string;kind:string;phase:'before'|'after';time:number;duration:number;source:'local'|'generated';assetId:string}[]=[];
 configureTriggerSequence(settings:Partial<typeof triggerSequenceDefaults>,variants?:{pop:string;wiper:string;moan?:string}){this.sequenceSettings={...this.sequenceSettings,...settings};if(variants)this.variants={...this.variants,...variants};}

 private localSoundsPromise:Promise<void>|undefined;
 private localSounds=new Map<string,{buffer:AudioBuffer;gainDb:number}>();
 context:AudioContext; nodes:Record<Bus,GainNode>; analyser:AnalyserNode; meter:Uint8Array<ArrayBuffer>; private voiceSources=new Set<AudioBufferSourceNode>();private voicesEnd=0;private effectSources=new Set<AudioScheduledSourceNode>();private soundCache=new Map<TriggerSound,AudioBuffer>();readonly triggerEvents:{trigger:string;kind:TriggerSound;time:number}[]=[];private ambient:AudioBufferSourceNode|null=null;private tones:{left:OscillatorNode;right:OscillatorNode;merger:ChannelMergerNode;gain:GainNode}|null=null;private elementSources=new WeakMap<HTMLMediaElement,MediaElementAudioSourceNode>();
 levels:Record<Bus,number>={MASTER:.7,SESSION:.8,AI_VOICE:.85,AMBIENCE:0,EFFECTS:.2,MIC_MONITOR:0,main_voice:1,left_voice:10**(-18/20),right_voice:10**(-18/20),echo_voice:10**(-28/20),drone:10**(-24/20),noise:10**(-34/20),music_optional:1};muted=false; voiceEpoch=0;
 constructor(){this.context=new AudioContext({latencyHint:'interactive'});this.nodes=Object.fromEntries(buses.map(b=>[b,this.context.createGain()])) as Record<Bus,GainNode>;this.deliveryMix=new DeliveryMix(this.context);this.bedDuck=this.context.createGain();this.sessionDuck=this.context.createGain();this.bedDuck.connect(this.nodes.MASTER);this.sessionDuck.connect(this.nodes.MASTER);this.speechDucker=new SpeechDucker(this.context,this.bedDuck.gain,this.sessionDuck.gain);this.analyser=this.context.createAnalyser();this.analyser.fftSize=512;this.meter=new Uint8Array(256);this.voiceAnalyser=this.context.createAnalyser();this.voiceAnalyser.fftSize=512;this.nodes.AI_VOICE.connect(this.voiceAnalyser);for(const bus of buses){this.nodes[bus].gain.value=this.levels[bus];if(bus!=='MASTER'){const target=['main_voice','left_voice','right_voice','echo_voice'].includes(bus)?this.nodes.AI_VOICE:bus==='music_optional'?this.nodes.SESSION:bus==='SESSION'?this.sessionDuck:['drone','noise'].includes(bus)?this.bedDuck:this.nodes.MASTER;if(bus==='MIC_MONITOR')this.nodes[bus].connect(target);else{const gate=this.context.createGain();this.eventGates[bus]=gate;this.nodes[bus].connect(gate);gate.connect(this.deliveryMix.input(bus,target));}}}this.toneEventGate=this.context.createGain();this.toneEventGate.connect(this.nodes.MASTER);this.silenceGate=this.context.createGain();this.silenceGate.gain.value=1;this.nodes.MASTER.connect(this.silenceGate);this.silenceGate.connect(this.analyser);this.tickEngine=new TickEngine(this.context,this.nodes.EFFECTS);const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-1;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.12;this.analyser.connect(limiter);limiter.connect(this.context.destination);this.breathAudio=new BreathAudio(this.context,this.nodes.EFFECTS,(source,start,end)=>this.foreground.set(source,{start,end,bus:'EFFECTS'}),source=>this.foreground.delete(source));this.bed=new BackgroundBed(this.context,this.nodes.drone,this.nodes.noise);this.designSounds=new SoundRenderer(this.context,this.nodes.EFFECTS,(source,start,end)=>this.foreground.set(source,{start,end,bus:'EFFECTS'}),source=>this.foreground.delete(source));for(const kind of [...Object.keys(triggerSoundSettings.sounds),'moan'] as (TriggerSound|'moan')[]){const gain=this.context.createGain();gain.gain.value=1;gain.connect(this.nodes.EFFECTS);this.soundBuses[kind]=gain;}this.voiceEchoes=new VoiceEchoes(this.context,this.nodes.main_voice,(source,start,end)=>{this.voiceSources.add(source);this.foreground.set(source,{start,end,bus:'AI_VOICE'});},source=>{this.voiceSources.delete(source);this.foreground.delete(source);});}
 configurePreset(preset:AudioPreset,running:boolean){this.preset=preset;if(running)this.bed.start(preset);else this.bed.stop();if(this.sessionHeld){this.heldBedGains={...this.bed.gains};this.apply('drone',.015);this.apply('noise',.015);}}
 async init(){await this.context.resume();await Promise.all([this.localSoundsPromise??=this.loadLocalSounds(),this.designSounds.init(),this.tickEngine.init()]);}
 useOriginalDrone(enabled:boolean){this.bed.useOriginalDrone(enabled);}
 private async loadLocalSounds(){
  // Extension overlays run on third-party pages; never request recordings there.
  if(!/^http:\/\/(?:127\.0\.0\.1|localhost):6969$/.test(globalThis.location?.origin??''))return;
  try{
   const response=await fetch('/assets/sounds/tick_sub.wav',{signal:AbortSignal.timeout(5000)});
   if(response.ok){const buffer=await this.context.decodeAudioData(await response.arrayBuffer());
    if(buffer.numberOfChannels===1&&buffer.duration>=.04&&buffer.duration<=.08)this.localSounds.set('tick_sub',{buffer,gainDb:0});}
  }catch{/* Existing single-tick recording remains the fallback. */}
  try{const response=await fetch('/api/local-sounds/catalog',{signal:AbortSignal.timeout(4000)});if(!response.ok)return;
   const catalog=await response.json();if(!Array.isArray(catalog.assets))return;
   await Promise.allSettled(catalog.assets.filter((item:any)=>item.status==='available'&&['giggle','giggle_alt','snap','tick','wiper','wiper_alt','wiper_rain','pop','pop_alt','pop_smack','pop_ccp','pop_ccp_alt','pop_ccp_soft','inflate','squeak','moan','moan_alt','moan_third','bell','drone'].includes(item.id)&&item.url==='/api/local-sounds/'+item.id+'.wav').map(async(item:any)=>{
    const r=await fetch(item.url,{signal:AbortSignal.timeout(5000)});if(!r.ok)return;const buffer=await this.context.decodeAudioData(await r.arrayBuffer());
    if(buffer.duration>(item.id==='drone'?120:item.id.startsWith('wiper')?20:3)||!Number.isFinite(item.gainDb??0))return;
    const gainDb=Math.min(item.id==='drone'?24:0,Math.max(-60,item.gainDb??0));this.localSounds.set(item.id,{buffer,gainDb});if(item.id==='drone'&&buffer.numberOfChannels===2)this.bed.setOriginalDrone(buffer,gainDb);
   }));
  }catch{/* Local generated sounds remain available without private recordings. */}
 }
 playLocalSound(id:string){const sound=this.localSounds.get(id);if(!sound||id==='drone'||this.context.state!=='running')return false;
  const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=sound.buffer;gain.gain.value=10**(sound.gainDb/20);source.connect(gain);gain.connect(this.soundBuses[id.split('_')[0] as TriggerSound|'moan']??this.nodes.EFFECTS);this.effectSources.add(source);
  this.effectPlayback.set(source,{start:this.context.currentTime,duration:sound.buffer.duration,offset:0,gain,output:this.soundBuses[id.split('_')[0] as TriggerSound|'moan']??this.nodes.EFFECTS});this.foreground.set(source,{start:this.context.currentTime,end:this.context.currentTime+sound.buffer.duration,bus:'EFFECTS'});
  source.onended=()=>{this.foreground.delete(source);this.effectSources.delete(source);this.effectPlayback.delete(source);source.disconnect();gain.disconnect();};source.start();return true;
 }
 set(bus:Bus,level:number,duration=.12){this.levels[bus]=clamp(level);this.apply(bus,duration);}
 private apply(bus:Bus,duration=.12){const value=bus==='MASTER'&&this.muted||this.sessionHeld&&['SESSION','EFFECTS','AMBIENCE','drone','noise'].includes(bus)?0:this.levels[bus];const param=this.nodes[bus].gain;param.cancelScheduledValues(this.context.currentTime);param.setTargetAtTime(value,this.context.currentTime,Math.max(.001,duration/3));}
 mute(){this.muted=!this.muted;this.apply('MASTER');}
 attach(media:HTMLMediaElement){if(!this.elementSources.has(media)){const source=this.context.createMediaElementSource(media);source.connect(this.nodes.music_optional);this.elementSources.set(media,source);}}
 private sound(kind:TriggerSound|'moan'){
  const id=kind==='pop'?this.variants.pop:kind==='wiper'?this.variants.wiper:kind==='moan'?(this.variants.moan==='random'?this.moanVariations.next(this.localSounds.keys())??'moan':this.variants.moan):kind==='tick'?'tick_sub':kind;
  const local=this.localSounds.get(id)||this.localSounds.get(kind);if(local)return {...local,id:this.localSounds.has(id)?id:kind,source:'local' as const};
  if(kind==='moan')return;
  let buffer=this.soundCache.get(kind);if(!buffer){const samples=synthesizeTriggerSound(kind,this.context.sampleRate);buffer=this.context.createBuffer(2,samples[0].length,this.context.sampleRate);for(let ch=0;ch<2;ch++)buffer.getChannelData(ch).set(samples[ch]);this.soundCache.set(kind,buffer);}
  return {buffer,id:kind,gainDb:triggerSoundSettings.sounds[kind].gainDb,source:'generated' as const};
 }
 private cue(kind:TriggerSound|'moan',trigger:string,phase:'before'|'after',time:number,maxSeconds=Infinity,extraGain=1,durationOverride?:number,sound=this.sound(kind),eventCue=false){
  if(!sound)return 0;const duration=durationOverride??Math.min(kind==='wiper'?this.wiperDuration():sound.buffer.duration,maxSeconds);
  const node=this.context.createBufferSource(),gain=this.context.createGain();node.buffer=sound.buffer;if(duration>sound.buffer.duration)node.loop=true;gain.gain.value=10**(sound.gainDb/20)*extraGain;node.connect(gain);gain.connect(this.soundBuses[kind]);this.effectSources.add(node);
  this.scheduledSounds.push({trigger,kind,phase,time,duration,source:sound.source,assetId:sound.id});if(this.scheduledSounds.length>128)this.scheduledSounds.shift();
  this.effectPlayback.set(node,{start:time,duration,offset:0,gain,output:this.soundBuses[kind],eventCue,eventTrigger:eventCue});this.foreground.set(node,{start:time,end:time+duration,bus:'EFFECTS'});
  node.onended=()=>{this.foreground.delete(node);this.effectSources.delete(node);this.effectPlayback.delete(node);node.disconnect();gain.disconnect();};node.start(time);node.stop(time+duration);return duration;
 }
 private triggerPlan(trigger:string,options:Partial<TriggerSequenceOptions>={}){
  const settings={...this.sequenceSettings,...options};
  // Spoken one-shots use the selected Snap and fader without a full trigger tail.
  if(isSpokenOneShot(trigger)){
   settings.moan=false;settings.effectPauseMs=0;settings.plainPauseMs=0;settings.bubbleInflate=false;
   if(isSpokenSnap(trigger))settings.effects=false;else settings.snap=false;
  }
  if(options.sequenceEnabled===false){settings.snap=false;settings.moan=false;settings.effects=false;settings.effectPauseMs=0;settings.plainPauseMs=0;}const effect=settings.effects?effectForTrigger(trigger):undefined;
  const moanSound=settings.moan?this.sound('moan'):undefined;
  const moan=moanSound?Math.min(moanSound.buffer.duration,settings.moanMaxSeconds):0;
  const snap=settings.snap?(this.sound('snap')?.buffer.duration??0):0;
  const cues:{kind:TriggerSound;offset:number;duration:number;gain:number}[]=[];
  if(effect==='pop'&&settings.bubbleInflate){
   const inflate=this.sound('inflate')!.buffer.duration;cues.push({kind:'inflate',offset:0,duration:inflate,gain:.75});
   if(settings.bubbleSqueak){const duration=this.sound('squeak')!.buffer.duration;for(const fraction of [.25,.68])cues.push({kind:'squeak',offset:Math.max(0,Math.min(inflate-duration,inflate*fraction)),duration,gain:settings.bubbleSqueakGain});}
   const gap=Number.isFinite(settings.bubbleGapMs)?Math.max(0,Math.min(1500,settings.bubbleGapMs))/1000:.4;
   cues.push({kind:'pop',offset:0,duration:this.sound('pop')!.buffer.duration,gain:1});
  }else if(effect)cues.push({kind:effect,offset:0,duration:effect==='wiper'?this.wiperDuration():this.sound(effect)!.buffer.duration,gain:1});
  if(settings.effects&&trigger.trim().toUpperCase()==='GOOD GIRL')cues.push({kind:'tick',offset:0,duration:this.sound('tick')!.buffer.duration,gain:1});
  const effectDuration=Math.max(0,...cues.map(c=>c.offset+c.duration));
  const pause=Math.min(10,Math.max(0,(effectForTrigger(trigger)?settings.effectPauseMs:settings.plainPauseMs)/1000));
  return {settings,effect,cues,moan,moanSound,snap,effectDuration,pause,prefix:0};
 }
 private scheduleScriptCues(cues:readonly PlaybackCue[],start:number){
  if(!Array.isArray(cues))return 0;
  let offset=0;
  for(const cue of (cues as readonly PlaybackCue[]).slice(0,32)){
   if(typeof cue!=='string'){
    const parsed=DeviceCommandSchema.safeParse(cue);if(!parsed.success)continue;
    this.scheduleDeviceCommands([parsed.data],start+offset);continue;
   }
   if(!scriptCueNames.includes(cue))continue;
   if(cue==='PAUSE_5'||cue==='PAUSE_10'){offset+=cue==='PAUSE_5'?5:10;continue;}
   if(cue==='DRONE_ON'||cue==='DRONE_OFF'){
    const source=this.context.createBufferSource();source.buffer=this.context.createBuffer(1,1,this.context.sampleRate);source.connect(this.nodes.main_voice);this.controlSources.add(source);
    source.onended=()=>{this.controlSources.delete(source);source.disconnect();if(cue==='DRONE_OFF')this.bed.stop();else if(this.preset)this.bed.start(this.preset);};source.start(start+offset);continue;
   }
   const kind=({SNAP:'snap',MOAN:'moan',WIPERS:'wiper',INFLATE:'inflate',SQUEAK:'squeak',POP:'pop',BELL:'bell',TICK:'tick'} as const)[cue];
   if(!this.scriptSoundsEnabled)continue;
   if(kind==='snap'&&!this.sequenceSettings.snap||kind==='moan'&&!this.sequenceSettings.moan||!['snap','moan','tick'].includes(kind)&&!this.sequenceSettings.effects)continue;
   offset+=this.cue(kind,'script','after',start+offset,kind==='moan'?.5:Infinity,kind==='moan'?this.sequenceSettings.moanGain:1);
  }
  return offset;
 }
 private scheduleDeviceCommands(commands:readonly DeviceCommand[],time:number){
  const valid=commands.slice(0,16).flatMap(command=>{const parsed=DeviceCommandSchema.safeParse(command);return parsed.success?[parsed.data]:[];});
  if(!valid.length||this.sessionHeld)return;
  // Send ahead of playback; the controller schedules locally rather than
  // waiting for a main-thread callback after the word has already started.
  for(const command of valid){
   if(command.operation!=='buzz'&&(command.channel==='vib'||command.channel==='both'))this.pulseCommand=command.operation==='pattern'&&command.pattern==='pulse'?command:undefined;
   const synchronized=command.channel==='vib'&&command.operation==='pattern'&&command.pattern==='pulse'&&this.tickEngine.active?{...command,bpm:this.tickEngine.bpm,phaseMs:this.tickEngine.phaseMs(time)}:command;
   this.onDeviceCue?.(synchronized,time);
  }
 }
 async playScriptCues(cues:readonly PlaybackCue[],onEnd:()=>void,ticks:readonly TickCue[]=[]){
  this.dualGapStart=undefined;
  const start=Math.max(this.context.currentTime+.035,this.voicesEnd),duration=Math.max(.002,this.scheduleScriptCues(cues,start));
  this.applyTicks(ticks,start);
  const source=this.context.createBufferSource();source.buffer=this.context.createBuffer(1,Math.ceil(duration*this.context.sampleRate),this.context.sampleRate);source.connect(this.nodes.main_voice);this.voiceSources.add(source);this.voicesEnd=start+duration;
  source.onended=()=>{this.voiceSources.delete(source);source.disconnect();if(!this.voiceSources.size)this.voicesEnd=this.context.currentTime;onEnd();};source.start(start);
 }
 async playVoice(bytes:ArrayBuffer,onStart:(start:number,duration:number,wordTime:number)=>void,onEnd:()=>void,trigger?:TriggerSequenceOptions,script?:{voiceTrack?:VoiceTrack;before?:PlaybackCue[];after?:PlaybackCue[];spokenSeconds?:number;sounds?:SoundCue[];ticks?:TickCue[];devicesAtWord?:DeviceCommand[];text?:string;phase?:SessionPhase;wordStart?:number;conversation?:boolean;breath?:BreathCue;words?:{word:string;atMs:number}[]}){
  const epoch=this.voiceEpoch;const decoded=await this.context.decodeAudioData(bytes);if(epoch!==this.voiceEpoch){onEnd();return;}
  if(script?.voiceTrack?.speaker==='bambi'){
   const spoken=Math.min(decoded.duration,Math.max(0,script.spokenSeconds??decoded.duration));
   const window=backgroundVoiceWindow(this.context.currentTime,this.voicesEnd,this.dualGapStart,spoken,decoded.duration,script.voiceTrack.reverbMs/1000);
   this.dualGapStart=undefined;
   const mono=this.context.createBuffer(1,Math.ceil(window.duration*decoded.sampleRate),decoded.sampleRate),samples=mono.getChannelData(0);
   for(let ch=0;ch<decoded.numberOfChannels;ch++){const input=decoded.getChannelData(ch);for(let i=0;i<Math.min(input.length,Math.ceil(spoken*decoded.sampleRate));i++)samples[i]+=input[i]/decoded.numberOfChannels;}
   const node=this.context.createBufferSource();node.buffer=mono;
   const cleanup=connectVoiceTrack(this.context,node,this.nodes.main_voice,script.voiceTrack);this.dualVoiceCleanup.set(node,cleanup);
   this.voiceSources.add(node);this.voicesEnd=window.end;this.foreground.set(node,{start:window.start,end:window.start+spoken,bus:'AI_VOICE'});
   this.speechDucker.schedule(node,window.start,window.start+spoken,false);
   onStart(window.start,window.duration,window.start+(script.wordStart??0));
   node.onended=()=>{this.foreground.delete(node);this.voiceSources.delete(node);this.speechDucker.forget(node);cleanup();this.dualVoiceCleanup.delete(node);if(!this.voiceSources.size)this.voicesEnd=this.context.currentTime;onEnd();};node.start(window.start);return;
  }
  this.dualGapStart=undefined;
  const triggerEnabled=!!trigger&&trigger.sequenceEnabled!==false;
  const design=!script?.breath&&!(trigger&&isSpokenOneShot(trigger.trigger))&&(!script?.conversation||triggerEnabled)&&this.designSettings.enabled&&!!script?.text?.trim();
  const requested=(Array.isArray(script?.sounds)?script.sounds:[]).filter(validSoundCue).slice(0,8);
  const designed=design?(this.designSettings.defaults?this.designDefaults.plan(script!.text!,triggerEnabled?trigger?.trigger:undefined,script?.phase,requested):requested.map(cue=>({cue,at:'start' as const,reason:'marker' as const}))):[];
  const originalSpoken=Number.isFinite(trigger?.spokenSeconds??script?.spokenSeconds)?Math.min(decoded.duration,Math.max(0,(trigger?.spokenSeconds??script?.spokenSeconds)!)):decoded.duration;
  const rms=bufferRms(decoded,originalSpoken)||.08;
  const wordOffset=Number.isFinite(script?.wordStart)&&script!.wordStart!>=0&&script!.wordStart!<originalSpoken?script!.wordStart!:firstAudibleOffset(decoded,originalSpoken);
  const pauseSeconds=(ms:number|undefined)=>Number.isFinite(ms)?Math.min(10000,Math.max(0,ms!))/1000:0;
  // Consecutive breath instructions reserve word-to-word time, including TTS leading silence.
  const next=script?.breath&&this.breathNextWord?Math.max(this.voicesEnd-wordOffset,this.breathNextWord-wordOffset):this.voicesEnd;
  let start=Math.max(this.context.currentTime+.035,next);start+=this.scheduleScriptCues(script?.before??[],start);
  const pre=trigger?pauseSeconds(trigger.prePauseMs):0,post=trigger?pauseSeconds(trigger.postPauseMs):0;
  const spokenStart=start+pre,wordTime=spokenStart+wordOffset,spokenEnd=spokenStart+originalSpoken;
  const giggleMs=giggleOffset(script?.words??[],script?.text);
  if(giggleMs!==undefined&&giggleMs<originalSpoken*1000)this.playGiggle(spokenStart+giggleMs/1000,spokenEnd);
  const breathEvent=script?.breath?this.breathAudio.schedule(script.breath,wordTime,rms,this.breathSoundEnabled):undefined;
  if(breathEvent)this.onBreath?.(breathEvent);
  this.breathNextWord=breathEvent?wordTime+breathEvent.duration:0;
  const echoEnd=script?.voiceTrack||script?.breath||breathInstruction(script?.text??'')||trigger&&isSpokenOneShot(trigger.trigger)?spokenEnd:this.voiceEchoes.schedule(decoded,wordTime,originalSpoken,wordOffset,script?.phase??this.echoPhase);
  let effectsEnd=Math.max(spokenEnd,echoEnd,breathEvent?wordTime+breathEvent.duration:0),automaticPause=trigger?0:Math.max(0,decoded.duration-originalSpoken);
  const handled=new Set<string>();
  if(trigger){
   const plan=this.triggerPlan(trigger.trigger,trigger);
   automaticPause=plan.pause;
   if(plan.moan)effectsEnd=Math.max(effectsEnd,wordTime+this.cue('moan',trigger.trigger,'after',wordTime,plan.moan,plan.settings.moanGain,undefined,plan.moanSound));
   if(plan.snap){effectsEnd=Math.max(effectsEnd,wordTime+this.cue('snap',trigger.trigger,'after',wordTime));handled.add('snap');}
   for(const cue of plan.cues){
    // An explicit Wiper marker changes its duration, while keeping the selected recording and fader.
    const marker=design?requested.find(sound=>sound.name===cue.kind):undefined;
    const duration=cue.kind==='wiper'&&marker?.durationMs?marker.durationMs/1000:cue.duration;
    const cueTime=cue.kind==='tick'?spokenEnd:wordTime+cue.offset;
    const actual=this.cue(cue.kind,trigger.trigger,'after',cueTime,duration,cue.gain,duration);
    effectsEnd=Math.max(effectsEnd,cueTime+actual);handled.add(cue.kind);
   }
   if(triggerEnabled){this.triggerEvents.push({trigger:trigger.trigger,kind:plan.effect??'snap',time:wordTime});if(this.triggerEvents.length>64)this.triggerEvents.shift();}
  }
  if(!script?.conversation){this.tickEngine.setVoiceLevel(rms);this.applyTicks(script?.ticks??[],wordTime);}
  let designCount=0;
  for(const plan of designed){
   if(trigger&&!triggerEnabled&&plan.reason!=='phase')continue;
   const kind=plan.cue.name;
   const shared=kind==='snap'||kind==='wiper'||kind==='pop';
   // Classic recorded effects own automatic trigger cues; explicit markers may add a different effect once.
   if(shared&&trigger&&(plan.reason!=='marker'||handled.has(kind)||!triggerEnabled))continue;
   if(shared&&(kind==='snap'?!this.sequenceSettings.snap:!this.sequenceSettings.effects))continue;
   const time=trigger?wordTime:plan.at==='end'?spokenEnd:wordTime;
   const selected=shared?this.sound(kind):undefined;
   const duration=this.designSounds.schedule(plan.cue,time,rms,this.designSettings.bassFallback,plan.reason,
     selected?{...selected,output:this.soundBuses[kind as TriggerSound]}:undefined);
   effectsEnd=Math.max(effectsEnd,time+duration);designCount++;
   this.onDesignSound?.(this.designSounds.events.at(-1)!);
  }
  if(script?.devicesAtWord?.length)this.scheduleDeviceCommands(script.devicesAtWord,wordTime);
  else if(triggerEnabled&&!isSpokenOneShot(trigger!.trigger)&&!this.sessionHeld)this.onDeviceCue?.({type:'device',channel:'vib',operation:'buzz',intensity:.1,durationMs:150},wordTime,'speech');
  else if(designCount&&designed.length&&!script?.conversation)this.scheduleDeviceCommands(soundDeviceCommands(designed[0].cue,this.designSettings.bassFallback),wordTime);
  const after=script?.after??[],explicitPause=after.some(cue=>cue==='PAUSE_5'||cue==='PAUSE_10');
  const afterStart=effectsEnd+post,afterDuration=this.scheduleScriptCues(after,afterStart);
  const pause=script?.breath?0:explicitPause?0:designCount?Math.max(2,automaticPause):automaticPause;
  const duration=Math.max(.0001,afterStart-start+afterDuration+pause);
  const audio=this.context.createBuffer(decoded.numberOfChannels,Math.max(1,Math.ceil(duration*decoded.sampleRate)),decoded.sampleRate);
  for(let ch=0;ch<decoded.numberOfChannels;ch++)audio.getChannelData(ch).set(decoded.getChannelData(ch).subarray(0,Math.round(originalSpoken*decoded.sampleRate)),Math.round(pre*decoded.sampleRate));
  // Trigger pauses leave the continuous drone intact. Phase transitions may still reserve full silence.
  if(designCount&&!trigger){
   const silenceStart=afterStart+afterDuration,silenceEnd=start+audio.duration;
   this.silenceGate.gain.setValueAtTime(1,Math.max(start,silenceStart-.003));this.silenceGate.gain.linearRampToValueAtTime(0,silenceStart);
   this.silenceGate.gain.setValueAtTime(0,silenceEnd);this.silenceGate.gain.setValueAtTime(1,silenceEnd);
  }
  const node=this.context.createBufferSource();node.buffer=audio;
  const cleanup=script?.voiceTrack?connectVoiceTrack(this.context,node,this.nodes.main_voice,script.voiceTrack):()=>node.disconnect();
  if(script?.voiceTrack)this.dualVoiceCleanup.set(node,cleanup);else node.connect(this.nodes.main_voice);
  this.voicesEnd=start+audio.duration;
  // Effects and trigger tails finish before the background speaks. Short pauses
  // remain silent; missing eligible gaps become a new gap after the Owner.
  if(script?.voiceTrack&&pause>=.9)this.dualGapStart=afterStart+afterDuration;this.voiceSources.add(node);
  this.speechDucker.schedule(node,wordTime,Math.max(spokenEnd,echoEnd),!!trigger);
  this.foreground.set(node,{start:spokenStart,end:spokenEnd,bus:'AI_VOICE'});
  onStart(spokenStart,audio.duration-(spokenStart-start),wordTime);node.onended=()=>{this.foreground.delete(node);this.voiceSources.delete(node);this.speechDucker.forget(node);cleanup();this.dualVoiceCleanup.delete(node);if(!this.voiceSources.size)this.voicesEnd=this.context.currentTime;onEnd();};node.start(start);
 }

 stopVoice(fade=true,preserveSession=false){this.setNarrationDelivery();this.dualGapStart=undefined;this.voiceEchoes.stop();this.breathNextWord=0;this.breathAudio.stop();if(preserveSession)this.clearDesignSilence();else this.stopEffects();if(!preserveSession){this.tickEngine.stop();this.tickDefaultBpm=-1;this.pulseCommand=undefined;}for(const source of this.controlSources){source.onended=null;try{source.stop();}catch{}source.disconnect();}this.controlSources.clear();this.voiceEpoch++;const p=this.nodes.AI_VOICE.gain;p.cancelScheduledValues(this.context.currentTime);p.setTargetAtTime(0,this.context.currentTime,.008);for(const node of this.voiceSources){this.foreground.delete(node);node.onended=null;try{node.stop(this.context.currentTime+(fade?.035:0));}catch{}}this.voiceSources.clear();for(const cleanup of this.dualVoiceCleanup.values())cleanup();this.dualVoiceCleanup.clear();for(const cleanup of this.eventVoiceCleanup.values())cleanup();this.eventVoiceCleanup.clear();this.voicesEnd=this.context.currentTime;this.speechDucker.clear();p.setValueAtTime(this.levels.AI_VOICE,this.context.currentTime+.04);}
 ambience(on:boolean){if(on&&this.ambient)return;if(this.ambient){try{this.ambient.stop();}catch{}this.ambient=null;}if(!on)return;const buffer=this.context.createBuffer(2,this.context.sampleRate*4,this.context.sampleRate);for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);let smooth=0;for(let i=0;i<data.length;i++){smooth=(smooth+(Math.random()*2-1)*.02)/1.02;data[i]=smooth*.35;}}const node=this.context.createBufferSource();node.buffer=buffer;node.loop=true;const low=this.context.createBiquadFilter();low.type='lowpass';low.frequency.value=650;node.connect(low);low.connect(this.nodes.AMBIENCE);node.start();this.ambient=node;}
 private voiceAnalyser!:AnalyserNode;
 private voiceMeter=new Float32Array(512);
 visualSignal(){
  const time=this.outputTime;
  const audible=!this.muted&&this.levels.MASTER>0&&this.silenceGate.gain.value>0;
  const voiceActive=audible&&this.levels.AI_VOICE>0&&[...this.foreground.values()].some(w=>w.bus==='AI_VOICE'&&time>=w.start&&time<w.end);
  let rms=0;
  if(voiceActive){this.voiceAnalyser.getFloatTimeDomainData(this.voiceMeter);for(const sample of this.voiceMeter)rms+=sample*sample;rms=Math.sqrt(rms/this.voiceMeter.length);}
  const tick=this.tickEngine.visualSignal(time);
  return {time,voice:clamp(rms/.08),tick:{...tick,active:tick.active&&audible&&!this.sessionHeld&&this.levels.EFFECTS>0}};
 }
 level(){this.analyser.getByteFrequencyData(this.meter);return this.meter.reduce((a,b)=>a+b,0)/this.meter.length/255;}
 brainwave(on:boolean,carrier=200,beat=2,volume=.1){if(!on){if(this.tones){this.tones.left.stop();this.tones.right.stop();this.tones.left.disconnect();this.tones.right.disconnect();this.tones.merger.disconnect();this.tones.gain.disconnect();this.tones=null;}return;}if(!this.tones){const left=this.context.createOscillator(),right=this.context.createOscillator(),merger=this.context.createChannelMerger(2),gain=this.context.createGain();left.connect(merger,0,0);right.connect(merger,0,1);merger.connect(gain);gain.connect(this.toneEventGate);this.tones={left,right,merger,gain};gain.gain.value=0;left.start();right.start();}this.tones.left.frequency.setTargetAtTime(clamp(carrier,20,1000),this.context.currentTime,.02);this.tones.right.frequency.setTargetAtTime(clamp(carrier+beat,20,1000),this.context.currentTime,.02);this.tones.gain.gain.setTargetAtTime(clamp(volume),this.context.currentTime,.02);}
 triggerSound(trigger='',when=this.context.currentTime){
  if(this.context.state!=='running')return;
  const plan=this.triggerPlan(trigger),start=Math.max(when,this.context.currentTime,this.voicesEnd);
  if(plan.moan)this.cue('moan',trigger,'before',start,plan.moan,plan.settings.moanGain,undefined,plan.moanSound);
  if(plan.snap)this.cue('snap',trigger,'before',start);
  for(const cue of plan.cues)this.cue(cue.kind,trigger,'after',start+plan.prefix+cue.offset,cue.duration,cue.gain);
  this.voicesEnd=start+plan.prefix+plan.effectDuration+plan.pause;
  this.triggerEvents.push({trigger,kind:plan.effect??'snap',time:start+plan.prefix});if(this.triggerEvents.length>64)this.triggerEvents.shift();
 }

 private pauseEffects(){
  const now=this.context.currentTime;
  for(const [source,window] of this.effectPlayback){if(source.buffer&&now>=window.start&&now<window.start+window.duration)this.pausedEffects.push({buffer:source.buffer,loop:source.loop,duration:window.start+window.duration-now,offset:window.offset+now-window.start,gain:window.gain.gain.value,output:window.output,eventCue:window.eventCue,eventTrigger:window.eventTrigger});}
  this.stopEffects(false,false);
 }
 private resumeEffects(){
  const now=this.context.currentTime,paused=this.pausedEffects;this.pausedEffects=[];
  for(const sound of paused){
   const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=sound.buffer;source.loop=sound.loop;gain.gain.value=sound.gain;source.connect(gain);gain.connect(sound.output);
   this.effectSources.add(source);this.effectPlayback.set(source,{start:now,duration:sound.duration,offset:sound.offset,gain,output:sound.output,eventCue:sound.eventCue,eventTrigger:sound.eventTrigger});this.foreground.set(source,{start:now,end:now+sound.duration,bus:'EFFECTS'});
   source.onended=()=>{this.foreground.delete(source);this.effectSources.delete(source);this.effectPlayback.delete(source);source.disconnect();gain.disconnect();};source.start(now,sound.loop?sound.offset%sound.buffer.duration:sound.offset);source.stop(now+sound.duration);
  }
 }
 stopEffects(includeDesign=true,clearPaused=true){if(clearPaused)this.pausedEffects=[];if(includeDesign){this.designSounds.stop();this.clearDesignSilence();}for(const source of this.effectSources){this.foreground.delete(source);source.onended=null;try{source.stop();}catch{}source.disconnect();}for(const window of this.effectPlayback.values())window.gain.disconnect();this.effectSources.clear();this.effectPlayback.clear();}
 stop(){this.sessionHeld=false;this.bed.stop();this.brainwave(false);this.stopVoice(false);this.ambience(false);void this.context.suspend();}
}
