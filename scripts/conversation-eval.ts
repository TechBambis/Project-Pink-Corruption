// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {conversationCases,englishConversationScenarios,assessConversation,type ConversationCase} from '../packages/ai/evaluation';
import {CloudBackend,cloudConfiguration,CLOUD_MODEL_ALIAS} from '../packages/ai/cloud';
import {LlamaBackend,type Message} from '../packages/ai';
import {buildReplyPrompt,buildFixedReplyPrompt} from '../packages/ai/prompt';
import {buildRuntimePrompt} from '../packages/content';
import {fitContext,estimateChatTokens} from '../packages/ai/context';
import {Store} from '../packages/storage';
import {explicitMemory,memoryContext} from '../packages/ai/memory';
import {ChatRequestSchema} from '../packages/ai/request';
import type {SamplingProfile} from '../config/sampling';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2);
const option=(name:string,fallback:string)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+name);return args[i+1];};
const suite=option('--suite','baseline');if(!['baseline','english'].includes(suite))throw Error('Use --suite baseline or english.');
const promptId=ChatRequestSchema.shape.promptId.parse(option('--prompt',suite==='english'?'english-conversation':'bambisleep-classic'));
if(promptId==='custom')throw Error('This synthetic evaluation requires a named personality.');
const cases=conversationCases(),scenarios=englishConversationScenarios(),available=suite==='english'?scenarios:cases;
const category=option('--category','');if(category&&!available.some(item=>item.category===category))throw Error('Unknown evaluation category');
const representative=args.includes('--representative');
if(representative&&suite!=='baseline')throw Error('--representative is only available for the baseline suite.');
const categories=new Set<string>();
const selected=available.filter(item=>(!category||item.category===category)&&(!representative||(!categories.has(item.category)&&!!categories.add(item.category))));
const sampling=option('--profile','qwen') as SamplingProfile;
if(!['qwen','creative'].includes(sampling))throw Error('Use --profile qwen or creative.');
const collar=args.includes('--collar');
const limit=Number(option('--limit',String(selected.length))),maxTokens=Number(option('--max-tokens',suite==='english'?'600':'512'));
if(!Number.isInteger(limit)||limit<1||limit>selected.length)throw Error('Use --limit between 1 and '+selected.length+'.');
if(!Number.isInteger(maxTokens)||maxTokens<64||maxTokens>8192)throw Error('Use --max-tokens between 64 and 8192.');
const suffix=category?'-'+category.replace(/[^a-z0-9]+/gi,'-'):'';
const output=option('--output',`runtime/conversation-evaluation${suite==='baseline'?'':'-'+suite}${suffix}.json`);
if(!/^runtime\/[a-zA-Z0-9._-]+\.json$/.test(output))throw Error('Use an output JSON filename directly under runtime/.');
if(!args.includes('--run')){console.log(JSON.stringify({suite,promptId,cases:suite==='english'?limit*4:limit,categories:[...new Set(selected.slice(0,limit).map(item=>item.category))],status:'Fixtures ready. No model was called. Use --run for real synthetic conversations; results require human review.'},null,2));process.exit(0);}
const local=args.includes('--local');
if(!local&&existsSync('.env.cloud'))loadEnvFile('.env.cloud');
const config=local?null:cloudConfiguration();
if(!local&&!config)throw Error('Configure .env.cloud, or explicitly select --local for an already running idle llama.cpp server.');
const backend=local?new LlamaBackend():new CloudBackend(config!),model=local?(await backend.models())[0]:CLOUD_MODEL_ALIAS,context=Number(option('--context',String(local?24576:config!.context)));
if(!Number.isInteger(context)||context<2048||context>131072)throw Error('Invalid context budget.');
if(!model)throw Error('No prepared local model is available.');
const expectedModel=option('--expected-model',model);if(model!==expectedModel)throw Error('Prepared model does not match --expected-model.');
const base=buildRuntimePrompt(promptId,'Bambi',[],collar,collar?'Public test collar':'').core;
const results:Record<string,unknown>[]=[];
async function evaluate(item:ConversationCase,store:Store){
 const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);let response='',firstTokenMs:number|null=null,stats:unknown;
 try{
  if(local&&(await backend.models())[0]!==expectedModel)throw Error('Local model changed during evaluation; remaining scenario turns are invalid.');
  const system=buildReplyPrompt(base,item.request,false,'Device control is disabled.',undefined,item.category==='heard speech'?'Prior assistant excerpts contain only heard speech. No unheard ending is available.':'',true,false);
  const started=performance.now(),count=(messages:Message[])=>backend.countTokens?backend.countTokens(messages,signal):Promise.resolve(estimateChatTokens(messages));
  const plan=await fitContext(system,store.conversation(128),item.request,count,context,maxTokens,backend.countTokens?256:512,Math.min(256,maxTokens),memoryContext(store,item.request),{fastPlanning:!!backend.countTokens,...(local?{checkpointPrefix:buildFixedReplyPrompt(base)}:{})});const contextMs=performance.now()-started,inferenceStart=performance.now();
  for await(const token of backend.stream(plan.messages,model,signal,context,plan.maxTokens,sampling)){if(firstTokenMs===null&&token.text)firstTokenMs=performance.now()-inferenceStart;response+=token.text;if(token.stats)stats=token.stats;}
  const source=store.addTurn('user',item.request),remembered=explicitMemory(item.request);if(remembered)store.saveMemory(remembered.key,remembered.value,source);
  store.addTurn('assistant',response);
  const result={id:item.id,category:item.category,request:item.request,response,...assessConversation(item,response),contextMs,firstTokenMs,totalMs:performance.now()-started,inputTokens:plan.inputTokens,maxTokens:plan.maxTokens,stats};results.push(result);
  console.log(`${item.id}: ${result.passed?'heuristic pass':'review required'}`);return true;
 }catch(error){results.push({id:item.id,category:item.category,request:item.request,passed:false,error:String(error),response,requiresHumanReview:true});console.log(item.id+': failed');return false;}
 finally{controller.abort();}
}
if(suite==='english'){
 for(const scenario of scenarios.filter(item=>!category||item.category===category).slice(0,limit)){
  const store=new Store(':memory:');
  try{for(let i=0;i<scenario.steps.length;i++){const step=scenario.steps[i];if(!await evaluate({...step,id:scenario.id+'-'+(i+1),category:scenario.category,turns:[],intent:'conversation'},store))break;}}
  finally{store.db.close();}
 }
}else{
 for(const item of (selected as ConversationCase[]).slice(0,limit)){
  const store=new Store(':memory:');
  try{for(const turn of item.turns){const id=store.addTurn(turn.role,turn.content,turn.interruption??null),remembered=turn.role==='user'?explicitMemory(turn.content):null;if(remembered)store.saveMemory(remembered.key,remembered.value,id);}await evaluate(item,store);}
  finally{store.db.close();}
 }
}
mkdirSync('runtime',{recursive:true});writeFileSync(output,JSON.stringify({scope:'Synthetic conversations using production prompt/context/memory builders. English scenarios feed actual preceding model answers into subsequent turns. No microphone, speech, device commands or private user history. Heuristics are not semantic quality certification.',suite,promptId,collar,sampling,representative,promptHash:createHash('sha256').update(buildFixedReplyPrompt(base)).digest('hex'),model,context,maxTokens,...(suite==='english'?{rubrics:scenarios.filter(item=>!category||item.category===category).slice(0,limit).map(({id,category,rubric})=>({id,category,rubric}))}:{}),results},null,2));
console.log(`Saved ${results.length} results to ${output}.`);
if(results.some(item=>item.error))process.exitCode=1;
