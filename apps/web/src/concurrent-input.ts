// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface PendingInput {id:string;text:string;source:'speech'|'text';action?:'continue'|'adapt';}
/** Ordered decisions never stop audio; only a playback boundary commits adaptation. */
export class ConcurrentInput {
 private items:PendingInput[]=[];private epoch=0;private controller:AbortController|null=null;private working=false;
 constructor(private decide:(item:PendingInput,signal:AbortSignal)=>Promise<'continue'|'adapt'>,
  private continued:(item:PendingInput)=>void,private ready:()=>void,private failed:(error:unknown)=>void){}
 get pending(){return this.items.length;}
 get deciding(){return this.working;}
 enqueue(text:string,source:PendingInput['source']){
  if(this.items.length>=8)throw Error('Too many pending inputs. Please wait a moment.');
  if(this.items.reduce((size,item)=>size+item.text.length+1,0)+text.length>4000)throw Error('Pending input is too long. Please wait for Bambi to respond.');
  const item:PendingInput={id:crypto.randomUUID(),text,source};this.items.push(item);void this.drain();return item.id;
 }
 private consumeContinued(){while(this.items[0]?.action==='continue'){const first=this.items.shift()!;this.continued(first);}}
 private async drain(){
  if(this.working)return;const epoch=this.epoch;this.working=true;
  try{while(epoch===this.epoch){
   this.consumeContinued();
   const item=this.items.find(item=>!item.action);if(!item)break;
   const controller=new AbortController();this.controller=controller;
   try{item.action=await this.decide(item,controller.signal);}catch(error){if(epoch!==this.epoch||controller.signal.aborted)return;item.action='adapt';this.failed(error);}
   if(epoch!==this.epoch||controller.signal.aborted)return;
   // Preserve ordering: a later acknowledgment cannot overtake an adaptation.
   this.consumeContinued();
   this.ready();
  }}finally{if(epoch===this.epoch){this.working=false;this.controller=null;this.ready();}}
 }
 takeAdaptation(){
  if(!this.items[0]?.action||this.items[0].action!=='adapt')return [];
  const batch:PendingInput[]=[];
  while(this.items[0]?.action)batch.push(this.items.shift()!);
  return batch;
 }
 clear(source?:PendingInput['source']){
  this.epoch++;this.controller?.abort();this.controller=null;this.working=false;
  this.items=source?this.items.filter(item=>item.source!==source):[];
  void this.drain();
 }
}
