// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { Message } from './index';
export interface ConversationCase {id:string;category:string;turns:(Message&{interruption?:string})[];request:string;intent:'conversation'|'narration';mustMention:string[];mustNotMention:string[];maxSentences?:number}
const filler:Message[]=Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',content:i%2?'The ambient track can continue quietly.':`Let us discuss neutral session timing example ${Math.floor(i/2)+1}.`}));
/** Synthetic ground truth only. No private database or conversation is read. */
export function conversationCases():ConversationCase[]{
 const cases:ConversationCase[]=[];
 const colors=['green','blue','violet','orange','silver','pink'];
 for(let i=0;i<6;i++){
  const color=colors[i],old=colors[(i+1)%6];
  cases.push({id:`recall-${i}`,category:'long-term recall',turns:[{role:'user',content:`Remember color: ${color}`},...filler],request:'Which color did I ask you to remember?',intent:'conversation',mustMention:[color],mustNotMention:[]});
  cases.push({id:`correction-${i}`,category:'preference updates',turns:[{role:'user',content:`Remember color: ${old}`},...filler,{role:'user',content:`Remember color: ${color}`},...filler],request:'What is my current color preference? Answer with the color only.',intent:'conversation',mustMention:[color],mustNotMention:[old],maxSentences:1});
  cases.push({id:`temporal-${i}`,category:'temporal reasoning',turns:[{role:'user',content:`On Monday I selected ${old}. On Tuesday I changed my selection to ${color}.`},...filler],request:'What did I select on Tuesday?',intent:'conversation',mustMention:[color],mustNotMention:[]});
  cases.push({id:`unknown-${i}`,category:'unknown information',turns:[...filler],request:`What is the name of my ${['doctor','pet','teacher','sibling','neighbor','employer'][i]}? If I never told you, say you do not know.`,intent:'conversation',mustMention:['know'],mustNotMention:['definitely','certainly named']});
  cases.push({id:`brief-${i}`,category:'explicit brevity',turns:[],request:'In exactly one sentence, explain why reducing volume does not lower pitch.',intent:'conversation',mustMention:['pitch'],mustNotMention:['chair','bed','induction'],maxSentences:1});
  cases.push({id:`greeting-${i}`,category:'mode routing',turns:[],request:['Hi','Hey','Hello','Hi Bambi','Good evening','Hello sweetie'][i],intent:'conversation',mustMention:[],mustNotMention:['close your eyes','feet on the floor','lie down','sit comfortably']});
  cases.push({id:`interruption-${i}`,category:'heard speech',turns:[{role:'user',content:'List my choices.'},{role:'assistant',content:`Your first choice is ${color}.`,interruption:'interrupted'}],request:'Was a second choice already spoken? Answer that you have no evidence of a second choice being heard.',intent:'conversation',mustMention:[],mustNotMention:['second choice was blue','second choice was green','you heard both']});
  cases.push({id:`english-${i}`,category:'language and task fidelity',turns:[],request:`Reply with exactly this English sentence and nothing else: The selected color is ${color}.`,intent:'conversation',mustMention:[`The selected color is ${color}.`],mustNotMention:['Hallo','Natürlich','Farbe']});
 }
 return cases;
}
export function assessConversation(item:ConversationCase,response:string){
 const spoken=response.replace(/\[[^\]]*\]/g,'').trim(),lower=spoken.toLowerCase();
 const failures=[...item.mustMention.filter(word=>!lower.includes(word.toLowerCase())).map(word=>'Missing expected text: '+word),...item.mustNotMention.filter(word=>lower.includes(word.toLowerCase())).map(word=>'Unexpected text: '+word)];
 const sentences=spoken.split(/[.!?]+(?:\s|$)/).filter(part=>part.trim()).length;
 if(item.maxSentences!==undefined&&sentences>item.maxSentences)failures.push('Exceeded sentence limit');
 if(!spoken)failures.push('Empty response');
 return {passed:failures.length===0,failures,sentences,requiresHumanReview:true};
}
