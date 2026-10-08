// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

const replyTypes=new Set(['begin','token','audio','sentence-end','done','error','notice','action','stats','metric','interrupted']);
export interface ReplyEnvelope {type:string;requestId?:string;id?:string}
/** Client-issued identity exists before the server's begin arrives. Cancellation
 * invalidates that identity, including messages already in flight on the socket. */
export class ReplyGate {
 private pending:string|null=null;private reply:string|null=null;
 get requestId(){return this.pending;}
 issue(id=crypto.randomUUID()){this.pending=id;this.reply=null;return id;}
 cancel(){this.pending=null;this.reply=null;}
 accepts(message:ReplyEnvelope){
  if(!replyTypes.has(message.type))return true;
  if(!this.pending||message.requestId!==this.pending)return false;
  if(message.type==='begin'){
   if(!message.id||this.reply)return false;
   this.reply=message.id;return true;
  }
  // Preparation can fail or be cancelled before begin; these still belong to
  // the issued request, while no other pre-begin output is admissible.
  if(!this.reply){if(message.type!=='error'&&message.type!=='interrupted')return false;this.cancel();return true;}
  if(message.id!==this.reply)return false;
  if(['done','error','interrupted'].includes(message.type))this.cancel();
  return true;
 }
}
