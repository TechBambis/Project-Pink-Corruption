// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface ReplyTrace { id:string; backend:string; model:string; status:'active'|'done'|'interrupted'|'error'; stages:Record<string,number>; inputTiming?:{speechEndToRequestMs:number;sttMs:number} }
/** Durations are relative to one server clock. Client durations are reported separately. */
export class ReplyTraces {
  private entries=new Map<string,{started:number;trace:ReplyTrace}>();
  constructor(private now=()=>performance.now()){}
  begin(id:string,backend:string,model:string,inputTiming?:ReplyTrace['inputTiming']){this.entries.set(id,{started:this.now(),trace:{id,backend,model,status:'active',stages:{request:0},inputTiming}});while(this.entries.size>200)this.entries.delete(this.entries.keys().next().value!);}
  mark(id:string,stage:string){const entry=this.entries.get(id);if(entry&&entry.trace.stages[stage]===undefined)entry.trace.stages[stage]=Math.max(0,this.now()-entry.started);}
  finish(id:string,status:ReplyTrace['status']){const entry=this.entries.get(id);if(entry){entry.trace.status=status;this.mark(id,status);}}
  snapshot(){return [...this.entries.values()].map(({trace})=>({...trace,stages:{...trace.stages}}));}
}
