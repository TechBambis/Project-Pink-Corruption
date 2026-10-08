// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {PlaybackInputGuard} from './activity';
import {speechDetectionOptions} from './detector';
import {WorkerSpeechDetector} from './detector-client';
import {Message} from '@ricky0123/vad-web/dist/messages';
export type SpeechCaptureEvent={type:'frame';pcm:Float32Array}|{type:'start'|'reset'};
/** Audio stays local; only confirmed speech can interrupt and reach recognition. */
export class Microphone {
 stream:MediaStream|null=null;private context:AudioContext|null=null;private processor:AudioWorkletNode|null=null;
 inputLevel=0;recording=false;speechPending=false;vad=false;blocked=false;protectedPlayback=true;
 private detector:WorkerSpeechDetector|null=null;private detectorController:AbortController|null=null;private guard=new PlaybackInputGuard();private epoch=0;private lastSpeechAt=0;private sensitivity='balanced';private silenceMs=650;
 constructor(private onSpeech:()=>void,private onEnd:(wav:Blob,speechEndAt:number)=>void,private onLevel:(level:number)=>void,private outputActive:()=>boolean=()=>false,private onError:(error:unknown)=>void=()=>{},private onStream:(event:SpeechCaptureEvent)=>void=()=>{}){}
 configure(mode:string,sensitivity:string,silenceMs=650,interruptible=true,listenDuringPlayback=false){
  const protectedPlayback=(!interruptible&&!listenDuringPlayback)||mode!=='headphones';if(this.protectedPlayback!==protectedPlayback)this.discard();
  this.protectedPlayback=protectedPlayback;this.sensitivity=sensitivity;this.silenceMs=silenceMs;this.detector?.configure(sensitivity,silenceMs);
 }
 async init(){
  if(this.stream)return;const epoch=this.epoch;
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
  if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
  this.stream=stream;this.guard.reset();const context=new AudioContext();this.context=context;
  const detectorController=new AbortController();this.detectorController=detectorController;
  try{
   const detector=await WorkerSpeechDetector.create(event=>{
    if(epoch!==this.epoch||!this.vad||this.guard.blocked(this.outputActive(),performance.now(),this.protectedPlayback))return;
    if(event.msg===Message.FrameProcessed){this.onStream({type:'frame',pcm:event.frame});const rms=Math.sqrt(event.frame.reduce((sum,x)=>sum+x*x,0)/event.frame.length);const speech=event.probs.isSpeech>=speechDetectionOptions(this.sensitivity).positiveSpeechThreshold;if(speech)this.lastSpeechAt=performance.now();this.onLevel(speech?rms:0);}
    // Show tentative speech immediately; only confirmed classified speech takes the turn.
    if(event.msg===Message.SpeechStart){this.speechPending=true;this.onLevel(this.inputLevel);}
    if(event.msg===Message.SpeechRealStart){this.speechPending=false;this.recording=true;this.onSpeech();this.onStream({type:'start'});this.onLevel(this.inputLevel);}
    if(event.msg===Message.VADMisfire){this.speechPending=false;this.recording=false;this.lastSpeechAt=0;this.onLevel(0);}
    if(event.msg===Message.SpeechEnd){const confirmed=this.recording;this.speechPending=false;this.recording=false;if(confirmed)this.onEnd(toWav(event.audio,16000),this.lastSpeechAt||performance.now());this.lastSpeechAt=0;this.onLevel(0);}
   },error=>{if(epoch===this.epoch){this.stop();this.onError(error);}},detectorController.signal);
   if(epoch!==this.epoch){await detector.destroy();return;}this.detector=detector;detector.configure(this.sensitivity,this.silenceMs);
   await context.audioWorklet.addModule('/capture-worklet.js');if(epoch!==this.epoch)return;
   const source=context.createMediaStreamSource(stream);this.processor=new AudioWorkletNode(context,'bambi-capture');const mute=context.createGain();mute.gain.value=0;
   source.connect(this.processor);this.processor.connect(mute);mute.connect(context.destination);
   this.processor.port.onmessage=e=>{if(epoch===this.epoch)this.processFrame(e.data as Float32Array,context.sampleRate);};await context.resume();
  }catch(error){if(epoch===this.epoch)this.stop();throw error;}
 }
 private processFrame(data:Float32Array,rate:number){
  this.inputLevel=Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);
  this.blocked=this.guard.blocked(this.outputActive(),performance.now(),this.protectedPlayback);
  if(this.blocked||!this.vad){this.discard();this.onLevel(0);return;}
  this.detector?.push(data,rate);
 }
 private discard(){this.recording=false;this.speechPending=false;this.lastSpeechAt=0;this.detector?.reset();this.onStream({type:'reset'});}
 stop(){this.inputLevel=0;this.epoch++;this.vad=false;this.detectorController?.abort();this.detectorController=null;this.discard();this.blocked=false;this.guard.reset();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.processor?.disconnect();this.processor=null;void this.context?.close();this.context=null;const detector=this.detector;this.detector=null;void detector?.destroy().catch(()=>{});}
}
export function toWav(pcm:Float32Array,sampleRate:number){const ratio=sampleRate/16000;const count=Math.floor(pcm.length/ratio);const buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);const ascii=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};ascii(0,'RIFF');view.setUint32(4,36+count*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,count*2,true);for(let i=0;i<count;i++){const index=i*ratio,a=Math.floor(index),fraction=index-a;const v=pcm[a]*(1-fraction)+(pcm[a+1]||0)*fraction;view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,v*32767)),true);}return new Blob([buffer],{type:'audio/wav'});}
