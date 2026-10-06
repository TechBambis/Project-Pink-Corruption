// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {Worker} from 'node:worker_threads';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export interface Embeddings {readonly id:string;readonly dimensions:number;readonly available:boolean;embed(texts:string[],kind:'query'|'passage',signal:AbortSignal):Promise<Float32Array[]>;close?():void}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const memoryModel=JSON.parse(readFileSync(resolve(root,'config/memory-model.json'),'utf8')) as {model:string;revision:string;dimensions:number;dtype:string;prefixes?:boolean;files:{path:string;sha256:string;bytes:number}[]};
/** Dedicated CPU worker; local files only. Model setup is an explicit CLI step. */
export class LocalEmbeddings implements Embeddings {
 readonly id=`${memoryModel.model}@${memoryModel.revision}:${memoryModel.dtype}:mean:${memoryModel.prefixes===false?'plain':'prefixed'}:v1`;
 readonly dimensions=memoryModel.dimensions;
 readonly directory:string;
 private worker:Worker|null=null;private sequence=0;
 private pending=new Map<number,{count:number;resolve:(vectors:Float32Array[])=>void;reject:(error:unknown)=>void;cleanup:()=>void}>();
 constructor(directory=resolve(root,'.runtime/memory-models')){this.directory=directory;}
 get available(){
  const path=resolve(this.directory,memoryModel.model);
  try{const ready=JSON.parse(readFileSync(resolve(path,'READY.json'),'utf8'));return ready.revision===memoryModel.revision&&memoryModel.files.every(file=>existsSync(resolve(path,file.path)));}catch{return false;}
 }
 private ensureWorker(){
  if(this.worker)return this.worker;
  const worker=new Worker(new URL('./embedding-worker.mjs',import.meta.url),{workerData:{directory:this.directory,model:memoryModel.model,dtype:memoryModel.dtype,prefixes:memoryModel.prefixes!==false},execArgv:[]});this.worker=worker;worker.unref();
  worker.on('message',({id,vectors,error}:{id:number;vectors?:number[][];error?:string})=>{
   const item=this.pending.get(id);if(!item)return;this.pending.delete(id);item.cleanup();
   if(error)item.reject(Error(error));else if(!vectors||vectors.length!==item.count||vectors.some(vector=>vector.length!==this.dimensions||vector.some(n=>!Number.isFinite(n))))item.reject(Error('Invalid embedding result'));else item.resolve(vectors.map(v=>Float32Array.from(v)));
   if(!this.pending.size)worker.unref();
  });
  const fail=(error:unknown)=>{if(this.worker!==worker)return;this.worker=null;for(const item of this.pending.values()){item.cleanup();item.reject(error);}this.pending.clear();};
  worker.on('error',fail);worker.on('exit',()=>{if(this.worker===worker)fail(Error('Embedding worker stopped'));});
  return worker;
 }
 embed(texts:string[],kind:'query'|'passage',signal:AbortSignal){
  signal.throwIfAborted();if(!this.available)return Promise.reject(Error('Local memory model is not installed'));
  const worker=this.ensureWorker(),id=++this.sequence;worker.ref();
  return new Promise<Float32Array[]>((resolve,reject)=>{
   const abort=()=>{this.pending.delete(id);signal.removeEventListener('abort',abort);worker.postMessage({cancel:id});reject(signal.reason);if(!this.pending.size)worker.unref();};
   this.pending.set(id,{count:texts.length,resolve,reject,cleanup:()=>signal.removeEventListener('abort',abort)});signal.addEventListener('abort',abort,{once:true});
   worker.postMessage({id,kind,texts});
  });
 }
 close(){const worker=this.worker;this.worker=null;for(const item of this.pending.values()){item.cleanup();item.reject(Error('Embedding worker stopped'));}this.pending.clear();void worker?.terminate();}
}
