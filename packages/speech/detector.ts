// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {FrameProcessor, type FrameProcessorEvent} from '@ricky0123/vad-web/dist/frame-processor';
import {Message} from '@ricky0123/vad-web/dist/messages';
import {Resampler} from '@ricky0123/vad-web/dist/resampler';
import type {Silero} from '@ricky0123/vad-web/dist/models/silero';

export function speechDetectionOptions(sensitivity='balanced',silenceMs=650){
 const positiveSpeechThreshold=sensitivity==='low'?.8:sensitivity==='sensitive'?.45:.6;
 return {positiveSpeechThreshold,negativeSpeechThreshold:Math.max(.25,positiveSpeechThreshold-.22),
  redemptionMs:Math.max(450,Math.min(1500,silenceMs)),preSpeechPadMs:900,
  minSpeechMs:sensitivity==='low'?320:sensitivity==='sensitive'?192:224,submitUserSpeechOnPause:false};
}

/** Serial inference: stale frames may neither change the next utterance nor stop playback. */
export class SpeechDetector {
 private processor:FrameProcessor;private resampler:Resampler|null=null;
 private queue:Float32Array[]=[];private running:Promise<void>|null=null;private epoch=0;private resetPending=false;private closed=false;private segmentFrames=0;
 constructor(private model:Pick<Silero,'process'|'reset_state'|'release'>,private onEvent:(event:FrameProcessorEvent)=>void,private onError:(error:unknown)=>void){
  this.processor=new FrameProcessor(model.process,model.reset_state,speechDetectionOptions(),32);this.processor.resume();
 }
 configure(sensitivity:string,silenceMs:number){this.processor.setOptions(speechDetectionOptions(sensitivity,silenceMs));}
 push(data:Float32Array,rate:number){
  if(this.closed)return;
  if(!this.resampler||this.resampler.options.nativeSampleRate!==rate)this.resampler=new Resampler({nativeSampleRate:rate,targetSampleRate:16000,targetFrameSize:512});
  this.queue.push(...this.resampler.process(data));
  // A stalled tab must not replay old microphone events when it becomes responsive.
  if(this.queue.length>16){this.reset();return;}
  if(!this.running)this.running=this.drain().finally(()=>{this.running=null;});
 }
 reset(){this.epoch++;this.queue=[];this.resampler=null;this.resetPending=true;this.segmentFrames=0;}
 private async drain(){try{while(this.queue.length&&!this.closed){if(this.resetPending){this.processor.reset();this.resetPending=false;}const frame=this.queue.shift()!,epoch=this.epoch;
   await this.processor.process(frame,event=>{if(epoch!==this.epoch||this.closed)return;if(event.msg===Message.SpeechEnd||event.msg===Message.VADMisfire)this.segmentFrames=0;this.onEvent(event);});
   if(epoch===this.epoch&&this.processor.speaking&&++this.segmentFrames>=Math.ceil(25000/32)){this.processor.endSegment(this.onEvent);this.segmentFrames=0;}
  }}catch(error){this.reset();this.closed=true;this.onError(error);}}
 async destroy(){this.closed=true;this.reset();await this.running;await this.model.release();}
}
