// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {SessionPhase} from '../session-director/phases';
import {TriggerSentenceChunker} from './trigger-units';

export type VoiceRole='owner'|'bambi';
export interface VoiceTrack {speaker:VoiceRole;gainDb:number;pan:number;reverbMs:number;reverbDb:number}
export const dualVoiceLevels:Record<SessionPhase,{owner:number;bambi:number;fragments:string}>= {
 induction:{owner:0,bambi:-14,fragments:'1–2 short fragments'},
 deepening:{owner:0,bambi:-12,fragments:'3–4 short fragments'},
 conditioning:{owner:-2,bambi:-10,fragments:'5–6 short fragments'},
 anchor:{owner:-4,bambi:-6,fragments:'full sentences'},
 awakening:{owner:-8,bambi:-6,fragments:'full sentences'},
};
/** One instance per reply keeps alternating pan independent of other clients. */
export class DualVoiceSession {
 private fragment=0;
 constructor(readonly phase:SessionPhase='induction'){}
 track(speaker:VoiceRole):VoiceTrack {
  return {speaker,gainDb:dualVoiceLevels[this.phase][speaker],pan:speaker==='bambi'?(this.fragment++%2?.3:-.3):0,
   reverbMs:speaker==='bambi'?200:0,reverbDb:-18};
 }
}

/** Inline fragments may contain pause/control tags; only the outer bracket ends the role. */
export function voiceTagEnd(text:string){
 if(!/^\[bambi:/i.test(text))return text.indexOf(']');
 let depth=0;
 for(let index=0;index<text.length;index++){
  if(text[index]==='[')depth++;
  else if(text[index]===']'&&--depth===0)return index;
 }
 return -1;
}

/** Incremental role parser. Incomplete metadata never reaches the sentence parser. */
export class VoiceSentenceChunker {
 private buffer='';private role:VoiceRole='owner';
 private owner:TriggerSentenceChunker;private inner:TriggerSentenceChunker;
 constructor(names:string[]=[],private enabled=false,conversation=false,reserveLow:()=>boolean=()=>true,earlyClauses=true){this.owner=new TriggerSentenceChunker(names,conversation,reserveLow,earlyClauses);this.inner=new TriggerSentenceChunker(names);}
 get pendingCharacters(){return this.buffer.length+this.owner.pendingCharacters+this.inner.pendingCharacters;}
 private ownerText(text:string){return this.owner.push(text);}
 private finishRole(){
  if(this.role==='owner')return this.owner.flush();
  return this.inner.flush().flatMap(text=>this.enabled?[`[bambi]${text}`]:[]);
 }
 push(text:string):string[]{
  this.buffer+=text;const out:string[]=[];
  const consume=(part:string)=>{if(this.role==='owner')out.push(...this.ownerText(part));else if(this.enabled)out.push(...this.inner.push(part).map(text=>`[bambi]${text}`));};
  while(this.buffer){
   const at=this.buffer.indexOf('[');
   if(at<0){consume(this.buffer);this.buffer='';break;}
   consume(this.buffer.slice(0,at));this.buffer=this.buffer.slice(at);
   const end=voiceTagEnd(this.buffer);
   if(end<0)break;
   const tag=this.buffer.slice(0,end+1);this.buffer=this.buffer.slice(end+1);
   if(/^\[(owner|bambi)\]$/i.test(tag)){
    out.push(...this.finishRole());this.role=tag.slice(1,-1).toLowerCase() as VoiceRole;
   }else if(/^\[bambi:/i.test(tag)){
    // Inline background fragments temporarily switch roles, then restore the owner.
    out.push(...this.finishRole());const fragment=tag.slice(7,-1).trim();
    if(this.enabled&&fragment)out.push(`[bambi]${fragment}`);this.role='owner';
   }else consume(tag);
  }
  return out;
 }
 flush():string[]{
  const out:string[]=[];
  // Discard unfinished controls, rather than pronouncing a partial role marker.
  if(this.buffer&&!this.buffer.startsWith('[')){
   if(this.role==='owner')out.push(...this.ownerText(this.buffer));else if(this.enabled)out.push(...this.inner.push(this.buffer).map(text=>`[bambi]${text}`));
  }
  this.buffer='';out.push(...this.finishRole());return out;
 }
}

/** Full scripts share exactly the streaming role semantics. */
export function voiceScriptRuns(text:string,enabled=false){
 const stream=new VoiceSentenceChunker([],enabled);
 const runs=[...stream.push(text),...stream.flush()].map(part=>{
  const match=/^\[bambi\]([\s\S]*)$/i.exec(part);
  return {speaker:match?'bambi' as const:'owner' as const,text:match?match[1]:part};
 });
 // Full-script callers retain each authored inner block as one run. Streaming
 // callers above receive completed thoughts without waiting for a role change.
 return runs.reduce<typeof runs>((out,run)=>{const last=out.at(-1);if(run.speaker==='bambi'&&last?.speaker==='bambi')last.text+=' '+run.text;else out.push(run);return out;},[]);
}
