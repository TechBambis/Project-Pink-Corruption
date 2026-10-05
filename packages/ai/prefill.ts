// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Some llama.cpp builds include assistant prefill in the first content delta. */
export class PrefillEchoFilter {
 private pending='';private decided:boolean;
 constructor(private prefix:string){this.decided=!prefix;}
 push(text:string){
  if(this.decided)return text;
  this.pending+=text;
  if(this.pending.startsWith(this.prefix)){
   const output=this.pending.slice(this.prefix.length);this.pending='';this.decided=true;return output;
  }
  if(this.prefix.startsWith(this.pending))return '';
  const output=this.pending;this.pending='';this.decided=true;return output;
 }
 flush(){const text=this.pending;this.pending='';this.decided=true;return text;}
}
