// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CloudBackend, cloudConfiguration, CLOUD_MODEL_ALIAS,cloudSampling } from '../packages/ai/cloud';
import { buildChatRequest, PROTOCOL_VERSION } from '../packages/ai/request';
import { resolveReplyIntent } from '../packages/ai/intent';
import { communityQwen, modelLabel } from '../packages/ai/models';
import { buildRuntimePrompt, defaultTriggers } from '../packages/content';
import { buildReplyPrompt } from '../packages/ai/prompt';
import { fitContext, estimateChatTokens } from '../packages/ai/context';

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
    const closeDeadline=performance.now()+1000;while(!closed&&performance.now()<closeDeadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,true,'Returning from the stream closes the server request before its five-second completion');
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
  await assert.rejects(backend.countTokens!([{role:'user',content:'Hello'}],new AbortController().signal),/Check the inference server/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(backend.countTokens!([{role:'user',content:'Hello'}],controller.signal),{name:'AbortError'});
});

test('remote Ollama uses its configured identity and context, disables thinking and supports split NDJSON and structured decisions',async()=>{
  const bodies:Record<string,any>[]=[];let servedModel='remote-qwen:latest';let closed=false;
  const server=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,undefined);assert.equal(req.headers['salad-api-key'],undefined);
    if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:servedModel}]}));return;}
    assert.equal(req.url,'/api/chat');
    const parts=[];for await(const part of req)parts.push(part);
    const body=JSON.parse(Buffer.concat(parts).toString());bodies.push(body);
    if(!body.stream){res.end(JSON.stringify({message:{content:'{"action":"continue"}'}}));return;}
    res.setHeader('Content-Type','application/x-ndjson');
    res.write('{"message":{"content":"Hel');res.write('lo"},"done":false}\n');
    res.on('close',()=>{closed=true;});
    const timer=setTimeout(()=>res.end('{"message":{"content":""},"done":true}\n'),5000);
    res.on('close',()=>clearTimeout(timer));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  const config=cloudConfiguration({BAMBI_CLOUD_URL:`http://127.0.0.1:${port}`,BAMBI_CLOUD_MODEL:'remote-qwen:latest',BAMBI_CLOUD_KIND:'ollama',BAMBI_CLOUD_CONTEXT:'8192',BAMBI_CLOUD_TOP_K:'20'})!;
  const backend=new CloudBackend(config);
  try{
    assert.deepEqual(await backend.models(),[CLOUD_MODEL_ALIAS]);
    servedModel='another-model:latest';await assert.rejects(backend.models(),/Configured cloud model is not available/);
    assert.equal(backend.countTokens,undefined);assert.equal(backend.supportsPrefill,false);
    const schema={type:'object',properties:{action:{type:'string'}},required:['action']};
    assert.deepEqual(await backend.structured([{role:'user',content:'Neutral test'}],CLOUD_MODEL_ALIAS,new AbortController().signal,131072,schema),{action:'continue'});
    assert.deepEqual(bodies[0].format,schema);assert.equal(bodies[0].options.num_predict,64);
    const stream=backend.stream([{role:'user',content:'Neutral test'}],CLOUD_MODEL_ALIAS,new AbortController().signal,131072,24,'creative');
    assert.equal((await stream.next()).value?.text,'Hello');await stream.return(undefined);
    assert.ok(bodies.every(body=>body.model==='remote-qwen:latest'&&body.think===false&&body.options.num_ctx===8192));
    assert.equal(bodies.at(-1)?.options.num_predict,24);assert.equal(bodies.at(-1)?.options.top_k,20);
    assert.equal(bodies.at(-1)?.options.temperature,1);assert.equal(bodies.at(-1)?.options.dry_multiplier,undefined);
    const closeDeadline=performance.now()+1000;while(!closed&&performance.now()<closeDeadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(closed,true,'Returning from the stream closes the server request before its five-second completion');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('remote Ollama provider errors do not disclose response bodies or private prompts',async()=>{
  let response='{"error":"private prompt and provider secret"}\n';
  const server=createServer((_req,res)=>res.end(response));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  const backend=new CloudBackend({url:`http://127.0.0.1:${port}`,model:'remote-qwen:latest',key:'',context:8192,kind:'ollama',timeoutMs:5000});
  try{
    await assert.rejects(async()=>{for await(const _chunk of backend.stream([{role:'user',content:'Neutral test'}],CLOUD_MODEL_ALIAS,new AbortController().signal)){}},/^Error: Cloud generation failed$/);
    await assert.rejects(backend.structured([{role:'user',content:'Neutral test'}],CLOUD_MODEL_ALIAS,new AbortController().signal,8192,{}), /^Error: Cloud generation failed$/);
    response='not JSON: private prompt and provider secret';
    await assert.rejects(async()=>{for await(const _chunk of backend.stream([{role:'user',content:'Neutral test'}],CLOUD_MODEL_ALIAS,new AbortController().signal)){}},/^Error: Cloud streaming response is invalid$/);
    response=JSON.stringify({message:{content:'not JSON: private prompt and provider secret'}});
    await assert.rejects(backend.structured([{role:'user',content:'Neutral test'}],CLOUD_MODEL_ALIAS,new AbortController().signal,8192,{}),/^StructuredOutputError: The AI returned an invalid JSON response\.$/);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


test('configured remote labels preserve saved slot IDs without inventing model identity or quantization',()=>{
  assert.equal(modelLabel(CLOUD_MODEL_ALIAS,{[CLOUD_MODEL_ALIAS]:'remote-qwen:latest · Remote'}),'remote-qwen:latest · Remote');
  assert.equal(modelLabel(CLOUD_MODEL_ALIAS),'Remote AI');
  assert.equal(modelLabel(communityQwen,{[CLOUD_MODEL_ALIAS]:'remote-qwen:latest · Remote'}),'Qwen3.5 9B · HauhauCS · Q4_K_M');
});


test('default remote context fits complete compiled persona prompts and reserves the reply',async()=>{
  const config=cloudConfiguration({BAMBI_CLOUD_URL:'http://127.0.0.1:11434',BAMBI_CLOUD_MODEL:'remote-qwen:latest',BAMBI_CLOUD_KIND:'ollama'})!;
  for(const id of ['bambisleep-classic','gentle-induction']){
    const document=buildRuntimePrompt(id,'Test',defaultTriggers,false,'');
    const system=buildReplyPrompt(document.core,'Hello.',false,'',undefined,'',true,false);
    const count=async (messages:Parameters<typeof estimateChatTokens>[0])=>estimateChatTokens(messages);
    const plan=await fitContext(system,[],'Hello.',count,config.context,2048);
    assert.equal(plan.messages[0].content,system);assert.equal(plan.maxTokens,2048);
    if(id==='bambisleep-classic')await assert.rejects(fitContext(system,[],'Hello.',count,8192,2048),/exceed the 8,192-token context/);
  }
});

test('scene JSON budgets reach every remote adapter and truncation remains a bounded retry signal',async()=>{
 const bodies:any[]=[];let truncated=false;
 const server=createServer(async(req,res)=>{
  const parts:Buffer[]=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString());bodies.push(body);
  res.end(JSON.stringify(req.url==='/api/chat'?{message:{content:'{"strategy":"Complete."}'},done_reason:truncated?'length':'stop'}:{choices:[{message:{content:'{"strategy":"Complete."}'},finish_reason:truncated?'length':'stop'}]}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,signal=new AbortController().signal;
 try{
  for(const kind of ['llama.cpp','openai-compatible','ollama'] as const){
   const backend=new CloudBackend({url,model:'fixture',key:'',context:24576,kind,timeoutMs:5000});
   await backend.structured([{role:'user',content:'Plan a scene.'}],CLOUD_MODEL_ALIAS,signal,24576,{}, {maxTokens:1536,temperature:.65});
   const body=bodies.at(-1);assert.equal(kind==='ollama'?body.options.num_predict:body.max_tokens,1536);assert.equal(kind==='ollama'?body.options.temperature:body.temperature,.65);
   truncated=true;await assert.rejects(backend.structured([{role:'user',content:'Plan a scene.'}],CLOUD_MODEL_ALIAS,signal,24576,{}, {maxTokens:1536}),/^StructuredOutputError: The AI stopped before completing its JSON response\.$/);truncated=false;
   await backend.structured([{role:'user',content:'Classify.'}],CLOUD_MODEL_ALIAS,signal,24576,{});
   assert.equal(kind==='ollama'?bodies.at(-1).options.num_predict:bodies.at(-1).max_tokens,64,'Small existing decisions keep their default');
  }
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
