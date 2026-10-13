// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFixedReplyPrompt,buildReplyPrompt} from '../packages/ai/prompt';
import {snapshotSession} from '../packages/ai/session-state';
import {Kokoro} from '../packages/speech/tts';
import {LlamaBackend} from '../packages/ai';
import {liquidSmall} from '../packages/ai/models';
import {TriggerSentenceChunker} from '../packages/speech/trigger-units';

test('LiquidAI renders its embedded template and supplies checkpoint boundaries without rewriting the prompt',async t=>{
 const prompt='<|im_start|>system\nComplete authored instructions.<|im_end|>\n<|im_start|>user\nPublic question<|im_end|>\n<|im_start|>assistant\n';
 let generationSignal:AbortSignal|undefined;
 t.mock.method(globalThis,'fetch',async(url:unknown,options:RequestInit)=>{
  const body=JSON.parse(String(options.body));
  if(String(url).endsWith('/apply-template')){assert.equal(body.add_generation_prompt,true);return Response.json({prompt});}
  assert(String(url).endsWith('/completion'));assert.equal(body.prompt,prompt);
  assert.equal(body.n_predict,128);assert.equal(body.temperature,.1);assert.equal(body.repeat_penalty,1.05);
  assert.equal(body.cache_prompt,true);assert.equal(body.grammar,'fixture grammar');
  assert.deepEqual(body.message_delimiters,[{role:'user',delimiter:'<|im_start|>user\n'},{role:'assistant',delimiter:'<|im_start|>assistant\n'}]);
  generationSignal=options.signal!;
  return new Response('data: '+JSON.stringify({content:'Ready.',timings:{prompt_ms:10,prompt_n:80,cache_n:13939,predicted_n:2,predicted_ms:50}})+'\n');
 });
 const chunks=[];
 for await(const chunk of new LlamaBackend().stream([{role:'system',content:'Complete authored instructions.'},{role:'user',content:'Public question'}],liquidSmall,new AbortController().signal,24576,128,'qwen','fixture grammar'))chunks.push(chunk);
 assert.equal(chunks[0].text,'Ready.');assert.equal((chunks[0].stats as {cache_tokens:number}).cache_tokens,13939);
 assert.equal(generationSignal?.aborted,true);
});

test('LiquidAI rejects a changed template before generation',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({prompt:'Unexpected template'}));
 await assert.rejects(async()=>{for await(const _ of new LlamaBackend().stream([{role:'user',content:'Hello'}],liquidSmall,new AbortController().signal)){}},/template changed/);
});

test('changing phase, time or script command preserves the full fixed prompt prefix',()=>{
 const base='Full user-authored instructions.\n'.repeat(300);
 const state=snapshotSession({elapsedSeconds:0,totalSeconds:1200,scene:'Minimal Dark',intensityPercent:75,activeTriggers:[],lastTrigger:null});
 const warm=buildFixedReplyPrompt(base);
 for(const phase of ['induction','deepening','conditioning','anchor','awakening'] as const){
  const reply=buildReplyPrompt(base,'countdown',true,'Device settings',{...state,phase,elapsedMin:4},'Interrupted playback',true);
  assert.ok(reply.startsWith(warm+'\n\n'));
  assert.ok(reply.startsWith(base));
  assert.ok(reply.includes(`- Phase: ${phase}`));
  assert.ok(reply.indexOf('SESSION STATE')>warm.length);
  assert.ok(!reply.includes('=== SOUND CONTROL ==='));
 }
});

test('warmup and conversation retain the complete prefix across sound and device changes',()=>{
 const base='Full authored persona, collar and strategy.\n'.repeat(300);
 const warm=buildFixedReplyPrompt(base);
 for(const sound of [false,true])for(const device of ['Device control is disabled.','Device control is enabled.']){
  const reply=buildReplyPrompt(base,'Hello.',sound,device,undefined,'',true);
  assert.ok(reply.startsWith(warm+'\n\n'));
  assert.ok(reply.includes(device));
  assert.ok(reply.includes('sound and tick metadata are disabled'));
  assert.ok(!reply.includes('=== SOUND CONTROL ==='));
  assert.ok(reply.includes('Do not include device, sound or tick control markers.'));
 }
});

test('first ordinary audio is delivered while the next HTTP chunk is still pending',async()=>{
 const original=globalThis.fetch;
 let cancelled=false;
 try{
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({audio:'AAAA',text:'Hello.',timestamps:[]})+'\n'));},cancel(){cancelled=true;}}));
  const stream=new Kokoro().speak('Hello.','af_heart',1,new AbortController().signal);
  const first=await Promise.race([stream.next(),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('First audio waited for the next chunk')),200))]);
  assert.equal(first.value?.text,'Hello.');
  await stream.return(undefined);
  assert.equal(cancelled,true);
 }finally{globalThis.fetch=original;}
});

test('conversation speaks a completed greeting before later tokens and retains an opening without a safe boundary',()=>{
 const chat=new TriggerSentenceChunker([],true),script=new TriggerSentenceChunker();
 assert.deepEqual(chat.push('Hello, sweetie. '),['Hello, sweetie.']);
 assert.deepEqual(script.push('Hello, sweetie.'),[]);
 assert.deepEqual(script.push(' [pause:medium] Next'),['Hello, sweetie. [pause:medium]']);
 const words='A complete conversational phrase '.repeat(5);
 const chunks=[...chat.push(words),...chat.flush()];
 assert.equal(chunks.length,1,'Length alone must never split a phrase');
 assert.equal(chunks.join(' '),words.trim());
});

test('native chat explicitly reuses prompt cache and retains prefill measurements',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(_url,options)=>{
   const body=JSON.parse(String(options?.body));assert.equal(body.cache_prompt,true);assert.equal(body.max_tokens,64);
   return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Hello.'}}],timings:{prompt_ms:100,prompt_n:80,cache_n:9000,predicted_n:2,predicted_ms:50}})+'\n');
  };
  const results=[];for await(const result of new LlamaBackend().stream([{role:'user',content:'Hello'}],'fixture',new AbortController().signal,16384,64))results.push(result);
  assert.deepEqual(results[0].stats,{eval_count:2,eval_duration:50000000,prompt_ms:100,prompt_tokens:80,cache_tokens:9000});
 }finally{globalThis.fetch=original;}
});
