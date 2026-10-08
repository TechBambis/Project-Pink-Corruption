// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {findTriggers} from '../../config/trigger-sounds';
import {triggerAliases} from '../../config/trigger-sequence';
const pausePattern = '\\[pause:(?:\\d+|normal|short|medium|long|transition)\\]';
const annotationPattern = `(?:${pausePattern}|\\[(?:SFX|sound|tick|vib|rot|both|breath):[^\\]]+\\]|\\[PAUSE\\])`;
const trailingPauses = new RegExp(`((?:\\s*${pausePattern})+)\\s*$`);
const leadingPauses = new RegExp(`^[.!?,;:\\s]*((?:${pausePattern}\\s*)+)`);
export interface TriggerUnit {text:string;trigger?:string;prePause?:boolean;postPause?:boolean}
/** Remove emphasis around known names without changing the narration itself. */
export function plainTriggerNames(text:string,names:string[]=[]):string {
 const matches=findTriggers(text,[...names,...triggerAliases]);
 for(const match of matches.reverse()){
  const start=match.index,end=start+match.name.length;
  const before=text.slice(0,start),after=text.slice(end);
  const marker=/([*_]{1,3})$/.exec(before)?.[1];
  if(marker&&after.startsWith(marker))text=before.slice(0,-marker.length)+text.slice(start,end)+after.slice(marker.length);
 }
 return text;
}
/** Render each trigger as its own unit, so cues use actual speech durations. */
export function triggerUnits(text:string,names:string[]=[]):TriggerUnit[]{
 text=plainTriggerNames(text,names);
 const matches=findTriggers(text,[...names,...triggerAliases]);
 if(!matches.length)return [{text}];
 const units:TriggerUnit[]=[];let offset=0;
 for(const match of matches){
  let before=text.slice(offset,match.index).replace(/^[.!?,;:\s]+/,'').trim();
  const pre=trailingPauses.exec(before)?.[1]?.trim()??'';
  if(pre)before=before.slice(0,before.length-pre.length).trim();
  if(/[A-Za-z0-9]/.test(before))units.push({text:before+(/\[pause:(?:\d+|normal|short|medium|long|transition)\]$/.test(before)?'':' [pause:0]')});
  const spoken=text.slice(match.index,match.index+match.name.length);
  const end=match.index+match.name.length;
  const post=leadingPauses.exec(text.slice(end));
  units.push({text:[pre,spoken,post?.[1]?.trim()].filter(Boolean).join(' '),trigger:spoken,
   ...(pre?{prePause:true}:{}),...(post?{postPause:true}:{})});
  offset=end+(post?.[0].length??0);
 }
 const tail=text.slice(offset).replace(/^[.!?,;:\s]+/,'').trim();
 if(tail)units.push({text:tail});
 return units;
}

/** Bounded streaming phrases which never cut a known trigger between words. */
export class TriggerSentenceChunker {
 private buffer='';
 constructor(private names:string[]=triggerAliases,private conversation=false){}
 push(text:string){
  this.buffer+=text;const out:string[]=[];
  while(true){
   const sentence=/^([\s\S]*?[.!?。！？](?:["”']?)[*_`]*(?:\s|$))/.exec(this.buffer);
   if(sentence){
    // Conversation receives visible text without playback markers; no cue
    // lookahead is needed before speaking the first completed sentence.
    if(this.conversation){out.push(sentence[1].trim());this.buffer=this.buffer.slice(sentence[1].length);continue;}
    // Keep following pause markers with this sentence, including markers whose
    // characters arrive across token boundaries. Wait for the next spoken text.
    let end=sentence[1].length,rest=this.buffer.slice(end);
    while(true){
     const pause=new RegExp(`^\\s*${annotationPattern}\\s*`,'i').exec(rest);
     if(!pause || /\[(?:sound|tick|breath):/i.test(pause[0]))break;
     end+=pause[0].length;rest=this.buffer.slice(end);
    }
    const remainder=rest.trim().toLowerCase();
    if(!remainder||/^\[(?:pause|sfx|sound|tick|vib|rot|both|breath):[^\]]*$/.test(remainder)||['[pause:','[pause]','[sfx:','[sound:','[tick:','[vib:','[rot:','[both:','[breath:'].some(prefix=>prefix.startsWith(remainder)))break;
    if(end>sentence[1].length){
     const sentenceNames=findTriggers(sentence[1],[...this.names,...triggerAliases]);
     const last=sentenceNames.at(-1);
     const endsInTrigger=last&&!/[A-Za-z0-9]/.test(sentence[1].slice(last.index+last.name.length));
     const next=rest.trimStart().replace(/^[*_]{1,3}/,'');
     if(!endsInTrigger){
      // A marker before the next named trigger belongs inside its cue sequence.
      // Wait if that name itself is still arriving across token boundaries.
      const names=[...this.names,...triggerAliases];
      if(names.some(name=>name.toUpperCase().startsWith(next.toUpperCase()))&&!findTriggers(next,names).length)break;
      if(findTriggers(next,names)[0]?.index===0){
       out.push(sentence[1].trim()+' [pause:0]');this.buffer=this.buffer.slice(sentence[1].length);continue;
      }
     }
    }
    out.push(this.buffer.slice(0,end).trim());this.buffer=this.buffer.slice(end);continue;
   }
   if(this.buffer.length>(this.conversation?100:180)){
    let cut=this.buffer.lastIndexOf(' ',this.conversation?80:150);
    for(const match of findTriggers(this.buffer,[...this.names,...triggerAliases])){
     if(match.index<cut&&match.index+match.name.length>cut)cut=match.index;
    }
    for(const marker of this.buffer.matchAll(/\[(?:pause:|SFX:|sound:|tick:|vib:|rot:|both:|breath:)[^\]]*(?:\]|$)/gi)){
     if(marker.index!<cut&&marker.index!+marker[0].length>cut)cut=marker.index!;
    }
    if(cut>0){out.push(this.buffer.slice(0,cut).trim());this.buffer=this.buffer.slice(cut).trimStart();continue;}
   }
   break;
  }
  return out;
 }
 flush(){const rest=this.buffer.trim();this.buffer='';return rest?[rest]:[];}
}
