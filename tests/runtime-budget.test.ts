// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {fitContext} from '../packages/ai/context';
import {InferenceQueue,speechBatchBoundary} from '../packages/ai/inference';
import {compilePromptDocument} from '../packages/content/runtime-prompt';
import {prompts} from '../packages/content';
import {modelContext,modelLabel,modelSampling,communityQwen,communityQwen36,sthenoV32,anubisMiniV1,mistralRpNoromaid7B} from '../packages/ai/models';
import {Store} from '../packages/storage';
import {ReplyProgress} from '../packages/ai/dialogue';
import {llamaSampling} from '../config/sampling';
import {PrefillEchoFilter} from '../packages/ai/prefill';

test('budget reserves output and keeps the newest complete turns with their endings',async()=>{
 const count=async(messages:{content:string}[])=>messages.reduce((total,m)=>total+m.content.length,0);
 const history=[{role:'user' as const,content:'old input '.repeat(40)},{role:'assistant' as const,content:'old answer '.repeat(40)},
 {role:'user' as const,content:'Please change the final sentence.'},{role:'assistant' as const,content:'A complete reply. Its final sentence matters.'}];
 const plan=await fitContext('Instructions',history,'Latest correction.',count,400,200,50);
 assert.equal(plan.droppedTurns,2);assert.deepEqual(plan.messages.slice(1,-1),history.slice(2));
 assert.ok(plan.inputTokens+plan.maxTokens+plan.safetyTokens<=400);
 const important=[{role:'user' as const,content:'The important correction. '.repeat(4)},{role:'assistant' as const,content:'Played ending.'}];
 const withCorrection=await fitContext('Instructions',important,'Latest correction.',count,300,200,50,64);
 assert.deepEqual(withCorrection.messages.slice(1,-1),important);assert.ok(withCorrection.maxTokens<200);
 const small=await fitContext('i'.repeat(250),[],'latest input',count,400,200,50);
 assert.equal(small.maxTokens,88);assert.equal(small.messages.at(-1)?.content,'latest input');
 await assert.rejects(()=>fitContext('i'.repeat(350),[],'latest input',count,400,200,50),/exceed/);
});

test('runtime compilation preserves every section, examples and phase rules while removing exact duplicate sections',()=>{
 const duplicate='An instruction long enough to be duplicated in the source and still identified as a repeated instruction. '.repeat(2);
 const section=`=== EXTRA RULES ===\n${duplicate}\n\n`;
 const prompt={id:'fixture',name:'Fixture',description:'',main:`Frame.\n=== VOICE (RULE) ===\nRepeated example. Repeated example.\n\n${section}${section}=== OTHER PURPOSE ===\n${duplicate}\n=== BREATHING PROTOCOL (updated) ===\nNotice your breath.\n=== CONDITIONING PROTOCOL ===\nCurrent section.`,collar_addon:'Optional addon.',strategy:'Authored strategy.'};
 const original=JSON.stringify(prompt),induction=compilePromptDocument(prompt,'induction'),later=compilePromptDocument(prompt,'conditioning',true);
 assert.equal(JSON.stringify(prompt),original);assert.equal(induction.core.split('=== EXTRA RULES ===').length-1,1);
 assert.equal(induction.core.split(duplicate).length-1,2,'The same words under a different heading retain their purpose');
 assert.ok(induction.core.includes('Repeated example. Repeated example.'));assert.ok(induction.core.includes('Authored strategy'));
 assert.ok(induction.core.includes('Notice your breath'));assert.ok(later.core.includes('Notice your breath'));assert.ok(later.core.includes('Current section'));
 assert.equal(induction.phase,'');assert.equal(later.phase,'');
 assert.ok(later.core.includes('Optional addon'));assert.ok(!induction.core.includes('Optional addon'));
});

test('every unique authored line and section of every installed template is available in every phase',()=>{
 for(const prompt of prompts)for(const phase of ['induction','deepening','conditioning','anchor','awakening'] as const){
  const compiled=compilePromptDocument(prompt,phase,true).core;
  for(const line of [prompt.main,prompt.strategy,prompt.collar_addon].flatMap(text=>text.split('\n')).map(line=>line.trim()).filter(Boolean))assert.ok(compiled.includes(line),`${prompt.id}: an authored line was removed in ${phase}`);
 }
 assert.equal(modelContext(communityQwen,'bambisleep-classic'),24576);
 assert.equal(modelContext(communityQwen36,'bambisleep-classic'),24576);
 assert.equal(modelContext('ollama-fixture','bambisleep-classic'),24576);
 assert.equal(modelContext('ollama-fixture','custom'),4096);
 assert.equal(modelContext(sthenoV32,'bambisleep-classic'),8192);
 assert.equal(modelLabel(sthenoV32),'Llama 3.1 8B · Stheno v3.2 · Q4_K_M');
 assert.equal(modelContext(anubisMiniV1,'bambisleep-classic'),65536);
 assert.equal(modelLabel(anubisMiniV1),'Anubis Mini 8B v1 · TheDrummer · Q4_K_M');
 const anubisSampling=modelSampling(anubisMiniV1);
 assert.equal(anubisSampling.temperature,.95);assert.equal(anubisSampling.top_k,64);assert.equal(anubisSampling.min_p,.02);
 assert.equal(anubisSampling.presence_penalty,0);assert.equal(anubisSampling.repeat_penalty,1);
 assert.equal(anubisSampling.dry_multiplier,0);assert.equal(anubisSampling.dry_base,1.75);assert.equal(anubisSampling.dry_allowed_length,2);
 assert.equal(anubisSampling.xtc_probability,0);assert.equal(anubisSampling.xtc_threshold,.1);
 assert.equal(modelContext(mistralRpNoromaid7B,'bambisleep-classic'),24576);
 assert.equal(modelLabel(mistralRpNoromaid7B),'MistralRP Noromaid 7B · Moophlo · Q8_0');
});

test('older optional memory never displaces complete persona instructions or recent corrections',async()=>{
 const count=async(messages:{content:string}[])=>messages.reduce((sum,m)=>sum+m.content.length,0);
 const history=[{role:'user' as const,content:'A correction.'},{role:'assistant' as const,content:'Played reply.'}];
 const plan=await fitContext('Whole persona.',history,'Latest request.',count,300,200,20,100,'Older memory '.repeat(100));
 assert.equal(plan.optionalContextIncluded,false);assert.equal(plan.messages[0].content,'Whole persona.');assert.deepEqual(plan.messages.slice(1,-1),history);
 const memory=await fitContext('Whole persona.',history,'Latest request.',count,300,200,20,100,'Quoted older context.');
 assert.equal(memory.optionalContextIncluded,true);assert.ok(memory.messages[0].content.startsWith('Whole persona.\n\n'));assert.ok(memory.inputTokens+memory.maxTokens+memory.safetyTokens<=300);
});

test('played excerpts retain their ending and memory extraction never duplicates old turns',()=>{
 const store=new Store(':memory:');
 try{
  const progress=new ReplyProgress(),text='A complete played sentence. '.repeat(40)+'The last correction.';
  progress.register(0,text);progress.played(0);assert.equal(progress.interrupted(true,'Unheard future.'),text);
  for(let i=0;i<6;i++){store.addTurn('user','Question '+i);store.addTurn('assistant',i===0?progress.interrupted(true,'Unheard future.'):'Answer '+i,i===0?'interrupted':null);}
  store.refreshConversationSummary(8);const first=store.conversationSummary();
  assert.ok(first.includes('The last correction.'));assert.ok(!first.includes('Unheard future'));assert.ok(first.includes('unfinished'));
  store.refreshConversationSummary(8);assert.equal(store.conversationSummary(),first);
  store.addTurn('user','New correction');store.addTurn('assistant','New answer');store.refreshConversationSummary(8);
  assert.equal(store.conversationSummary().split('Question 0').length-1,1);
  store.beginConversation();assert.equal(store.conversationSummary(),'');assert.deepEqual(store.conversation(),[]);
 }finally{store.db.close();}
});

test('listening takes priority after the active batch and cancelled queue entries never run',async()=>{
 const queue=new InferenceQueue(),signal=new AbortController().signal,events:string[]=[];
 let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 const active=queue.run(async()=>{events.push('active');await hold;},signal);
 await Promise.resolve();
 const next=queue.run(async()=>{events.push('continuation');},signal);
 const abort=new AbortController();const removed=queue.run(async()=>{events.push('cancelled');},abort.signal,20);const rejected=assert.rejects(removed);abort.abort();
 const listening=queue.run(async()=>{events.push('listening');},signal,10);
 release();await Promise.all([active,next,listening,rejected]);
 assert.deepEqual(events,['active','listening','continuation']);
});

test('batches suspend at complete sentences and never in a split playback marker',()=>{
 assert.equal(speechBatchBoundary('One sentence. Second sentence. Third sentence.'),true);
 assert.equal(speechBatchBoundary('One sentence. Second sentence.'),false);
 assert.equal(speechBatchBoundary('One sentence. Second sentence. Third sentence. [pause:med'),false);
 assert.equal(speechBatchBoundary('One sentence. Second sentence. Third sentence. [pause:medium]'),true);
 assert.equal(speechBatchBoundary('word '.repeat(48)),true);
 assert.equal(speechBatchBoundary('One. Two. Three. <action>'),false);
 const baseline=llamaSampling('qwen');assert.equal(baseline.dry_multiplier,0);assert.equal(baseline.xtc_probability,0);
 assert.equal(llamaSampling('creative').xtc_probability,.4);
});

test('native prefill echoes are removed across every delta split, while ordinary continuation survives',()=>{
 const prefix='First completed sentence. Second sentence. ',next='The next sentence follows.';
 for(let i=0;i<=prefix.length+next.length;i++){
  const filter=new PrefillEchoFilter(prefix),response=prefix+next;
  assert.equal(filter.push(response.slice(0,i))+filter.push(response.slice(i))+filter.flush(),next);
 }
 const noEcho=new PrefillEchoFilter(prefix);assert.equal(noEcho.push('The next sentence follows.')+noEcho.flush(),next);
 const overlapping=new PrefillEchoFilter(prefix);assert.equal(overlapping.push('First')+overlapping.push('ly, a different sentence.')+overlapping.flush(),'Firstly, a different sentence.');
});
