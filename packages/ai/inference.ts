// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {LLMBackend,Message} from './index';
import type {SamplingProfile} from '../../config/sampling';
import {spokenWordCount} from './response';

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
 async run<T>(operation:()=>Promise<T>,signal:AbortSignal,priority=0){const release=await this.acquire(signal,priority);try{return await operation();}finally{release();}}
 async *stream(backend:LLMBackend,messages:Message[],model:string,signal:AbortSignal,context:number,maxTokens:number,sampling:SamplingProfile='creative',grammar?:string){
  const release=await this.acquire(signal);
  try{yield*backend.stream(messages,model,signal,context,maxTokens,sampling,grammar);}finally{release();}
 }
}

/** Exact assistant prefill allows suspension even at a word boundary without a new reply. */
export function speechBatchBoundary(text:string){
 if(text.lastIndexOf('[')>text.lastIndexOf(']')||text.lastIndexOf('<action>')>text.lastIndexOf('</action>'))return false;
 const visible=text.replace(/\[[^\]]*\]/g,'');
 const sentences=(visible.match(/[.!?。！？](?:["”']?)(?:\s|$)/gu)??[]).length;
 return (sentences>=3&&/[.!?。！？]["”']?(?:\s|\[[^\]]*\])*$/u.test(text))
  ||(spokenWordCount(visible)>=48&&/\s$/.test(text));
}
