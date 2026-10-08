// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {anubisMiniV1,ANUBIS_CONTEXT,ANUBIS_TRAINING_CONTEXT,nativeSamplingModels,nativeModelSampling,modelRuntimeInfo} from '../packages/ai/models';
import {modelConnection} from '../packages/ai/request';
import {LlamaBackend} from '../packages/ai';
import {buildRuntimePrompt} from '../packages/content';
import {buildSituationalBase} from '../packages/content/situational';
import {buildFixedReplyPrompt,buildReplyPrompt} from '../packages/ai/prompt';
import {snapshotSession,buildSessionState,SessionStateSchema} from '../packages/ai/session-state';

test('Anubis has one consistent pinned model, native transport and explicit context capacity',()=>{
 const pin=JSON.parse(readFileSync(new URL('../docs/anubis-model.json',import.meta.url),'utf8'));
 assert.equal(pin.alias,anubisMiniV1);assert.equal(pin.context,ANUBIS_CONTEXT);assert.equal(pin.training_context,ANUBIS_TRAINING_CONTEXT);
 assert.ok(pin.allowed_contexts.includes(pin.context));assert.ok(nativeSamplingModels.includes(anubisMiniV1));
 assert.deepEqual(modelConnection(anubisMiniV1,'custom'),{backend:'llama.cpp',context:ANUBIS_CONTEXT});
 const sampler=nativeModelSampling(anubisMiniV1,'creative');
 for(const [key,value] of Object.entries(pin.runtime.sampling))assert.equal(sampler[key as keyof typeof sampler],value,`CLI and request samplers diverged: ${key}`);
 assert.equal(modelRuntimeInfo(anubisMiniV1)?.context,pin.context);
});

test('complete authored source and character survive situational conversation in every phase',()=>{
 const selection={promptId:'bambisleep-classic' as const,persona:'Focused fictional guide',username:'Listener',selectedTriggers:['BAMBI SLEEP'],collar:true,collarName:'Chosen label'};
 const authored=buildRuntimePrompt(selection.promptId,selection.username,selection.selectedTriggers,true,selection.collarName).core;
 const base=buildSituationalBase(selection,authored),fixed=buildFixedReplyPrompt(base,'situational');
 for(const phase of ['induction','deepening','conditioning','anchor','awakening'] as const){
  const state={...snapshotSession({elapsedSeconds:0,totalSeconds:3600,scene:'Soft Pink',intensityPercent:100,activeTriggers:selection.selectedTriggers,lastTrigger:null}),phase,deliveryIntensityPercent:30};
  const system=buildReplyPrompt(base,'Continue the chosen session.',false,'',state,'',false,true,'situational');
  assert.ok(system.startsWith(fixed));assert.ok(system.includes(authored));
  assert.match(buildSessionState(SessionStateSchema.parse(state)),/Intensity: 5\/5 \(100\/100/);
  assert.match(buildSessionState(state),/audiovisual envelope: 30%/);
 }
});

test('native Anubis inference sends its sampler and complete system prompt, without Qwen experimental samplers',async()=>{
 let request:any;
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  request=JSON.parse(body);res.setHeader('Content-Type','text/event-stream');
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'[turn:respond] Four.'}}]})+'\n\ndata: [DONE]\n\n');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const port=(server.address() as {port:number}).port,backend=new LlamaBackend(`http://127.0.0.1:${port}`),system='Complete selected prompt. Latest corrections take precedence.';
  let text='';for await(const chunk of backend.stream([{role:'system',content:system},{role:'user',content:'Two plus two?'}],anubisMiniV1,new AbortController().signal,ANUBIS_CONTEXT,96,'creative'))text+=chunk.text;
  assert.equal(text,'[turn:respond] Four.');assert.equal(request.messages[0].content,system);
  assert.equal(request.model,anubisMiniV1);assert.equal(request.cache_prompt,true);assert.equal(request.max_tokens,96);
  assert.equal(request.temperature,.95);assert.equal(request.top_k,64);assert.equal(request.dry_multiplier,0);assert.equal(request.xtc_probability,0);
 }finally{server.close();await once(server,'close');}
});
