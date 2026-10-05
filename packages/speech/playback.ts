// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { Caption } from './tts';

/** Only speech whose playback has started belongs in an interrupted conversation. */
export class SpeechPlayback {
 private chunks=new Map<number,{text:string;start:number;duration:number;words:Caption[]}>();
 schedule(seq:number,text:string,start:number,duration:number,words:Caption[]=[]){this.chunks.set(seq,{text,start,duration,words});}
 complete(seq:number){this.chunks.delete(seq);}
 clear(){this.chunks.clear();}
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
