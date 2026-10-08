// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {situationalTurnGrammar} from '../packages/ai/turn-grammar';
import {LlamaBackend,OllamaBackend} from '../packages/ai';

test('turn grammar is opt-in and only applies to a supported situational first batch',()=>{
 const native=new LlamaBackend(),ordinary=new OllamaBackend();
 const options={enabled:true,situational:true,generated:''};
 assert.match(situationalTurnGrammar(native,options)!,/action ::= "respond" \| "ask" \| "guide"/);
 assert.match(situationalTurnGrammar(native,{...options,closing:true})!,/action ::= "close"/);
 assert.equal(situationalTurnGrammar(native,{...options,enabled:false}),undefined);
 assert.equal(situationalTurnGrammar(native,{...options,situational:false}),undefined);
 assert.equal(situationalTurnGrammar(native,{...options,generated:'[turn:ask] A question'}),undefined);
 assert.equal(situationalTurnGrammar(ordinary,options),undefined);
});

test('native streaming forwards grammar while continuation does not repeat private metadata',async()=>{
 const original=globalThis.fetch,requests:Record<string,unknown>[]=[];
 globalThis.fetch=async(_url,init)=>{requests.push(JSON.parse(init!.body as string));return new Response('data: {"choices":[{"delta":{"content":"[turn:ask] How are you?"}}]}\n');};
 try{
  const backend=new LlamaBackend(),signal=new AbortController().signal;
  const grammar=situationalTurnGrammar(backend,{enabled:true,situational:true,generated:''});
  for await(const _token of backend.stream([{role:'user',content:'Hello'}],'fixture',signal,4096,64,'creative',grammar)){}
  const continued=situationalTurnGrammar(backend,{enabled:true,situational:true,generated:'[turn:ask] How are'});
  for await(const _token of backend.stream([{role:'assistant',content:'[turn:ask] How are'}],'fixture',signal,4096,64,'creative',continued)){}
  assert.equal(requests[0].grammar,grammar);assert(!('grammar' in requests[1]));
 }finally{globalThis.fetch=original;}
});
