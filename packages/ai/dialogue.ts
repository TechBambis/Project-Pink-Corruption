// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import {ScriptDisplayStream} from '../speech/script';

export const PlaybackReportSchema=z.object({id:z.string().max(100),chunks:z.array(z.object({seq:z.number().int().min(0),chars:z.number().int().min(0).max(20000)}).strict()).max(32)}).strict();
/** Text is registered by the server; playback reports cannot introduce new dialogue. */
export class ReplyProgress {
 private chunks=new Map<number,{text:string;chars:number}>();
 register(seq:number,text:string){this.chunks.set(seq,{text,chars:0});}
 played(seq:number,chars?:number){const chunk=this.chunks.get(seq);if(chunk)chunk.chars=Math.max(chunk.chars,Math.min(chunk.text.length,chars??chunk.text.length));}
 get spoken(){return [...this.chunks].sort(([a],[b])=>a-b).map(([,chunk])=>chunk.text.slice(0,chunk.chars).trim()).filter(Boolean).join(' ');}
 interrupted(speak:boolean,generated:string){return cleanDialogueText(speak?this.spoken:generated).trim();}
}

/** Read old histories without presenting operational notes as things the assistant said. */
export function cleanDialogueText(text:string){return text.replace(/\[Response interrupted(?: by the user)?\.[^\]]*\]\s*/g,'');}
export function visibleDialogueText(text:string){const display=new ScriptDisplayStream();return display.push(cleanDialogueText(text))+display.flush();}

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
