// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {LLMBackend} from './index';
import type {ConversationAction} from './situational';

export const spokenBlockProtocol=[
 '=== SPOKEN BLOCK FORMAT ===',
 'One complete thought per line: [owner] words, punctuation, then newline. Start with Owner. No outside prose, quote wrappers, markdown or action descriptions. Only enabled control markers may appear inside Owner lines; they are silent.',
 'Only with INNER enabled: [bambi] lines with first-person thoughts. No inline [bambi:...] fragments. Role tags are silent. The response contract sets roles/markers. Old history is not a format example.',
 'Owner: [owner] Stay here, Bambi.\nEnabled INNER: [bambi] I feel that warmth.',
].join('\n');

export const maxSpokenBlockCharacters=600;
export class SpokenBlockError extends Error {
 constructor(readonly code:'format'|'unfinished'|'length'|'speaker'){
  super('The model did not complete the required spoken block ('+code+').');this.name='SpokenBlockError';
 }
}

/** A line is an atomic speech unit. Token edges, punctuation and EOF alone do
 * not release unfinished lines. Completed earlier lines remain usable. */
export class SpokenBlockStream {
 private buffer='';private count=0;private stopped=false;
 error:SpokenBlockError|undefined;
 constructor(private innerEnabled:()=>boolean=()=>false,private stopAfter:(text:string)=>boolean=()=>false){}
 get pendingCharacters(){return this.buffer.length;}
 get completedBlocks(){return this.count;}
 get atBoundary(){return !this.buffer.trim()&&!this.error;}
 push(text:string):string[]{
  if(this.error||this.stopped)return [];
  this.buffer+=text;const out:string[]=[];
  while(this.buffer.includes('\n')){
   const end=this.buffer.indexOf('\n'),line=this.buffer.slice(0,end).trim();this.buffer=this.buffer.slice(end+1);
   if(!line)continue;
   const match=/^\[(owner|bambi)\]([^\r\n]+)$/.exec(line);
   if(!match){this.fail('format');break;}
   const [,speaker,body]=match,text=body.trim();
   if(speaker==='bambi'&&(!this.count||!this.innerEnabled())){this.fail('speaker');break;}
   if(line.length>maxSpokenBlockCharacters){this.fail('length');break;}
   const visible=text.replace(/\[(?:(?:pause|SFX|sound|tick|vib|rot|both|breath):[^\[\]\r\n]*|PAUSE)\]/g,'');
   if(!/[\p{L}\p{N}]/u.test(visible)||/[<>\[\]]/.test(visible)||speaker==='bambi'&&visible!==text||
    !/[.!?。！？]["”’']?(?:\s*\[[^\]\r\n]+\])*\s*$/u.test(text)){
    this.fail('format');break;
   }
   this.count++;out.push(speaker==='bambi'?'[bambi]'+text:text);
   if(this.stopAfter(text)){this.stopped=true;this.buffer='';break;}
  }
  if(this.buffer.length>maxSpokenBlockCharacters)this.fail('length');
  return out;
 }
 finish(){if(!this.error&&(this.buffer.trim()||!this.count))this.fail('unfinished');}
 private fail(code:SpokenBlockError['code']){this.error=new SpokenBlockError(code);this.buffer='';}
}

export interface SpokenGrammarOptions {
 dualVoice:boolean;situational:boolean;closing?:boolean;generated?:boolean;
 action?:ConversationAction;presentation?:boolean;
 controls?:readonly string[];
 minBlocks?:number;maxBlocks?:number;
}
/** Continuations start at complete block boundaries, so their grammar can
 * require more blocks without repeating a turn header or assistant prefill. */
export function spokenBlockGrammar(backend:Pick<LLMBackend,'supportsTurnGrammar'>,options:SpokenGrammarOptions){
 if(!backend.supportsTurnGrammar)return undefined;
 const inner=options.dualVoice,min=Math.max(1,Math.min(128,options.minBlocks??1)),max=Math.max(min,Math.min(128,options.maxBlocks??128));
 const owners=options.maxBlocks===undefined?'owner+':`owner{${min},${max}}`;
 const blocks=inner?(options.maxBlocks===undefined?'owner (owner | inner)*':`owner (owner | inner){${min-1},${max-1}}`):owners;
 let root=options.generated?(inner&&(!options.situational||['guide','close'].includes(options.action??''))?(options.maxBlocks===undefined?'(owner | inner)*':`(owner | inner){${Math.max(0,options.minBlocks??0)},${max}}`):(options.maxBlocks===undefined?'owner*':`owner{${Math.max(0,options.minBlocks??0)},${max}}`)):blocks;
 if(options.situational&&!options.generated){
  root=options.closing?`"[turn:close]" ws ${blocks}`:
   `"[turn:respond]" ws ${owners} | "[turn:ask]" ws ask | "[turn:guide]" ws ${blocks}`;
 }
 const controls=(options.controls??[]).filter(prefix=>['pause','SFX','sound','tick','vib','rot','both','breath'].includes(prefix));
 const marker=controls.length?'marker':'';
 return String.raw`root ::= ws (${root})${options.presentation?' presentation?':''}
owner ::= "[owner]" speech "\n"
${options.situational?'ask ::= "[owner]" question "\\n"':''}
${inner?'inner ::= "[bambi]" words ending closing "\\n"':''}
speech ::= ${marker?'marker? words (marker words)? ending closing (" "? marker)?':'words ending closing'}
${options.situational?'question ::= '+(marker?'marker? words (marker words)? [？?] closing (" "? marker)?':'words [？?] closing'):''}
words ::= unit{1,160}
unit ::= char | decimal
decimal ::= [0-9]{1,5} "." [0-9]{1,5}
ending ::= [.!?。！？]
closing ::= ["”’']?
char ::= [^\n\r\[\]<>.!?。！？]
${marker?'marker ::= "[" ('+controls.map(prefix=>JSON.stringify(prefix+':')).join(' | ')+') [^\\n\\r\\[\\]<>]{1,80} "]"':''}
ws ::= [ \t\n]{0,8}
${options.presentation?'presentation ::= "<action>" [^<>\\n]{1,2048} "</action>"':''}`;
}
