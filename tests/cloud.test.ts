// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CloudBackend, cloudConfiguration, CLOUD_MODEL_ALIAS,cloudSampling } from '../packages/ai/cloud';
import { buildChatRequest, PROTOCOL_VERSION } from '../packages/ai/request';
import { resolveReplyIntent } from '../packages/ai/intent';
import { communityQwen } from '../packages/ai/models';

test('main and overlay share context, defaults and explicit conversational intent',()=>{
  const a=buildChatRequest({type:'chat',text:'Hi',model:communityQwen});
  const b=buildChatRequest({type:'chat',text:'Hi',model:communityQwen});
  assert.deepEqual(a,b);assert.equal(a.context,24576);assert.equal(a.dialogue,true);assert.equal(a.protocolVersion,PROTOCOL_VERSION);
  const c=buildChatRequest({type:'chat',text:'Explain volume',model:CLOUD_MODEL_ALIAS},{[CLOUD_MODEL_ALIAS]:{backend:'cloud',context:32768}});
  assert.equal(c.backend,'cloud');assert.equal(c.context,32768);assert.equal(c.soundDesign,false);
  assert.equal(resolveReplyIntent('Hi','bambisleep-classic',true),'conversation');
  assert.equal(resolveReplyIntent('Start a session','bambisleep-classic',true),'narration');
  assert.equal(resolveReplyIntent('continue','bambisleep-classic',true,'continuation','conversation'),'conversation');
  assert.equal(resolveReplyIntent('continue','bambisleep-classic',true,'continuation','narration'),'narration');
  assert.equal(resolveReplyIntent('Hi','bambisleep-classic',false,'narration'),'narration');
});

test('cloud configuration is optional, bounded and rejects embedded credentials',()=>{
  assert.equal(cloudConfiguration({}),null);
  assert.throws(()=>cloudConfiguration({BAMBI_CLOUD_URL:'https://secret@example.com'}));
  assert.throws(()=>cloudConfiguration({BAMBI_CLOUD_URL:'https://example.com',BAMBI_CLOUD_CONTEXT:'999999'}));
  const salad=cloudConfiguration({BAMBI_CLOUD_URL:'https://example.com',BAMBI_CLOUD_API_KEY:'model-key',BAMBI_CLOUD_GATEWAY_KEY:'salad-key'});
  assert.equal(salad?.key,'model-key');assert.equal(salad?.gatewayKey,'salad-key');
  assert.throws(()=>cloudConfiguration({BAMBI_CLOUD_URL:'https://example.com',BAMBI_CLOUD_TOP_P:'0'}));
  assert.throws(()=>cloudConfiguration({BAMBI_CLOUD_URL:'https://example.com',BAMBI_CLOUD_TEMPERATURE:'NaN'}));
  const tuned=cloudConfiguration({BAMBI_CLOUD_URL:'https://example.com',BAMBI_CLOUD_TEMPERATURE:'0.65',BAMBI_CLOUD_CREATIVE_TEMPERATURE:'0.9',BAMBI_CLOUD_TOP_P:'1',BAMBI_CLOUD_TOP_K:'0',BAMBI_CLOUD_MIN_P:'0.05'})!;
  assert.equal(cloudSampling(tuned).temperature,.65);assert.equal(cloudSampling(tuned).top_k,0);
  assert.equal(cloudSampling(tuned,'creative').temperature,.9);
  assert.equal(cloudSampling({...tuned,kind:'openai-compatible'}).top_k,undefined);
  assert.equal(cloudSampling({...tuned,sampling:undefined}).temperature,.7);
});

test('cloud streams split SSE, uses configured identity, supports JSON planning and aborts obsolete requests',async()=>{
  const bodies:Record<string,unknown>[]=[];const gatewayHeaders:string[]=[];let authentication='';let closed=false;
  const server=createServer(async(req,res)=>{
    authentication=req.headers.authorization??'';
    gatewayHeaders.push(String(req.headers['salad-api-key']??''));
    const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString()||'{}');bodies.push(body);
    if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'served-model'}]}));return;}
    if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:'rendered'}));return;}
    if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:[1,2,3]}));return;}
    if(!body.stream){res.end(JSON.stringify({choices:[{message:{content:'{"action":"adapt"}'}}]}));return;}
    res.setHeader('Content-Type','text/event-stream');res.write('data: {"choices":[{"delta":{"content":"Hel');
    res.write('lo"}}]}\n\n');res.on('close',()=>{closed=true;});
    const timer=setTimeout(()=>res.end('data: [DONE]\n\n'),5000);res.on('close',()=>clearTimeout(timer));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};const backend=new CloudBackend({url:`http://127.0.0.1:${address.port}/v1`,model:'served-model',key:'test-secret',gatewayKey:'gateway-test-secret',context:32768,kind:'llama.cpp',timeoutMs:5000});
  try{
    assert.deepEqual(await backend.models(),[CLOUD_MODEL_ALIAS]);
    assert.equal(await backend.countTokens!([{role:'user',content:'Hi'}],new AbortController().signal),3);
    assert.deepEqual(await backend.structured([{role:'user',content:'Correction'}],CLOUD_MODEL_ALIAS,new AbortController().signal,32768,{}),{action:'adapt'});
    const stream=backend.stream([{role:'user',content:'Hi'}],CLOUD_MODEL_ALIAS,new AbortController().signal);
    assert.equal((await stream.next()).value?.text,'Hello');await stream.return(undefined);
    assert.equal(authentication,'Bearer test-secret');assert.equal(bodies.at(-1)?.model,'served-model');
    assert.equal(gatewayHeaders.length,5);assert.ok(gatewayHeaders.every(value=>value==='gateway-test-secret'));
    assert.equal(bodies.at(-1)?.dry_multiplier,0);
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,true);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('private token bridge counts with one request and rejects mismatched model identities',async()=>{
  let calls=0,identity='served-model';
  const server=createServer(async(req,res)=>{
    calls++;assert.equal(req.url,'/token-count');assert.equal(req.headers.authorization,'Bearer test-secret');
    const parts=[];for await(const part of req)parts.push(part);
    assert.deepEqual(JSON.parse(Buffer.concat(parts).toString()),{messages:[{role:'user',content:'Hello'}],model:'served-model'});
    res.end(JSON.stringify({count:7,model:identity}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  const backend=new CloudBackend({url:'http://127.0.0.1:1',tokenizerUrl:`http://127.0.0.1:${port}`,model:'served-model',key:'test-secret',context:32768,kind:'llama.cpp',timeoutMs:5000});
  try{
    const messages: {role:'user';content:string}[]=[{role:'user',content:'Hello'}];
    assert.equal(await backend.countTokens!(messages,new AbortController().signal),7);assert.equal(calls,1);
    identity='wrong-model';await assert.rejects(backend.countTokens!(messages,new AbortController().signal),/invalid count/);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('connection failure gives an actionable preparation error and preserves cancellation',async()=>{
  const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));
  const backend=new CloudBackend({url:`http://127.0.0.1:${port}`,model:'served-model',key:'private-test-key',context:32768,kind:'llama.cpp',timeoutMs:5000});
  await assert.rejects(backend.countTokens!([{role:'user',content:'Hello'}],new AbortController().signal),/Check the GPU workspace/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(backend.countTokens!([{role:'user',content:'Hello'}],controller.signal),{name:'AbortError'});
});
