// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { Caption } from './tts';
import {speechTextAt} from './reveal';

/** Only speech whose playback has started belongs in an interrupted conversation. */
export class SpeechPlayback {
 private chunks=new Map<number,{text:string;start:number;duration:number;words:Caption[]}>();
 private displayChunks=new Map<number,{text:string;start:number;duration:number;words:Caption[]}>();
 schedule(seq:number,text:string,start:number,duration:number,words:Caption[]=[]){const chunk={text,start,duration,words};this.chunks.set(seq,chunk);this.displayChunks.set(seq,chunk);}
 complete(seq:number){this.chunks.delete(seq);}
 clear(){this.chunks.clear();this.displayChunks.clear();}
 /** Completed source nodes may still be travelling through the output buffer. */
 revealed(now:number){return [...this.displayChunks.values()].map(chunk=>speechTextAt(chunk.text,(now-chunk.start)*1000,chunk.duration*1000,chunk.words.map(w=>({word:w.word,atMs:w.start_time*1000})))).filter(Boolean).join(' ');}
 spoken(now:number){return this.progress(now).map(({seq,chars})=>this.chunks.get(seq)!.text.slice(0,chars)).join(' ');}
 progress(now:number){return [...this.chunks].flatMap(([seq,chunk])=>{
  const elapsed=now-chunk.start;if(elapsed<=0)return [];
  let chars=0;
  if(elapsed>=chunk.duration)chars=chunk.text.length;
  else if(chunk.words.length){let offset=0;for(const word of chunk.words){const index=chunk.text.indexOf(word.word,offset);if(index<0)continue;if(word.end_time>elapsed)break;offset=index+word.word.length;chars=offset;}}
  else{const estimate=Math.floor(chunk.text.length*elapsed/Math.max(.001,chunk.duration));const prefix=chunk.text.slice(0,estimate);chars=prefix.search(/\s+\S*$/);if(chars<0)chars=0;}
  return chars?[{seq,chars}]:[];
 });}
}
