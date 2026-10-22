// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {LLMBackend,Message} from './index';
import type {SamplingProfile} from '../../config/sampling';
import {spokenWordCount,spokenPassageText,incompleteSpeechMarker} from './response';

type Ticket={priority:number;signal:AbortSignal;resolve:(release:()=>void)=>void;reject:(error:unknown)=>void;abort:()=>void};
/** One GPU slot. Listening decisions take the next turn before ordinary continuations. */
export class InferenceQueue {
 private busy=false;private tickets:Ticket[]=[];
 private acquire(signal:AbortSignal,priority=0){
  return new Promise<()=>void>((resolve,reject)=>{
   if(signal.aborted){reject(signal.reason);return;}
   const ticket:Ticket={priority,signal,resolve,reject,abort:()=>{this.tickets=this.tickets.filter(item=>item!==ticket);reject(signal.reason);}};
   this.tickets.push(ticket);signal.addEventListener('abort',ticket.abort,{once:true});this.drain();
  });
 }
 private drain(){
  if(this.busy)return;
  this.tickets.sort((a,b)=>b.priority-a.priority);
  const next=this.tickets.shift();if(!next)return;
  next.signal.removeEventListener('abort',next.abort);
  if(next.signal.aborted){next.reject(next.signal.reason);this.drain();return;}
  this.busy=true;let released=false;
  next.resolve(()=>{if(released)return;released=true;this.busy=false;this.drain();});
 }
 async run<T>(operation:()=>Promise<T>,signal:AbortSignal,priority=0){const release=await this.acquire(signal,priority);try{signal.throwIfAborted();return await operation();}finally{release();}}
 async *stream(backend:LLMBackend,messages:Message[],model:string,signal:AbortSignal,context:number,maxTokens:number,sampling:SamplingProfile='creative',grammar?:string,onAcquired?:()=>void){
  const release=await this.acquire(signal);
  try{signal.throwIfAborted();onAcquired?.();yield*backend.stream(messages,model,signal,context,maxTokens,sampling,grammar);}finally{release();}
 }
}

/** Ollama and native llama share this machine's GPU; cloud work has its own slot. */
export class InferenceResources {
 readonly local=new InferenceQueue();private remote=new InferenceQueue();
 forBackend(backend:Pick<LLMBackend,'name'>){return backend.name==='cloud'?this.remote:this.local;}
}

/** Suspend only after a complete sentence so buffered speech keeps its ending. */
export function speechBatchBoundary(text:string){
 if(incompleteSpeechMarker(text)||text.lastIndexOf('<action>')>text.lastIndexOf('</action>'))return false;
 const visible=spokenPassageText(text);
 const sentences=(visible.match(/[.!?。！？](?:["”']?)(?:\s|$)/gu)??[]).length;
 return (sentences>=3||spokenWordCount(visible)>=48)
  &&/[.!?。！？]["”']?\s*$/u.test(visible);
}

/** Bound active generation without completed speech, including marker-only loops.
 * No wall-clock timeout: explicit Pause and playback backpressure may last. */
export class SpeechProgressGuard {
 static readonly maxPendingCharacters=2400;
 private unspokenCharacters=0;
 get pendingCharacters(){return this.unspokenCharacters;}
 observe(characters:number,completedPhrase:boolean,pendingCharacters:number){
  this.unspokenCharacters=Math.max(pendingCharacters,completedPhrase?pendingCharacters:this.unspokenCharacters+characters);
  return this.unspokenCharacters>SpeechProgressGuard.maxPendingCharacters;
 }
}
