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

/** Candidate boundaries require complete syntax; a word count is never a fallback. */
export function safePhraseBoundaries(text:string,names:string[]=[],clauses=false,minWords=4){
 const boundaries:{end:number;sentence:boolean}[]=[];
 const triggers=findTriggers(text,[...names,...triggerAliases]);
 let brackets=0,quote='',code=false,emphasis='';
 for(let i=0;i<text.length;i++){
  const ch=text[i],previous=text[i-1]??'',next=text[i+1]??'';
  if(ch==='`'){code=!code;continue;}if(code)continue;
  if(ch==='['){brackets++;continue;}if(ch===']'){brackets=Math.max(0,brackets-1);continue;}if(brackets)continue;
  if(ch==='*'||ch==='_'){if(ch===previous)continue;emphasis=emphasis===ch?'':ch;continue;}
  if(ch==='"'||ch==='“'||ch==='”'){quote=quote?'':ch;continue;}
  if(ch==="'"&&!(/[a-z0-9]/i.test(previous)&&/[a-z0-9]/i.test(next))){quote=quote?'':ch;continue;}
  if(!/[.!?。！？,;]/.test(ch))continue;
  const sentence=/[.!?。！？]/.test(ch);if(!sentence&&!clauses)continue;
  if(ch==='.'&&(previous==='.'||next==='.'||/\d/.test(previous)&&/\d/.test(next)))continue;
  const prefix=text.slice(0,i+1);
  if(ch==='.'&&/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|No|Fig|Inc|Ltd|e\.g|i\.e|a\.m|p\.m)|\b[A-Z]|(?:\b[A-Za-z]\.){2,})\.$/i.test(prefix))continue;
  // Await a following whitespace: a period at a token edge can still become a decimal or ellipsis.
  let end=i+1;
  if(/["”']/.test(text[end]??''))end++;
  while(/[*_`]/.test(text[end]??''))end++;
  if(end>=text.length||! /\s/.test(text[end]))continue;
  // A quotation or emphasized paragraph can contain several complete spoken
  // sentences. Waiting for its final delimiter can hold minutes of speech.
  // Keep the stricter rule for early clauses; words and formatting stay intact.
  if(!sentence&&(quote&&end===i+1||emphasis&&end===i+1))continue;
  if(triggers.some(t=>t.index<end&&t.index+t.name.length>end))continue;
  // A named unit can itself contain punctuation and can still be arriving.
  if([...names,...triggerAliases].some(name=>{
   const lower=name.toLowerCase();
   for(let at=0;at<end;at++)if((at===0||/\s/.test(text[at-1]))&&lower.startsWith(text.slice(at,end).trimEnd().toLowerCase()))return true;
   return false;
  }))continue;
  if(!sentence){
   const visible=prefix.replace(/\[[^\]]*\]/g,'').trim();
   if(visible.split(/\s+/).length<minWords||/^(?:if|when|while|because|although|unless|until|after|before)\b/i.test(visible))continue;
   if(!/\b(?:is|are|am|was|were|can|will|would|should|must|have|has|feel|know|think|understand|agree|need|want|believe|remember|helps?|makes?)\b/i.test(visible))continue;
   if(/\b(?:and|or|but|to|of|for|with|a|an|the|that|which|because|can|will|would|should|must)[,;]$/i.test(visible))continue;
  }
  while(/\s/.test(text[end]??''))end++;
  boundaries.push({end,sentence});
 }
 return boundaries;
}

/** Bounded streaming phrases which never cut a known trigger between words. */
export class TriggerSentenceChunker {
 private buffer='';private released=false;
 get pendingCharacters(){return this.buffer.length;}
 constructor(private names:string[]=triggerAliases,private conversation=false,private reserveLow:()=>boolean=()=>true,private earlyClauses=true){}
 push(text:string){
  this.buffer+=text;const out:string[]=[];
  while(true){
   const boundary=safePhraseBoundaries(this.buffer,this.names,this.conversation&&this.earlyClauses,!this.released||this.reserveLow()?4:8)[0];
   const sentence=boundary?[this.buffer.slice(0,boundary.end),this.buffer.slice(0,boundary.end)]:null;
   if(sentence){
    // Conversation receives visible text without playback markers; no cue
    // lookahead is needed before speaking the first completed sentence.
    if(this.conversation){out.push(sentence[1].trim());this.released=true;this.buffer=this.buffer.slice(sentence[1].length);continue;}
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

   break;
  }
  return out;
 }
 flush(){const rest=this.buffer.trim();this.buffer='';return rest?[rest]:[];}
}
