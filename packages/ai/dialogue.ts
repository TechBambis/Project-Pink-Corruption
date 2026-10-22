// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import {ScriptDisplayStream} from '../speech/script';
import {containsOwnerNarration} from '../speech/contract';
import type {Message} from './index';

export const PlaybackReportSchema=z.object({id:z.string().max(100),chunks:z.array(z.object({seq:z.number().int().min(0),chars:z.number().int().min(0).max(20000)}).strict()).max(32)}).strict();
/** Text is registered by the server; playback reports cannot introduce new dialogue. */
export class ReplyProgress {
 private chunks=new Map<number,{text:string;chars:number;speaker?:'owner'|'bambi'}>();
 register(seq:number,text:string,speaker?:'owner'|'bambi'){this.chunks.set(seq,{text,chars:0,speaker});}
 played(seq:number,chars?:number){const chunk=this.chunks.get(seq);if(chunk)chunk.chars=Math.max(chunk.chars,Math.min(chunk.text.length,chars??chunk.text.length));}
 get spoken(){
  const runs:{text:string;inner:boolean}[]=[];
  for(const [,chunk] of [...this.chunks].sort(([a],[b])=>a-b)){
   const text=chunk.text.slice(0,chunk.chars).trim();if(!text)continue;
   const inner=chunk.speaker==='bambi',last=runs.at(-1);
   if(last&&last.inner===inner)last.text+=' '+text;else runs.push({text,inner});
  }
  // Keep authored first-person inner thoughts distinct in subsequent history.
  return runs.map(run=>run.inner?'(Imagined inner feminine voice: '+JSON.stringify(run.text)+')':run.text).join(' ');
 }
 interrupted(speak:boolean,generated:string){return cleanDialogueText(speak?this.spoken:generated).trim();}
}

/** Read old histories without presenting operational notes as things the assistant said. */
export function cleanDialogueText(text:string){return text.replace(/\[Response interrupted(?: by the user)?\.[^\]]*\]\s*/g,'');}
export function visibleDialogueText(text:string){const display=new ScriptDisplayStream();return display.push(cleanDialogueText(text))+display.flush();}

/** Old malformed roleplay must not become examples for the next spoken turn.
 * Keep user messages and source storage intact; explicit discussion of prose
 * retains its request-scoped exemption, exactly as it does at the output gate. */
export function spokenHistoryMessages(turns:readonly {role:'user'|'assistant';content:string;interruption?:string|null}[]):Message[]{
 let request='';
 return turns.flatMap<Message>(turn=>{
  if(turn.role==='user'){request=turn.content;return [{role:turn.role,content:turn.content}];}
  const content=visibleDialogueText(turn.content);
  return ['spoken-contract','invalid-spoken-format'].includes(turn.interruption??'')||containsOwnerNarration(content,request)?[]:[{role:turn.role,content}];
 });
}

/** Handles a marker split across model tokens before any of it reaches text or TTS. */
export class DialogueDisplayStream {
 private pending='';private prefix='[Response interrupted';
 push(text:string){this.pending+=text;let out='';while(this.pending){const bracket=this.pending.indexOf('[');if(bracket<0){out+=this.pending;this.pending='';break;}out+=this.pending.slice(0,bracket);this.pending=this.pending.slice(bracket);
   if(this.prefix.startsWith(this.pending))break;
   if(this.pending.startsWith(this.prefix)){const end=this.pending.indexOf(']');if(end<0){if(this.pending.length>2048)this.pending='';break;}this.pending=this.pending.slice(end+1);continue;}
   out+=this.pending[0];this.pending=this.pending.slice(1);
  }return out;}
 flush(){const text=this.pending;this.pending='';return text.startsWith(this.prefix)||this.prefix.startsWith(text)?'':text;}
}
