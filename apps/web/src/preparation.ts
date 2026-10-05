// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Reuse one preparation for identical settings; changed settings cancel stale work. */
export class CompanionPreparation {
 private current: {key:string;controller:AbortController;promise:Promise<void>;pending:boolean} | null = null;
 get pending(){return this.current?.pending??false;}
 constructor(private run:(settings:unknown,signal:AbortSignal)=>Promise<void>) {}
 prepare(settings:unknown) {
  const key=JSON.stringify(settings);
  if(this.current?.key===key)return this.current.promise;
  this.cancel();
  const controller=new AbortController();
  const entry={key,controller,promise:Promise.resolve(),pending:true};
  this.current=entry;
  entry.promise=this.run(settings,controller.signal).then(()=>{entry.pending=false;}).catch(error=>{
   if(this.current===entry)this.current=null;
   throw error;
  });
  return entry.promise;
 }
 cancel(){this.current?.controller.abort();this.current=null;}
}
