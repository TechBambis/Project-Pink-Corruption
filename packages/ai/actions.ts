// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { ActionSchema, type AIAction } from '../safety/actions';
/** Strip and validate explicit action markup incrementally. No generated code is executed. */
export class ActionStream {
 private buffer='';private inAction=false;
 push(text:string){this.buffer+=text;let display='';const actions:AIAction[]=[];
 while(this.buffer){if(this.inAction){const end=this.buffer.indexOf('</action>');if(end<0){if(this.buffer.length>2048){this.buffer='';this.inAction=false;}break;}const raw=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+9);this.inAction=false;try{const action=ActionSchema.safeParse(JSON.parse(raw));if(action.success)actions.push(action.data);}catch{}continue;}
 const start=this.buffer.indexOf('<action>');if(start>=0){display+=this.buffer.slice(0,start);this.buffer=this.buffer.slice(start+8);this.inAction=true;continue;}
 let keep=0;for(let n=1;n<8;n++){if('<action>'.startsWith(this.buffer.slice(-n)))keep=n;}display+=keep?this.buffer.slice(0,-keep):this.buffer;this.buffer=keep?this.buffer.slice(-keep):'';break;}
 return {display,actions};}
 flush(){const text=this.inAction?'':this.buffer;this.buffer='';this.inAction=false;return text;}
}
