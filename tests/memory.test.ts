// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../packages/storage';
import { explicitMemory, memoryContext } from '../packages/ai/memory';
import { fitContext } from '../packages/ai/context';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
});
