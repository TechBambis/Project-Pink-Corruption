// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {FrameProcessorEvent} from '@ricky0123/vad-web/dist/frame-processor';

export type DetectorCommand =
 | {type:'frame';epoch:number;data:Float32Array;rate:number;durationMs:number}
 | {type:'reset';epoch:number}
 | {type:'configure';sensitivity:string;silenceMs:number};
export type DetectorReply = {type:'ready'} | {type:'error';message:string}
 | {type:'event';epoch:number;event:FrameProcessorEvent}
 | {type:'accepted';epoch:number;durationMs:number};
export interface DetectorWorker {
 postMessage(message:DetectorCommand,transfer?:Transferable[]):void;
 terminate():void;
 onmessage:((event:MessageEvent<DetectorReply>)=>void)|null;
 onerror:((event:ErrorEvent)=>void)|null;
}

/** Bound the worker mailbox as well as inference; resets invalidate replies already in transit. */
export class WorkerSpeechDetector {
 private epoch=0;private queuedMs=0;private closed=false;
 constructor(private worker:DetectorWorker,private onEvent:(event:FrameProcessorEvent)=>void,private onError:(error:unknown)=>void){
  worker.onmessage=({data})=>{
   if(this.closed)return;
   if(data.type==='error'){this.fail(Error(data.message));return;}
   if(data.type==='accepted'&&data.epoch===this.epoch)this.queuedMs=Math.max(0,this.queuedMs-data.durationMs);
   if(data.type==='event'&&data.epoch===this.epoch)this.onEvent(data.event);
  };
  worker.onerror=event=>this.fail(Error(event.message||'Local speech detection worker failed.'));
 }
 static create(onEvent:(event:FrameProcessorEvent)=>void,onError:(error:unknown)=>void,signal?:AbortSignal){
  return new Promise<WorkerSpeechDetector>((resolve,reject)=>{
   signal?.throwIfAborted();
   const worker=new Worker(new URL('./detector-worker.ts',import.meta.url),{type:'module'});
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   const fail=(error:unknown)=>{cleanup();worker.onmessage=null;worker.onerror=null;worker.terminate();reject(error);};
   const abort=()=>fail(signal?.reason??new DOMException('Cancelled','AbortError'));
   const timer=setTimeout(()=>fail(Error('Local speech detection took too long to load.')),30000);
   signal?.addEventListener('abort',abort,{once:true});
   worker.onerror=event=>fail(Error(event.message||'Could not start local speech detection.'));
   worker.onmessage=({data}:MessageEvent<DetectorReply>)=>{
    if(data.type==='error'){fail(Error(data.message));return;}
    if(data.type==='ready'){cleanup();resolve(new WorkerSpeechDetector(worker,onEvent,onError));}
   };
  });
 }
 configure(sensitivity:string,silenceMs:number){if(!this.closed)this.worker.postMessage({type:'configure',sensitivity,silenceMs});}
 push(data:Float32Array,rate:number){
  if(this.closed||!Number.isFinite(rate)||rate<=0)return;
  const durationMs=data.length/rate*1000;
  if(this.queuedMs+durationMs>512){this.reset();return;}
  this.queuedMs+=durationMs;
  this.worker.postMessage({type:'frame',epoch:this.epoch,data,rate,durationMs},[data.buffer as ArrayBuffer]);
 }
 reset(){if(this.closed)return;this.epoch++;this.queuedMs=0;this.worker.postMessage({type:'reset',epoch:this.epoch});}
 private fail(error:unknown){if(this.closed)return;void this.destroy();this.onError(error);}
 async destroy(){if(this.closed)return;this.closed=true;this.epoch++;this.queuedMs=0;this.worker.onmessage=null;this.worker.onerror=null;this.worker.terminate();}
}
