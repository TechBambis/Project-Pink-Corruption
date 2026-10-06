// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {setImmediate as yieldTask} from 'node:timers/promises';
import {Store,memoryHash,type MemoryFact,type MemoryEpisode} from '../storage';
import type {Embeddings} from './embeddings';
import {InferenceQueue} from './inference';
export interface MemoryRetrieval {facts:MemoryFact[];episodes:MemoryEpisode[];mode:'hybrid'|'lexical'}
export function cosineSimilarity(query:Float32Array,bytes:Uint8Array){
 if(bytes.byteLength!==query.length*4)return 0;
 const vector=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let dot=0,a=0,b=0;
 for(let i=0;i<query.length;i++){const v=vector.getFloat32(i*4,true);if(!Number.isFinite(v))return 0;dot+=query[i]*v;a+=query[i]**2;b+=v*v;}
 return a&&b?dot/Math.sqrt(a*b):0;
}
/** Lexical + multilingual semantic retrieval with a persistent, profile-scoped
 * cache. Background indexing yields between small CPU batches; queries take
 * priority over the next batch. Retrieval never creates or revises facts. */
export class SemanticMemory {
 private queue=new InferenceQueue();private controller=new AbortController();private revision=0;
 private indexing:Promise<void>|null=null;private dirty=false;private closed=false;private unsubscribe:()=>void;
 private queryCache=new Map<string,Float32Array>();
 constructor(private store:Store,private encoder:Embeddings,private options:{minSimilarity?:number;queryTimeoutMs?:number;onError?:(error:unknown)=>void}={}){
  this.unsubscribe=store.onMemoryChange(change=>{
   if(change!=='write'){this.revision++;this.controller.abort();this.controller=new AbortController();this.queryCache.clear();}
   void this.index();
  });
 }
 get available(){return this.encoder.available;}
 async index():Promise<void>{
  if(this.closed||!this.available)return;
  this.dirty=true;if(this.indexing)return this.indexing;
  this.indexing=this.drain().catch(error=>{if(!this.closed&&!(error instanceof DOMException&&error.name==='AbortError'))this.options.onError?.(error);}).finally(()=>{this.indexing=null;if(this.dirty&&!this.closed)void this.index();});
  return this.indexing;
 }
 private async drain(){
  while(this.dirty&&!this.closed){
   this.dirty=false;const revision=this.revision,signal=this.controller.signal;
   while(!signal.aborted&&!this.closed){
    const sources=this.store.pendingMemorySources(this.encoder.id,8);if(!sources.length)break;
    const nonempty=sources.filter(source=>source.content.trim());
    const vectors=nonempty.length?await this.queue.run(()=>this.encoder.embed(nonempty.map(s=>s.content),'passage',signal),signal):[];
    if(signal.aborted||revision!==this.revision||this.closed)break;
    for(const source of sources){const i=nonempty.indexOf(source);this.store.saveMemoryVector(source,this.encoder.id,i<0?new Float32Array(this.encoder.dimensions):vectors[i]);}
    await yieldTask();
   }
  }
 }
 async retrieve(text:string,signal:AbortSignal):Promise<MemoryRetrieval>{
  const lexical=()=>({facts:this.store.memoryFacts(),episodes:this.store.searchEpisodes(text,4),mode:'lexical' as const});
  signal.throwIfAborted();if(!this.available||this.closed)return lexical();
  const revision=this.revision;
  if(!this.store.memoryVectors(this.encoder.id,1).length)return lexical();
  try{
   const operationSignal=AbortSignal.any([signal,this.controller.signal,AbortSignal.timeout(this.options.queryTimeoutMs??2000)]),key=memoryHash(text);
   let query=this.queryCache.get(key);
   if(!query){[query]=await this.queue.run(()=>this.encoder.embed([text],'query',operationSignal),operationSignal,10);if(!query)throw Error('Missing query embedding');operationSignal.throwIfAborted();if(revision===this.revision){this.queryCache.set(key,query);if(this.queryCache.size>32)this.queryCache.delete(this.queryCache.keys().next().value!);}}
   signal.throwIfAborted();if(revision!==this.revision||this.closed)return lexical();
   const rows=this.store.memoryVectors(this.encoder.id),semantic:(typeof rows[number]&{score:number})[]=[];
   for(const [i,row] of rows.entries()){
    const score=cosineSimilarity(query!,row.vector);if(score>=(this.options.minSimilarity??.42))semantic.push({...row,score});
    if(i%128===127){await yieldTask();signal.throwIfAborted();if(revision!==this.revision||this.closed)return lexical();}
   }
   semantic.sort((a,b)=>b.score-a.score);
   // Reciprocal-rank fusion keeps exact matches useful alongside paraphrases.
   const combine=(first:number[],second:number[],limit:number)=>{
    const scores=new Map<number,number>();for(const list of [first,second])list.forEach((id,i)=>scores.set(id,(scores.get(id)??0)+1/(60+i+1)));
    return [...scores].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([id])=>id);
   };
   const facts=this.store.memoryFacts(),words=text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[];
   const relevance=(fact:MemoryFact)=>words.reduce((n,word)=>n+(fact.key.includes(word)?3:0)+(fact.value.toLowerCase().includes(word)?1:0),0);
   const exactFacts=facts.filter(f=>relevance(f)>0).sort((a,b)=>relevance(b)-relevance(a)||b.id-a.id).map(f=>f.id);
   const factIds=combine(exactFacts,semantic.filter(v=>v.kind==='fact').map(v=>v.id),8);
   const rankedFacts=[...factIds.flatMap(id=>facts.filter(f=>f.id===id)),...facts.filter(f=>!factIds.includes(f.id))].slice(0,8);
   const episodeIds=combine(this.store.searchEpisodes(text,12).map(e=>e.id),semantic.filter(v=>v.kind==='turn').map(v=>v.id),4);
   return {facts:rankedFacts,episodes:this.store.episodesById(episodeIds),mode:'hybrid'};
  }catch(error){if(signal.aborted)throw signal.reason;if(revision===this.revision)this.options.onError?.(error);return lexical();}
 }
 close(){this.closed=true;this.unsubscribe();this.controller.abort();this.queryCache.clear();this.encoder.close?.();}
}
