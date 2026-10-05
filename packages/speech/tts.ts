// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {breathInstruction,type BreathCue} from './breath';
import { lines } from '../ai';
import {scriptUnits,type PlaybackCue} from './script';
import type {SoundCue} from '../audio/sound-design';
import type {DeviceCommand} from '../devices/commands';
import type {TickCue} from '../audio/tick';
import {isSpokenOneShot} from '../../config/trigger-sequence';
import {readFileSync} from 'node:fs';
import {speechRendererQueue,fetchAvailableRenderer} from './renderer-queue';
export interface Caption {word:string;start_time:number;end_time:number}
export interface SpeechChunk {audio:string;audio_format:string;timestamps:Caption[];text?:string;spoken_seconds?:number;pause_ms?:number;trigger?:string;pre_pause_ms?:number;post_pause_ms?:number;cues_before?:PlaybackCue[];cues_after?:PlaybackCue[];sounds?:SoundCue[];ticks?:TickCue[];devices_at_word?:DeviceCommand[];control?:boolean;breath?:BreathCue}
export interface SpeechCapabilities {languages:string[];streaming:boolean;wordTimings:boolean;scriptControls:boolean;voiceBlending:boolean}
export interface SpeechProvider {capabilities:SpeechCapabilities;voices():Promise<string[]>;speak(text:string,voice:string,speed:number,signal:AbortSignal,preset?:string,triggerNames?:string[],isolatedVoice?:boolean):AsyncGenerator<SpeechChunk>}
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
 async *speak(text:string,voice:string,speed:number,signal:AbortSignal,preset='bambi_local_clean',triggerNames?:string[],isolatedVoice=false):AsyncGenerator<SpeechChunk>{
 for(const unit of scriptUnits(text,triggerNames)){
 if(unit.control){yield {audio:'',audio_format:'wav',timestamps:[],text:'',control:true,cues_before:unit.cuesBefore,ticks:unit.ticks};continue;}
 const release=await speechRendererQueue(this.url).acquire(signal,isolatedVoice?0:10);
 try{
 const r=await fetchAvailableRenderer(()=>fetch(this.url+'/dev/captioned_speech',{method:'POST',redirect:'error',headers:this.renderHeaders(),signal,body:JSON.stringify({model:'kokoro',input:unit.text,voice,speed,preset,response_format:'wav',stream:true,return_timestamps:true,...(isolatedVoice?{overrides:{layers:{left_voice:{enabled:false},right_voice:{enabled:false}},processing:{echoEnabled:false},timing:{normal:0,short:0,medium:0,long:0,transition:0}}}:{}),...('trigger' in unit&&unit.trigger&&!isSpokenOneShot(unit.trigger)?{trigger:true}:{})})}),signal);
 let prePauseMs=0,postPauseMs=0;let triggerChunk:SpeechChunk|undefined;let first=true,firstWord=true;let normalChunk:SpeechChunk|undefined;
 const breath=unit.breath??breathInstruction(unit.text);
 const wordMetadata=()=>({...((breath)?{breath}:{}),...((unit.sounds?.length)?{sounds:unit.sounds}:{}),...((unit.ticks?.length)?{ticks:unit.ticks}:{}),...((unit.devicesAtWord?.length)?{devices_at_word:unit.devicesAtWord}:{})});
 for await(const line of lines(r)){const raw=line.startsWith('data: ')?line.slice(6):line;if(raw==='[DONE]')continue;const chunk=JSON.parse(raw);if(!chunk.audio)continue;
  if('trigger' in unit&&unit.trigger){
   if(!chunk.text?.trim()){
    if(triggerChunk)postPauseMs+=chunk.pause_ms??0;else prePauseMs+=chunk.pause_ms??0;
    continue;
   }
   triggerChunk={...chunk,trigger:unit.trigger};
  }else{if(normalChunk)yield normalChunk;const spoken=!!chunk.text?.trim();normalChunk={...chunk,...(first&&unit.cuesBefore?.length?{cues_before:unit.cuesBefore}:{}),...(firstWord&&spoken?wordMetadata():{})};first=false;if(spoken)firstWord=false;if(!unit.cuesAfter?.length){yield normalChunk!;normalChunk=undefined;}}
 }
 if(normalChunk)yield {...normalChunk,...(unit.cuesAfter?.length?{cues_after:unit.cuesAfter}:{})};
 if(triggerChunk)yield {...triggerChunk,...wordMetadata(),...(unit.cuesBefore?.length?{cues_before:unit.cuesBefore}:{}),...(unit.cuesAfter?.length?{cues_after:unit.cuesAfter}:{}),...(prePauseMs?{pre_pause_ms:prePauseMs}:{}),
  ...('postPause' in unit&&unit.postPause?{post_pause_ms:(triggerChunk.pause_ms??0)+postPauseMs}:{})};
 }finally{release();}
 }
 }
}
