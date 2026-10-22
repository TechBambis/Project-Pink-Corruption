// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {breathInstruction,type BreathCue} from './breath';
import { lines } from '../ai';
import {scriptUnits,boundedSpeechUnits,type PlaybackCue} from './script';
import type {SoundCue} from '../audio/sound-design';
import type {DeviceCommand} from '../devices/commands';
import type {TickCue} from '../audio/tick';
import {isSpokenOneShot,implicitTriggerNames} from '../../config/trigger-sequence';
import {readFileSync} from 'node:fs';
import {DualVoiceSession,voiceScriptRuns,type VoiceTrack} from './dual-voice';
import {findTriggers} from '../../config/trigger-sounds';
import {triggerAliases} from '../../config/trigger-sequence';
import {speechRendererQueue,fetchAvailableRenderer} from './renderer-queue';
import { deliveryProfiles, deliveryText, type DeliveryMode } from '../session-director/delivery';
export interface Caption {word:string;start_time:number;end_time:number}
export interface SpeechChunk {stream?:SpeechStreamPacket;history_mode?:'complete';voice_track?:VoiceTrack;audio:string;audio_format:string;timestamps:Caption[];text?:string;spoken_seconds?:number;pause_ms?:number;trigger?:string;pre_pause_ms?:number;post_pause_ms?:number;cues_before?:PlaybackCue[];cues_after?:PlaybackCue[];sounds?:SoundCue[];ticks?:TickCue[];devices_at_word?:DeviceCommand[];control?:boolean;breath?:BreathCue}
import {isMossVoice,type SpeechCapabilities,type SpeechStreamPacket} from './capabilities';
export {isMossVoice,mossCapabilities,type SpeechCapabilities,type SpeechStreamPacket} from './capabilities';
export interface SpeechProvider {capabilities:SpeechCapabilities;voices():Promise<string[]>;speak(text:string,voice:string,speed:number,signal:AbortSignal,preset?:string,triggerNames?:string[],isolatedVoice?:boolean,dualVoice?:DualVoiceSession):AsyncGenerator<SpeechChunk>}
export class Kokoro implements SpeechProvider {
 capabilities:SpeechCapabilities={languages:['en'],streaming:true,wordTimings:true,scriptControls:true,voiceBlending:true};
 constructor(public url='http://127.0.0.1:8882'){}
 renderHeaders():Record<string,string>{
  const headers:Record<string,string>={'Content-Type':'application/json'};
  // Credentials belong to the loopback service, never to a remote custom URL.
  const target=new URL(this.url);
  if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname))return headers;
  let token=process.env.BAMBI_TTS_TOKEN;
  if(token===undefined){try{token=readFileSync(process.env.BAMBI_TTS_TOKEN_FILE||'runtime/tts-access.token','utf8').trim();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  if(token!==undefined){if(!/^[a-f0-9]{64}$/.test(token))throw Error('Invalid local speech credential');headers['X-Bambi-TTS-Token']=token;}
  return headers;
 }
 async voices(){const r=await fetch(this.url+'/v1/audio/voices',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Kokoro unavailable');const x=await r.json();return x.voices.map((v:string|{id:string})=>typeof v==='string'?v:v.id);}
 async *speak(text:string,voice:string,speed:number,signal:AbortSignal,preset='bambi_local_clean',triggerNames?:string[],isolatedVoice=false,dualVoice?:DualVoiceSession,delivery?:DeliveryMode,onTiming?:(name:string,ms:number)=>void):AsyncGenerator<SpeechChunk>{
 triggerNames=implicitTriggerNames(triggerNames??[]);
 if(delivery)text=deliveryText(text);
 const runs=/\[(?:owner\]|bambi[:\]])/i.test(text)?voiceScriptRuns(text,!!dualVoice):[{speaker:'owner' as const,text}];
 for(const run of runs){
 const background=run.speaker==='bambi';
 // Background fragments carry no effects, hardware commands or trigger sequences.
 if(background&&findTriggers(run.text,[...triggerNames??[],...triggerAliases]).length)continue;
 const content=background?run.text.replace(/…|\.{3,}/g,' ').replace(/\[(?!pause:)[^\]]*\]/gi,''):run.text;
 const track=dualVoice?.track(run.speaker);
 const nativeMoss=!background&&isMossVoice(voice);
 for(const unit of boundedSpeechUnits(background?[{text:content}]:scriptUnits(content,triggerNames),nativeMoss?400:3000,nativeMoss?40:Infinity)){
 if(!unit.text.trim()&&!('control' in unit&&unit.control))continue;
 if(unit.control){yield {audio:'',audio_format:'wav',timestamps:[],text:'',control:true,cues_before:unit.cuesBefore,ticks:unit.ticks};continue;}
 const queuedAt=performance.now();
 const release=await speechRendererQueue(this.url).acquire(signal,isolatedVoice?0:10);
 onTiming?.('renderer-queue-wait',performance.now()-queuedAt);
 try{
 const renderAt=performance.now();
 const breath=background?undefined:unit.breath??breathInstruction(unit.text);
 const moss=!background&&isMossVoice(voice);
 if(!background&&voice.includes('moss_')&&!moss)throw Error('MOSS uses one installed reference without voice blending');
 // A paced instruction is spoken once on both renderer and browser layers.
 const pause=delivery?deliveryProfiles[delivery].phrasePauseMs:undefined;
 const overrides=moss?{speed:1,pitchSemitones:0,sampleRate:48000,processing:{enabled:false},layers:{left_voice:{enabled:false},right_voice:{enabled:false}},drone:{enabled:false},noise:{enabled:false}}:isolatedVoice||breath||dualVoice||delivery?{
  ...((isolatedVoice||breath||dualVoice)?{layers:{left_voice:{enabled:false},right_voice:{enabled:false}},processing:{echoEnabled:false}}:{}),
  ...(dualVoice?{pitchSemitones:background?1:-2,mix:{main_voice:0}}:{}),
  ...((isolatedVoice||background)?{timing:{normal:0,short:0,medium:0,long:0,transition:0}}:pause!==undefined?{timing:{normal:pause,short:pause,medium:pause,long:pause,transition:pause}}:{}),
 }:undefined;
 const r=await fetchAvailableRenderer(()=>fetch(this.url+'/dev/captioned_speech',{method:'POST',redirect:'error',headers:this.renderHeaders(),signal,body:JSON.stringify({model:'kokoro',...(moss?{provider:'moss',seed:41,phraseMode:'passage',whole_utterance:!!(isolatedVoice||dualVoice||breath||unit.trigger||unit.sounds?.length||unit.devicesAtWord?.length)}:{}),input:unit.text,voice:background?(voice==='af_bella'?'af_heart':'af_bella'):voice,speed:moss?1:background?.7:speed,preset,response_format:'wav',stream:true,return_timestamps:true,...(overrides?{overrides}:{}),...('trigger' in unit&&unit.trigger&&!isSpokenOneShot(unit.trigger)?{trigger:true}:{})})}),signal).catch(error=>{
  signal.throwIfAborted();
  if(error instanceof TypeError&&error.message==='fetch failed')throw Error('Local voice service is unreachable. Start Bambi Local again, then retry preparation.',{cause:error});
  throw error;
 });
 onTiming?.('renderer-response',performance.now()-renderAt);let firstChunk=true;
 let prePauseMs=0,postPauseMs=0;let triggerChunk:SpeechChunk|undefined;let first=true,firstWord=true;let normalChunk:SpeechChunk|undefined;let nativeStream:{id:string;index:number;offset:number;finished:boolean}|undefined;
 const wordMetadata=()=>({...((breath)?{breath}:{}),...((unit.sounds?.length)?{sounds:unit.sounds}:{}),...((unit.ticks?.length)?{ticks:unit.ticks}:{}),...((unit.devicesAtWord?.length)?{devices_at_word:unit.devicesAtWord}:{})});
 for await(const line of lines(r)){const raw=line.startsWith('data: ')?line.slice(6):line;if(raw==='[DONE]')continue;const chunk={...JSON.parse(raw),...(track?{voice_track:track}:{})};if(!chunk.audio)continue;
  if(moss&&chunk.stream){
   const packet=chunk.stream as SpeechStreamPacket;
   nativeStream??={id:packet.id,index:0,offset:0,finished:false};
   if(nativeStream.finished||typeof packet.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(packet.id)||packet.id!==nativeStream.id||!Number.isInteger(packet.index)||packet.index!==nativeStream.index||!Number.isInteger(packet.offset)||packet.offset!==nativeStream.offset||typeof packet.final!=='boolean'||packet.sampleRate!==48000||packet.channels!==2||!Number.isInteger(packet.samples)||packet.samples<=0||packet.offset+packet.samples>48000*30||chunk.history_mode!=='complete'||chunk.timestamps?.length!==0||typeof chunk.text!=='string'||(!packet.final&&chunk.text!==''))throw Error('Invalid or stale native speech packet');
   nativeStream.index++;nativeStream.offset+=packet.samples;nativeStream.finished=packet.final;
  }else if(nativeStream)throw Error('Native speech packet metadata is missing');
  if(firstChunk){firstChunk=false;onTiming?.('renderer-first-wav',performance.now()-renderAt);}
  if('trigger' in unit&&unit.trigger){
   if(moss&&chunk.stream)throw Error('Native trigger speech requires its complete utterance');
   if(!chunk.text?.trim()){
    if(triggerChunk)postPauseMs+=chunk.pause_ms??0;else prePauseMs+=chunk.pause_ms??0;
    continue;
   }
   triggerChunk={...chunk,trigger:unit.trigger};
  }else{if(normalChunk)yield normalChunk;const spoken=!!chunk.text?.trim()||!!chunk.stream;normalChunk={...chunk,...(first&&unit.cuesBefore?.length?{cues_before:unit.cuesBefore}:{}),...(firstWord&&spoken?wordMetadata():{})};first=false;if(spoken)firstWord=false;if(!unit.cuesAfter?.length){yield normalChunk!;normalChunk=undefined;}}
 }
 if(nativeStream&&!nativeStream.finished)throw Error('Native speech ended before the complete utterance');
 if(normalChunk)yield {...normalChunk,...(unit.cuesAfter?.length?{cues_after:unit.cuesAfter}:{})};
 if(triggerChunk)yield {...triggerChunk,...wordMetadata(),...(unit.cuesBefore?.length?{cues_before:unit.cuesBefore}:{}),...(unit.cuesAfter?.length?{cues_after:unit.cuesAfter}:{}),...(prePauseMs?{pre_pause_ms:prePauseMs}:{}),
  ...('postPause' in unit&&unit.postPause?{post_pause_ms:(triggerChunk.pause_ms??0)+postPauseMs}:{})};
 }finally{release();}
 }
 }
 }
}
