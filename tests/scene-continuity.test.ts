// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../packages/storage';
import {sceneMemoryContext} from '../packages/ai/memory';

test('scene continuity retains confirmed preferences across conversations and respects revisions, forget and clear',()=>{
 const store=new Store(':memory:','scene-profile');
 try{
  store.addTurn('assistant','An invented session outcome.');
  assert.deepEqual(sceneMemoryContext(store),[],'Generated narration cannot create confirmed continuity');
  const first=store.saveMemory('session motif','I like the heart as a quiet home image.');
  const context=sceneMemoryContext(store);
  assert.match(context[0],/does not prove any earlier event was delivered/);
  assert.match(context[0],/quiet home image/);
  store.beginConversation();assert.deepEqual(sceneMemoryContext(store),context);
  const revised=store.saveMemory('session motif','I now prefer an open ring.');
  assert.ok(!JSON.stringify(sceneMemoryContext(store)).includes('quiet home image'));
  assert.equal(store.memorySource('fact',first),null,'The superseded preference is not a retrieval source');
  assert.equal(store.forgetFact(revised),true);assert.deepEqual(sceneMemoryContext(store),[]);
  store.saveMemory('pace','Prefer longer connected thoughts.');store.clearMemory();
  assert.deepEqual(sceneMemoryContext(store),[]);
 }finally{store.db.close();}
});
