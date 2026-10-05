// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** A lightweight English phrase heuristic, not a neural semantic turn detector. */
export function unfinishedPhrase(text:string){return /(?:\b(?:because|although|unless|while|if|and|but|or|so|to|with|about|the|a|an)|[,;:]|\.{3}|…)\s*$/i.test(text.trim());}
export interface PendingSpeech {text:string;endedAt:number}
/** Hold incomplete phrases briefly and merge a resumed utterance before committing a reply. */
export class SpeechTurns {
 private pending:PendingSpeech|null=null;private timer:ReturnType<typeof setTimeout>|null=null;private epoch=0;
 constructor(private commit:(speech:PendingSpeech)=>void,private holdMs=1000){}
 receive(text:string,endedAt:number,smart=true){if(this.timer)clearTimeout(this.timer);this.timer=null;const item={text:[this.pending?.text,text].filter(Boolean).join(' '),endedAt:this.pending?.endedAt??endedAt};this.pending=item;if(!smart||!unfinishedPhrase(item.text)){this.flush();return;}const epoch=this.epoch;this.timer=setTimeout(()=>{if(epoch===this.epoch)this.flush();},this.holdMs);}
 resume(){if(this.timer)clearTimeout(this.timer);this.timer=null;}
 flush(){if(this.timer)clearTimeout(this.timer);this.timer=null;const pending=this.pending;this.pending=null;if(pending)this.commit(pending);}
 clear(){this.epoch++;if(this.timer)clearTimeout(this.timer);this.timer=null;this.pending=null;}
 get waiting(){return this.pending!==null;}
}
