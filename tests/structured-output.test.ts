// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {parseStructuredOutput,StructuredOutputError} from '../packages/ai/structured';
import {LlamaBackend,OllamaBackend} from '../packages/ai';

test('structured output classifies incomplete and malformed responses without quoting generated content',()=>{
 assert.deepEqual(parseStructuredOutput('{"text":"Damn, complete."}','stop'),{text:'Damn, complete.'});
 for(const reason of ['length','max_tokens'])assert.throws(()=>parseStructuredOutput('{"text":"Complete."}',reason),(error:unknown)=>error instanceof StructuredOutputError&&error.reason==='truncated');
 for(const value of ['{"private":"unfinished secret',undefined,null,'x'.repeat(65537)])assert.throws(()=>parseStructuredOutput(value),(error:unknown)=>error instanceof StructuredOutputError&&error.reason==='invalid'&&!error.message.includes('secret'));
});

test('native and Ollama structured adapters report truncation instead of passing partial JSON to callers',async()=>{
 let content='{"private":"unfinished secret',reason='length';
 const server=createServer(async(req,res)=>{
  for await(const _ of req){}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url==='/api/chat'?{message:{content},done_reason:reason}:{choices:[{message:{content},finish_reason:reason}]}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  const backends=[new LlamaBackend(url),new OllamaBackend(url)];
  const run=(backend:typeof backends[number])=>backend.structured([{role:'user',content:'Fixture'}],'fixture',new AbortController().signal,4096,{}, {maxTokens:128});
  for(const backend of backends)await assert.rejects(run(backend),(error:unknown)=>error instanceof StructuredOutputError&&error.reason==='truncated');
  reason='stop';for(const backend of backends)await assert.rejects(run(backend),(error:unknown)=>error instanceof StructuredOutputError&&error.reason==='invalid');
  content='{"text":"Damn, complete."}';for(const backend of backends)assert.deepEqual(await run(backend),{text:'Damn, complete.'});
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
