// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface ReplyTrace { id:string; backend:string; model:string; status:'active'|'done'|'interrupted'|'error'; error?:string; stages:Record<string,number>; timings:Record<string,{count:number;totalMs:number;maxMs:number}>; inputTiming?:{speechEndToRequestMs:number;sttMs:number}; events?:{atMs:number;name:string;sentenceId?:number;seq?:number;value?:number}[]; bufferSummary?:{samples:number;peakQueuedSeconds:number;peakBytes:number}; buffers?:{atMs:number;queuedSeconds:number;speechSeconds:number;authoredSilenceSeconds:number;queuedBytes:number;lowSeconds:number;highSeconds:number;held:boolean;running?:boolean;pending:number}[] }
/** Durations are relative to one server clock. Client durations are reported separately. */
export class ReplyTraces {
  private entries=new Map<string,{started:number;trace:ReplyTrace}>();
  constructor(private now=()=>performance.now()){}
  begin(id:string,backend:string,model:string,inputTiming?:ReplyTrace['inputTiming']){this.entries.set(id,{started:this.now(),trace:{id,backend,model,status:'active',stages:{request:0},timings:{},inputTiming}});while(this.entries.size>200)this.entries.delete(this.entries.keys().next().value!);}
  mark(id:string,stage:string){const entry=this.entries.get(id);if(entry&&entry.trace.stages[stage]===undefined)entry.trace.stages[stage]=Math.max(0,this.now()-entry.started);}
  finish(id:string,status:ReplyTrace['status']){const entry=this.entries.get(id);if(entry){entry.trace.status=status;this.mark(id,status);}}
  fail(id:string,message:string){const entry=this.entries.get(id);if(entry)entry.trace.error=message.slice(0,2000);this.finish(id,'error');}
  measure(id:string,name:string,ms:number){const entry=this.entries.get(id);if(!entry||!Number.isFinite(ms)||ms<0)return;const timing=entry.trace.timings[name]??{count:0,totalMs:0,maxMs:0};entry.trace.timings[name]={count:timing.count+1,totalMs:timing.totalMs+ms,maxMs:Math.max(timing.maxMs,ms)};}
  event(id:string,name:string,details:{sentenceId?:number;seq?:number;value?:number}={}){const entry=this.entries.get(id);if(!entry)return;const events=entry.trace.events??=[];events.push({atMs:Math.max(0,this.now()-entry.started),name,...details});if(events.length>256)events.shift();}
  buffer(id:string,buffer:Omit<NonNullable<ReplyTrace['buffers']>[number],'atMs'>){const entry=this.entries.get(id);if(!entry)return;const summary=entry.trace.bufferSummary??={samples:0,peakQueuedSeconds:0,peakBytes:0};summary.samples++;summary.peakQueuedSeconds=Math.max(summary.peakQueuedSeconds,buffer.queuedSeconds);summary.peakBytes=Math.max(summary.peakBytes,buffer.queuedBytes);const buffers=entry.trace.buffers??=[];buffers.push({atMs:Math.max(0,this.now()-entry.started),...buffer});if(buffers.length>128)buffers.shift();}
  snapshot(){return [...this.entries.values()].map(({trace})=>({...trace,stages:{...trace.stages},events:trace.events?.map(e=>({...e})),buffers:trace.buffers?.map(b=>({...b})),bufferSummary:trace.bufferSummary?{...trace.bufferSummary}:undefined,timings:Object.fromEntries(Object.entries(trace.timings).map(([name,timing])=>[name,{...timing}]))}));}
}
