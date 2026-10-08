// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyGate} from '../packages/ai/reply-gate';
import {buildChatRequest,ChatRequestSchema} from '../packages/ai/request';

const first='b2f97265-a89f-42c8-9170-59ef013a28a7',second='11598ae1-3b75-49d3-97c5-7bf8cd4708dd';
test('Stop invalidates a request before begin and rejects every kind of delayed reply output',()=>{
 const gate=new ReplyGate();gate.issue(first);gate.cancel();
 for(const type of ['begin','token','audio','sentence-end','action','stats','metric','notice','error','done','interrupted'])assert.equal(gate.accepts({type,requestId:first,id:'old'}),false,type);
 assert.equal(gate.accepts({type:'health'}),true);assert.equal(gate.accepts({type:'panic'}),true);
});
test('replacement replies survive old begins, cancellations, errors and effects',()=>{
 const gate=new ReplyGate();gate.issue(first);assert.equal(gate.accepts({type:'begin',requestId:first,id:'old'}),true);
 gate.issue(second);
 for(const type of ['begin','interrupted','error','action'])assert.equal(gate.accepts({type,requestId:first,id:'old'}),false);
 assert.equal(gate.accepts({type:'token',requestId:second,id:'new'}),false);
 assert.equal(gate.accepts({type:'begin',requestId:second,id:'new'}),true);
 assert.equal(gate.accepts({type:'begin',requestId:second,id:'new'}),false);
 assert.equal(gate.accepts({type:'audio',requestId:second,id:'old'}),false);
 assert.equal(gate.accepts({type:'audio',requestId:second,id:'new'}),true);
 assert.equal(gate.accepts({type:'done',requestId:second,id:'new'}),true);
 assert.equal(gate.accepts({type:'begin',requestId:second,id:'late'}),false);
});
test('preparation errors and pre-begin cancellation close only their own request',()=>{
 for(const type of ['error','interrupted']){
  const gate=new ReplyGate();gate.issue(second);
  assert.equal(gate.accepts({type,requestId:first,id:'old'}),false);
  assert.equal(gate.accepts({type,requestId:second,id:'new'}),true);
  assert.equal(gate.accepts({type:'begin',requestId:second,id:'new'}),false);
 }
});
test('chat builders retain valid client identities and legacy requests remain parseable',()=>{
 assert.equal(buildChatRequest({type:'chat',requestId:first,text:'Hi'}).requestId,first);
 assert.equal(ChatRequestSchema.parse({type:'chat',text:'Hi'}).requestId,undefined);
 assert.equal(ChatRequestSchema.safeParse({type:'chat',requestId:'invalid',text:'Hi'}).success,false);
});
