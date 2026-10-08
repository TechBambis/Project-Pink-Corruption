// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage';
import {SemanticMemory} from '../packages/ai/semantic-memory';
import {memoryContext} from '../packages/ai/memory';
import type {Embeddings} from '../packages/ai/embeddings';

class FixtureEmbeddings implements Embeddings {
 id='fixture-v1';dimensions=3;available=true;calls=0;
 async embed(texts:string[],_kind:'query'|'passage',signal:AbortSignal){signal.throwIfAborted();this.calls++;return texts.map(text=>Float32Array.from(/quiet music|soothing sounds|calming melodies/i.test(text)?[1,0,0]:/blue|azure/i.test(text)?[0,1,0]:[0,0,1]));}
}
const signal=()=>new AbortController().signal;
test('paraphrases retrieve older sourced episodes and cached embeddings survive a service restart',async()=>{
 const store=new Store(':memory:'),encoder=new FixtureEmbeddings(),memory=new SemanticMemory(store,encoder);
 try{
  const source=store.addTurn('user','I enjoy quiet music.');store.beginConversation();
  for(let i=0;i<40;i++)store.addTurn('user','A garden visit '+i);
  assert.deepEqual(store.searchEpisodes('Which soothing sounds help me relax?'),[]);
  await memory.index();const indexed=encoder.calls;
  const found=await memory.retrieve('Which soothing sounds help me relax?',signal());
  assert.equal(found.mode,'hybrid');assert.equal(found.episodes[0].id,source);assert.equal(found.episodes.length,1);
  await memory.retrieve('Which soothing sounds help me relax?',signal());assert.equal(encoder.calls,indexed+1);
  memory.close();const restarted=new SemanticMemory(store,new FixtureEmbeddings());
  await restarted.index();assert.equal((await restarted.retrieve('Which calming melodies do I like?',signal())).episodes[0].id,source);restarted.close();
 }finally{memory.close();store.db.close();}
});
test('semantic ranking finds old confirmed facts beyond the eight newest and respects corrected revisions',async()=>{
 const store=new Store(':memory:'),memory=new SemanticMemory(store,new FixtureEmbeddings());
 try{
  const old=store.saveMemory('audio','quiet music');for(let i=0;i<12;i++)store.saveMemory('garden '+i,'flowers');
  await memory.index();let found=await memory.retrieve('Which soothing sounds help me relax?',signal());
  assert.equal(found.facts[0].id,old);assert.match(memoryContext(store,'Which soothing sounds help me relax?',found)[0],/quiet music/);
  store.saveMemory('audio','azure');await memory.index();found=await memory.retrieve('Which soothing sounds help me relax?',signal());
  assert.ok(!found.facts.some(fact=>fact.id===old));assert.doesNotMatch(memoryContext(store,'sounds',found).join('\n'),/quiet music/);
 }finally{memory.close();store.db.close();}
});
test('forgetting a fact suppresses its revisions and source episodes; clearing removes vectors without crossing profiles',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'bambi-semantic-')),path=join(folder,'memory.sqlite');
 const a=new Store(path,'a'),b=new Store(path,'b'),ma=new SemanticMemory(a,new FixtureEmbeddings()),mb=new SemanticMemory(b,new FixtureEmbeddings());
 try{
  const source=a.addTurn('user','Remember audio: quiet music');const fact=a.saveMemory('audio','quiet music',source);a.beginConversation();
  const other=b.addTurn('user','quiet music belongs to B');b.beginConversation();await Promise.all([ma.index(),mb.index()]);
  assert.equal((await ma.retrieve('soothing sounds',signal())).episodes[0].id,source);
  assert.equal(a.forgetFact(fact),true);await ma.index();assert.deepEqual(a.searchEpisodes('quiet music'),[]);assert.deepEqual((await ma.retrieve('soothing sounds',signal())).episodes,[]);
  a.clearMemory();assert.equal(a.memoryVectors('fixture-v1').length,0);assert.equal((await mb.retrieve('soothing sounds',signal())).episodes[0].id,other);
 }finally{ma.close();mb.close();a.db.close();b.db.close();rmSync(folder,{recursive:true,force:true});}
});
test('forgetting during indexing cannot restore removed vectors',async()=>{
 let release!:(vectors:Float32Array[])=>void;const encoder:Embeddings={id:'delayed',dimensions:3,available:true,embed:()=>new Promise(resolve=>release=resolve)};
 const store=new Store(':memory:'),memory=new SemanticMemory(store,encoder);
 try{
  store.addTurn('user','quiet music');await Promise.resolve();store.clearMemory();release([Float32Array.from([1,0,0])]);await memory.index();
  assert.equal(store.memoryVectors('delayed').length,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM memory_vectors').get()!.n,0);
 }finally{memory.close();store.db.close();}
});
test('missing or failed semantic providers fall back to lexical search and caller cancellation remains effective',async()=>{
 const store=new Store(':memory:'),encoder=new FixtureEmbeddings(),memory=new SemanticMemory(store,encoder);
 try{
  store.addTurn('user','quiet music');store.beginConversation();await memory.index();encoder.available=false;
  assert.equal((await memory.retrieve('quiet music',signal())).mode,'lexical');encoder.available=true;
  encoder.embed=async()=>{throw Error('offline worker');};assert.equal((await memory.retrieve('quiet music',signal())).episodes.length,1);
  const controller=new AbortController();controller.abort();await assert.rejects(memory.retrieve('another query',controller.signal),{name:'AbortError'});
 }finally{memory.close();store.db.close();}
});
test('clearing memory while a query is in flight cannot return or recache removed evidence',async()=>{
 const store=new Store(':memory:'),encoder=new FixtureEmbeddings(),memory=new SemanticMemory(store,encoder);
 try{
  store.addTurn('user','quiet music');store.beginConversation();await memory.index();
  let release!:(vectors:Float32Array<ArrayBuffer>[])=>void,started!:()=>void;
  const queryStarted=new Promise<void>(resolve=>started=resolve);
  encoder.embed=()=>new Promise(resolve=>{release=resolve;started();});
  const retrieval=memory.retrieve('Which soothing sounds help me relax?',signal());await queryStarted;
  store.clearMemory();release([Float32Array.from([1,0,0])]);
  const found=await retrieval;assert.deepEqual(found.episodes,[]);assert.deepEqual(found.facts,[]);
  assert.equal(store.memoryVectors(encoder.id).length,0);
 }finally{memory.close();store.db.close();}
});
test('vector caches are model scoped and changed sources reject obsolete index writes',()=>{
 const store=new Store(':memory:');
 try{
  const id=store.addTurn('user','quiet music'),source=store.memorySource('turn',id)!;store.beginConversation();
  assert.equal(store.saveMemoryVector(source,'model-v1',Float32Array.from([1,0,0])),true);
  assert.equal(store.memoryVectors('model-v2').length,0);
  store.db.prepare('UPDATE turns SET content=? WHERE id=?').run('azure',id);
  assert.equal(store.memoryVectors('model-v1').length,0);
  assert.equal(store.saveMemoryVector(source,'model-v1',Float32Array.from([1,0,0])),false);
 }finally{store.db.close();}
});
