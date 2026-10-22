// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../packages/storage';
import { explicitMemory, memoryContext } from '../packages/ai/memory';
import { fitContext,checkpointContextMessages } from '../packages/ai/context';
import {LlamaBackend,type Message} from '../packages/ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('native checkpoint boundary preserves every instruction and counts the messages actually sent',async()=>{
 const prefix='Complete immutable persona and voice instructions.';
 const dynamic='\n\nCurrent session time: 2.5 minutes. Do not emit device commands.';
 let lastCounted:Message[]=[];
 const count=async(messages:Message[])=>{lastCounted=messages;return messages.reduce((total,message)=>total+message.content.length+20,0);};
 const history:Message[]=[{role:'user',content:'An earlier question.'},{role:'assistant',content:'An earlier answer.'}];
 const plan=await fitContext(prefix+dynamic,history,'My current correction.',count,2000,200,40,64,['Confirmed preference: quiet music.'],{fastPlanning:true,checkpointPrefix:prefix});
 assert.deepEqual(plan.messages,lastCounted);
 assert.ok(plan.messages[0].content.startsWith(prefix));
 assert.ok(plan.messages[0].content.includes('Apply its response guidance'));
 assert.equal(plan.messages.at(-2)!.role,'user');
 assert.ok(plan.messages.at(-2)!.content.includes(dynamic));
 assert.ok(plan.messages.at(-2)!.content.includes('Confirmed preference: quiet music.'));
 assert.match(plan.messages[1].content,/REUSABLE CONTEXT BOUNDARY/);
 assert.deepEqual(plan.messages.slice(2,-2),history);
 assert.deepEqual(plan.messages.at(-1),{role:'user',content:'My current correction.'});
 assert.equal(plan.inputTokens,await count(plan.messages));
 const changed=checkpointContextMessages([{role:'system',content:prefix+'\n\nCurrent session time: 3 minutes.'},{role:'user',content:'A new question.'}],prefix);
 assert.deepEqual(changed[0],plan.messages[0],'Changing session state must retain the checkpoint prefix');
 assert.throws(()=>checkpointContextMessages([{role:'system',content:'Different persona'}],prefix),/does not match/);
});

test('changing session guidance and retrieved evidence retains the whole heard-history prefix',()=>{
 const prefix='Complete immutable character.';
 const history:Message[]=[{role:'user',content:'A correction: prefer quiet.'},{role:'assistant',content:'The room can stay quiet. '.repeat(2000)+'Heard ending.'}];
 const build=(tail:string,input:string)=>checkpointContextMessages([{role:'system',content:prefix+tail},...history,{role:'user',content:input}],prefix);
 const before=build('\nTime 2.5. Quoted memory: old preference.','Continue.');
 const after=build('\nTime 3.0. Quoted memory: corrected preference.','Please explain.');
 assert.deepEqual(before.slice(0,-2),after.slice(0,-2),'Dynamic guidance must not precede or invalidate any retained heard history');
 assert.deepEqual(after.slice(2,-2),history);
 assert.match(after.at(-2)!.content,/corrected preference/);
 assert.doesNotMatch(after.map(m=>m.content).join('\n'),/old preference/);
 assert.equal(after.at(-1)!.content,'Please explain.');
 assert.throws(()=>checkpointContextMessages([{role:'system',content:prefix},{role:'assistant',content:'Unfinished prefill'}],prefix),/final user input/);
});

test('checkpoint message overhead participates in context admission and ordinary backends keep their layout',async()=>{
 const prefix='All fixed instructions';
 const counter=async(messages:Message[])=>messages.length*100;
 await assert.rejects(fitContext(prefix+' changing state',[],'Question',counter,300,64,0,64,'',{checkpointPrefix:prefix}),/exceed/);
 const plan=await fitContext(prefix+' changing state',[],'Question',counter,400,64,0,64);
 assert.equal(plan.messages.length,2);
 const warm=await fitContext(prefix,[],'Ready.',counter,600,1,0,1,'',{checkpointPrefix:prefix});
 assert.equal(warm.messages.length,4);assert.ok(warm.messages[0].content.startsWith(prefix));
});

test('existing databases migrate without losing history and rebuild searchable older episodes', () => {
  const dir=mkdtempSync(join(tmpdir(),'bambi-memory-')),path=join(dir,'memory.sqlite');
  const old=new DatabaseSync(path);
  old.exec("CREATE TABLE turns(id INTEGER PRIMARY KEY,role TEXT,content TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO turns(role,content) VALUES('user','I enjoy lavender music');");old.close();
  const store=new Store(path);
  try {
    assert.equal(store.conversation()[0].content,'I enjoy lavender music');
    store.beginConversation(); assert.deepEqual(store.conversation(),[]);
    assert.equal(store.searchEpisodes('lavender')[0].content,'I enjoy lavender music');
    store.clearMemory(); assert.deepEqual(store.searchEpisodes('lavender'),[]);
  } finally {store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('user-confirmed corrections supersede old preferences and assistant inventions cannot become sourced facts',()=>{
  const store=new Store(':memory:');
  try{
    const user=store.addTurn('user','Remember voice: slow');const first=store.saveMemory('voice','slow',user);
    const assistant=store.addTurn('assistant','You prefer fast speech.');
    assert.throws(()=>store.saveMemory('voice','fast',assistant),/user turn/);
    const correction=store.addTurn('user','Remember voice: natural');store.saveMemory('VOICE','natural',correction);
    assert.equal(store.memoryFacts().length,1);assert.equal(store.memoryFacts()[0].value,'natural');assert.equal(store.memoryFacts()[0].supersedes,first);
    store.beginConversation();assert.equal(store.memoryFacts()[0].value,'natural');
    assert.match(memoryContext(store,'voice').join('\n'),/natural/);
    assert.equal(store.forgetFact(store.memoryFacts()[0].id),true);assert.deepEqual(store.memoryFacts(),[]);
  }finally{store.db.close();}
});

test('profile boundaries isolate transcript, source references, facts, search and forgetting',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bambi-profiles-')),path=join(dir,'memory.sqlite');
  const first=new Store(path,'first'),second=new Store(path,'second');
  try{
    const source=first.addTurn('user','Saffron preference');first.saveMemory('color','saffron',source);first.beginConversation();
    second.addTurn('user','Blue preference');second.saveMemory('color','blue');
    assert.deepEqual(second.searchEpisodes('saffron'),[]);assert.throws(()=>second.saveMemory('color','saffron',source));
    assert.equal(second.conversation().length,1);first.clearMemory();assert.equal(second.memoryFacts()[0].value,'blue');assert.equal(second.recent()[0].content,'Blue preference');
  }finally{first.db.close();second.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('long histories fit more than eight messages and reserve evidence without losing recent corrections',async()=>{
  const count=async(messages:{content:string}[])=>messages.reduce((sum,m)=>sum+m.content.length,0);
  const history=Array.from({length:60},(_,i)=>({role:i%2?'assistant' as const:'user' as const,content:i===58?'Correction: green':'round '+i}));
  const full=await fitContext('Complete persona',history,'Recall?',count,2000,300,20,64,['Confirmed color: green']);
  assert.ok(full.messages.length>10);assert.match(full.messages[0].content,/green/);
  const tight=await fitContext('Complete persona',history,'Recall?',count,200,64,20,64,['x'.repeat(200),'Color: green']);
  assert.match(tight.messages[0].content,/Color: green/);assert.ok(tight.messages.some(m=>m.content==='Correction: green'));
  assert.ok(tight.inputTokens+tight.maxTokens+tight.safetyTokens<=200);
});

test('automatic memory requires a deliberate user command',()=>{
  assert.deepEqual(explicitMemory('Remember voice style: speak slowly.'),{key:'voice style',value:'speak slowly.'});
  for(const text of ['I think you remember me.','Assistant says remember color: blue','remember this'])assert.equal(explicitMemory(text),null);
});

test('remote context planning bounds tokenizer trips and verifies underestimated history exactly',async()=>{
 let calls=0;const count=async(messages:{content:string}[])=>{calls++;return messages.reduce((sum,m)=>sum+m.content.length+(m.content.includes('expensive')?300:0),0);};
 const history=Array.from({length:40},(_,i)=>({role:i%2?'assistant' as const:'user' as const,content:'round '+i}));
 const plan=await fitContext('Long stable instructions '.repeat(50),history,'Question',count,3000,256,20,64,['A confirmed preference.'],{fastPlanning:true});
 assert.equal(calls,2);assert.ok(plan.messages.length>10);assert.ok(plan.inputTokens+plan.maxTokens+plan.safetyTokens<=3000);
 const underestimated=await fitContext('Instructions',history.map(turn=>({...turn,content:'expensive '+turn.content})),'Question',count,1000,256,20,64,[],{fastPlanning:true});
 assert.ok(underestimated.inputTokens+underestimated.maxTokens+underestimated.safetyTokens<=1000);assert.ok(underestimated.droppedTurns>0);
 assert.equal(underestimated.exactFallback,true);
});

test('native planning uses four HTTP requests for 128 turns and eight memories, with an exact final budget',async()=>{
 const original=globalThis.fetch;let httpCalls=0;
 globalThis.fetch=async(url,init)=>{httpCalls++;const body=JSON.parse(String(init?.body));
  if(String(url).endsWith('/apply-template'))return Response.json({prompt:JSON.stringify(body.messages)});
  assert.ok(String(url).endsWith('/tokenize'));return Response.json({tokens:Array(Math.ceil(body.content.length/3)).fill(1)});
 };
 try{
  const backend=new LlamaBackend('http://fixture.invalid'),signal=new AbortController().signal;
  const history:Message[]=Array.from({length:128},(_,i)=>({role:i%2?'assistant':'user',content:'Earlier exchange '+i}));
  const plan=await fitContext('Complete stable persona. '.repeat(100),history,'My latest correction.',messages=>backend.countTokens(messages,signal),16384,2048,256,512,Array.from({length:8},(_,i)=>'Confirmed preference '+i),{fastPlanning:true});
  assert.equal(httpCalls,4);assert.equal(plan.tokenizerCalls,2);assert.equal(plan.exactFallback,false);
  assert.equal(plan.inputTokens,Math.ceil(JSON.stringify(plan.messages).length/3));
  assert.equal(plan.droppedTurns,0);assert.ok(plan.inputTokens+plan.maxTokens+plan.safetyTokens<=16384);
 }finally{globalThis.fetch=original;}
});

test('exact fallback trims older expensive history before confirmed evidence and preserves the latest correction',async()=>{
 const history:Message[]=Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',content:i===38?'Correction: green':'round '+i}));
 const count=async(messages:Message[])=>messages.reduce((n,m)=>n+m.content.length+(m.content.startsWith('round')?120:0),0);
 const plan=await fitContext('Stable persona. '.repeat(50),history,'Recall?',count,1800,256,20,64,['Confirmed color: green'],{fastPlanning:true});
 assert.equal(plan.exactFallback,true);assert.ok(plan.droppedTurns>0);
 assert.match(plan.messages[0].content,/Confirmed color: green/);assert.ok(plan.messages.some(m=>m.content==='Correction: green'));
 assert.equal(plan.inputTokens,await count(plan.messages));assert.ok(plan.inputTokens+plan.maxTokens+plan.safetyTokens<=1800);
});

test('exact fallback drops optional evidence when it would displace the last correction',async()=>{
 const history:Message[]=[{role:'user',content:'Earlier question'},{role:'assistant',content:'Earlier answer'},{role:'user',content:'Correction: green'},{role:'assistant',content:'Understood'}];
 const count=async(messages:Message[])=>messages.reduce((n,m)=>n+m.content.length+(m.content.includes('Expensive evidence')?1000:0),0);
 const plan=await fitContext('Stable persona. '.repeat(30),history,'Recall?',count,1100,128,20,64,['Expensive evidence'],{fastPlanning:true});
 assert.equal(plan.exactFallback,true);assert.equal(plan.optionalContextIncluded,false);
 assert.ok(plan.messages.some(m=>m.content==='Correction: green'));assert.equal(plan.droppedTurns,0);
 assert.ok(plan.inputTokens+plan.maxTokens+plan.safetyTokens<=1100);
});

test('a dense persona cannot make estimates discard short exchanges that fit exactly',async()=>{
 const history:Message[]=Array.from({length:128},(_,i)=>({role:i%2?'assistant':'user',content:'ok'}));
 const count=async(messages:Message[])=>messages.reduce((n,m)=>n+m.content.length*(m.role==='system'?10:1),0);
 const plan=await fitContext('x'.repeat(200),history,'Recall?',count,2500,128,20,64,[],{fastPlanning:true});
 assert.equal(plan.droppedTurns,0);assert.equal(plan.tokenizerCalls,2);assert.equal(plan.inputTokens,await count(plan.messages));
});
