// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Reuse one preparation for identical settings; changed settings cancel stale work. */
export class CompanionPreparation {
 private current: {key:string;controller:AbortController;promise:Promise<void>;pending:boolean;expires:number} | null = null;
 private failure: {key:string;error:unknown} | null = null;
 get pending(){return this.current?.pending??false;}
 constructor(private run:(settings:unknown,signal:AbortSignal)=>Promise<void>,private readyMs=60000,private now=()=>performance.now()) {}
 hasFailed(settings:unknown){return this.failure?.key===JSON.stringify(settings);}
 prepare(settings:unknown) {
  const key=JSON.stringify(settings);
  if(this.current?.key===key&&(this.current.pending||this.current.expires>this.now()))return this.current.promise;
  this.cancel();
  const controller=new AbortController();
  const entry={key,controller,promise:Promise.resolve(),pending:true,expires:Infinity};
  this.current=entry;
  let operation:Promise<void>;
  try{operation=Promise.resolve(this.run(settings,controller.signal));}catch(error){operation=Promise.reject(error);}
  entry.promise=operation.then(()=>{controller.signal.throwIfAborted();entry.pending=false;entry.expires=this.now()+this.readyMs;}).catch(error=>{
   if(this.current===entry){this.current=null;this.failure={key,error};}
   throw error;
  });
  return entry.promise;
 }
 cancel(){this.current?.controller.abort();this.current=null;this.failure=null;}
}
