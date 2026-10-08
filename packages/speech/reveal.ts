// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

export interface RevealWord {word:string;atMs:number}

/** Reveal at word onset, using the same measured times as the caption display. */
export function speechTextAt(text:string,elapsedMs:number,durationMs:number,timings:RevealWord[]=[]){
 if(!Number.isFinite(elapsedMs)||elapsedMs<0||!(durationMs>0))return '';
 if(elapsedMs>=durationMs)return text;
 const measured=timings.filter(w=>w.word.trim()&&Number.isFinite(w.atMs)&&w.atMs>=0&&w.atMs<durationMs).sort((a,b)=>a.atMs-b.atMs);
 if(!measured.length){
  const words=[...text.matchAll(/\S+/g)];
  const entry=words[Math.min(words.length-1,Math.floor(elapsedMs/durationMs*words.length))];
  return entry?text.slice(0,entry.index!+entry[0].length):'';
 }
 let offset=0,visible=0;
 for(let i=0;i<measured.length;i++){
  const entry=measured[i];if(entry.atMs>elapsedMs+1e-6)break;
  const words=entry.word.trim().split(/\s+/),end=measured[i+1]?.atMs??durationMs;
  const count=Math.min(words.length,1+Math.floor(Math.max(0,elapsedMs-entry.atMs)/Math.max(1,end-entry.atMs)*words.length));
  for(const word of words.slice(0,count)){
   const index=text.indexOf(word,offset);if(index<0)continue;
   offset=index+word.length;visible=offset;
  }
 }
 return text.slice(0,visible);
}
