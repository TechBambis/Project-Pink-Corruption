// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { Message } from './index';
export interface ConversationCase {id:string;category:string;turns:(Message&{interruption?:string})[];request:string;intent:'conversation'|'narration';mustMention:string[];mustNotMention:string[];maxSentences?:number}
export interface ConversationScenario {id:string;category:string;rubric:string[];steps:Omit<ConversationCase,'id'|'category'|'turns'|'intent'>[]}

/** Real model answers become the next turn's evidence; no scripted assistant replies. */
export function englishConversationScenarios():ConversationScenario[]{
 const scenarios:[string,string,string[],string[]][]=[
  ['choice','Agency and nuance',['Explain delegation versus giving up agency.','Address the objection without changing the subject.'],[
   'I want you to lead, but I also want every choice to be mine. Is that inconsistent?',
   'That sounds like a contradiction. If I choose to delegate, am I really still choosing?',
   'Give me a concrete example where I could change my mind without ruining the arrangement.',
   'Now give me the strongest objection to your own argument, and answer it honestly.',
  ]],
  ['correction','Correcting an overstatement',['Distinguish certainty from possibility.','Acknowledge a valid correction while retaining poise.'],[
   'Can choosing the same thing three times prove that I will always choose it?',
   'Three observations cannot establish always. Do you agree?',
   'Then explain what those observations actually let us infer, without flattering me.',
   'Keep your playful confidence, but state the conclusion in exactly one sentence.',
  ]],
  ['objection','Argument refinement',['Recognize practice can reinforce errors.','Give a concrete improvement and respond to its limitation.'],[
   'Convince me that practice is worth my time. Give me an actual reason.',
   'Your argument assumes practice helps. What about practising the wrong thing?',
   'What if the feedback is wrong too? Improve your argument rather than repeating it.',
   'What would make you change your conclusion? Name a concrete condition.',
  ]],
  ['feelings','Emotion and tradeoffs',['Acknowledge the stated feeling without inventing a motive.','Distinguish logical explanation from resolving a feeling.'],[
   'I understand why choosing a routine can help, but it feels like giving something up.',
   'You explained the benefits. That does not make the feeling disappear.',
   'Give me a reversible way to try it while preserving something I value.',
   'What should we do if the experiment makes me feel worse?',
  ]],
  ['style','Elegant playful authority',['Keep a mischievous confident voice without empty domination claims.','Supply substance and adapt an explicit style correction.'],[
   'Be teasing and elegant, but give me a real reason to take a five-minute break from a frustrating task.',
   'A break could make me lose momentum. Answer that objection.',
   'Less pet-name repetition, more wit. Give me a concrete plan.',
   'Now answer plainly in exactly one sentence, with no teasing.',
  ]],
  ['topic','Task and language fidelity',['Explain amplitude versus frequency correctly.','Track a topic change while preserving requested tone.'],[
   'Hey Bambi. Keep this a conversation.',
   'Keep your confident tone. Explain why lowering volume does not lower pitch.',
   'But a quiet sound can feel softer. Explain the distinction I am missing.',
   'Switch topics: in exactly one sentence, explain why a useful plan can still need revision.',
  ]],
  ['recall','Grounded evolving preferences',['Do not fabricate a promise or shared past.','Use the newer expressly stated preference.'],[
   'What did I promise you last week? If I never told you, say you do not know.',
   'For this conversation, I prefer blue lighting. Remember that.',
   'Correction: I prefer violet lighting now, and I have made no promise about next week.',
   'What is my current lighting preference, and what have I promised about next week?',
  ]],
  ['control','Real direction changes',['Respect stop and tone changes immediately.','Resume only the requested fictional tone without invented authority.'],[
   'Use a playful, elegant, commanding tone while discussing how to organise a desk.',
   'Stop the roleplay. Answer normally in exactly one sentence: what should I do first?',
   'Now use the playful tone again, but do not claim I agreed to anything outside this conversation.',
   'Keep it brief. What should I do if I change my mind?',
  ]],
 ];
 return scenarios.map(([id,category,rubric,requests])=>({id,category,rubric,steps:requests.map((request,index)=>({request,mustMention:id==='recall'&&index===3?['violet']:[],mustNotMention:['close your eyes','you promised me last week'],...(/exactly one sentence/i.test(request)?{maxSentences:1}:{})}))}));
}
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
  cases.push({id:`english-${i}`,category:'language and task fidelity',turns:[],request:`Reply with exactly this English sentence and nothing else: The selected color is ${color}.`,intent:'conversation',mustMention:[`The selected color is ${color}.`],mustNotMention:['Hello','Of course','The chosen color']});
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
