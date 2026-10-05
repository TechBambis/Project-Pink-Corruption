// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {conversationCases,assessConversation} from '../packages/ai/evaluation';
import {CloudBackend,cloudConfiguration,CLOUD_MODEL_ALIAS} from '../packages/ai/cloud';
import {LlamaBackend,type Message} from '../packages/ai';
import {buildReplyPrompt} from '../packages/ai/prompt';
import {buildRuntimePrompt} from '../packages/content';
import {fitContext,estimateChatTokens} from '../packages/ai/context';
import {Store} from '../packages/storage';
import {explicitMemory,memoryContext} from '../packages/ai/memory';
const args=process.argv.slice(2),cases=conversationCases();
if(!args.includes('--run')){console.log(JSON.stringify({cases:cases.length,categories:[...new Set(cases.map(item=>item.category))],status:'Fixtures ready. No model was called. Use --run for a real baseline; results require human review.'},null,2));process.exit(0);}
if(existsSync('.env.cloud'))loadEnvFile('.env.cloud');
const local=args.includes('--local'),config=cloudConfiguration();
if(!local&&!config)throw Error('Configure .env.cloud, or explicitly select --local for an already running llama.cpp server.');
const backend=local?new LlamaBackend():new CloudBackend(config!),model=local?(await backend.models())[0]:CLOUD_MODEL_ALIAS,context=local?24576:config!.context;
const limitIndex=args.indexOf('--limit'),limit=limitIndex>=0?Number(args[limitIndex+1]):cases.length;if(!Number.isInteger(limit)||limit<1||limit>cases.length)throw Error('Use --limit between 1 and 48.');
const categoryIndex=args.indexOf('--category'),category=categoryIndex>=0?args[categoryIndex+1]:undefined;
if(category&&!cases.some(item=>item.category===category))throw Error('Unknown evaluation category');
const results=[];
for(const item of cases.filter(item=>!category||item.category===category).slice(0,limit)){
 const store=new Store(':memory:');const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);let response='',firstTokenMs:number|null=null;
 try{
  for(const turn of item.turns){const id=store.addTurn(turn.role,turn.content,turn.interruption??null),remembered=turn.role==='user'?explicitMemory(turn.content):null;if(remembered)store.saveMemory(remembered.key,remembered.value,id);}
  const base=buildRuntimePrompt('bambisleep-classic','Bambi',[],false,'').core;
  const system=buildReplyPrompt(base,item.request,false,'Device control is disabled.',undefined,item.category==='heard speech'?'Prior assistant excerpts contain only heard speech. No unheard ending is available.':'',true,false);
  const started=performance.now(),count=(messages:Message[])=>backend.countTokens?backend.countTokens(messages,signal):Promise.resolve(estimateChatTokens(messages));
  const plan=await fitContext(system,store.conversation(128),item.request,count,context,512,backend.countTokens?256:512,256,memoryContext(store,item.request),{fastPlanning:!local});const contextMs=performance.now()-started,inferenceStart=performance.now();
  for await(const token of backend.stream(plan.messages,model,signal,context,plan.maxTokens,'qwen')){if(firstTokenMs===null&&token.text)firstTokenMs=performance.now()-inferenceStart;response+=token.text;}
  results.push({id:item.id,category:item.category,response,...assessConversation(item,response),contextMs,firstTokenMs,totalMs:performance.now()-started,inputTokens:plan.inputTokens});
 }catch(error){results.push({id:item.id,category:item.category,passed:false,error:String(error),response,requiresHumanReview:true});}
 finally{controller.abort();store.db.close();}
 console.log(`${item.id}: ${results.at(-1)!.passed?'heuristic pass':'review required'}`);
}
const output=category?'runtime/conversation-evaluation-'+category.replace(/[^a-z0-9]+/gi,'-')+'.json':'runtime/conversation-evaluation.json';
mkdirSync('runtime',{recursive:true});writeFileSync(output,JSON.stringify({scope:'Synthetic multi-turn fixtures using production prompt/context/memory builders. No microphone, speech, device commands or private user history. Heuristics are not a semantic quality certification.',model,context,results},null,2));
console.log(`Saved ${results.length} results to ${output}.`);
