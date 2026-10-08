// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

export type ServiceState={phase:'idle'|'preparing'|'ready'|'stopping'|'failed';model:string|null};
interface Operations {
 ready(model:string):boolean;
 start(model:string,context:number,signal:AbortSignal):Promise<void>;
 stop():Promise<void>;
}

/** Serialize ownership changes; stop invalidates active and already queued preparation. */
export class ServiceLifecycle {
 private tail:Promise<void>=Promise.resolve();private epoch=new AbortController();
 private current:ServiceState={phase:'idle',model:null};
 constructor(private operations:Operations){}
 get state():Readonly<ServiceState>{
  return this.current.phase==='ready'&&!this.operations.ready(this.current.model!)?{phase:'failed',model:this.current.model}:{...this.current};
 }
 private enqueue(work:()=>Promise<void>){
  const result=this.tail.then(work);this.tail=result.catch(()=>{});return result;
 }
 prepare(model:string,context:number,signal?:AbortSignal){
  const cancellation=AbortSignal.any([this.epoch.signal,...(signal?[signal]:[])]);
  return this.enqueue(async()=>{
   cancellation.throwIfAborted();
   if(this.operations.ready(model)){this.current={phase:'ready',model};return;}
   this.current={phase:'preparing',model};
   try{
    await this.operations.stop();cancellation.throwIfAborted();
    await this.operations.start(model,context,cancellation);cancellation.throwIfAborted();
    if(!this.operations.ready(model))throw Error('Prepared service did not become ready.');
    this.current={phase:'ready',model};
   }catch(error){
    try{await this.operations.stop();}finally{this.current={phase:cancellation.aborted?'idle':'failed',model:null};}
    throw error;
   }
  });
 }
 stop(){
  this.epoch.abort(Error('Owned services stopped.'));this.epoch=new AbortController();
  return this.enqueue(async()=>{
   this.current={phase:'stopping',model:null};
   try{await this.operations.stop();this.current={phase:'idle',model:null};}
   catch(error){this.current={phase:'failed',model:null};throw error;}
  });
 }
}
