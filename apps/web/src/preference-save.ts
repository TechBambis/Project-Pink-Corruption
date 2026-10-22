// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
/** Serialize autosaves and make a pending save unable to undo a later import. */
export class PreferenceSave {
 tag='"profile-0"';
 private pending:Record<string,unknown>|null=null;
 private saving:Promise<void>|null=null;
 private failure:Error|null=null;
 constructor(private report:(message:string)=>void,private fetcher:typeof fetch=(...args)=>fetch(...args)){}
 save(value:Record<string,unknown>){this.pending=structuredClone(value);void this.flush().catch(error=>this.report(String(error.message??error)));}
 async flush():Promise<void>{
  if(this.saving)return this.saving;
  if(!this.pending){if(this.failure)throw this.failure;return;}
  this.saving=(async()=>{while(this.pending){const body=this.pending;this.pending=null;
   const response=await this.fetcher('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':this.tag},body:JSON.stringify(body)});
   if(!response.ok){this.pending=null;throw Error((await response.json()).error||'Settings could not be saved.');}
   this.failure=null;
  }})().catch(error=>{this.failure=error;throw error;}).finally(()=>{this.saving=null;});
  return this.saving;
 }
}
