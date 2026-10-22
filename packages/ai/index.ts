// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {PrefillEchoFilter} from './prefill';
import {parseStructuredOutput} from './structured';
import { modelSampling,nativeModelSampling,liquidSmall } from './models';
import { BAMBISLEEP_SAMPLING, type SamplingProfile } from '../../config/sampling';
import type {Message,StructuredOptions,LLMBackend} from './contracts';
export type {Message,StructuredOptions,LLMBackend} from './contracts';
export function structuredOptions(options:StructuredOptions={}) {const {maxTokens=32,temperature=0}=options;if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>4096||!Number.isFinite(temperature)||temperature<0||temperature>1)throw Error('Invalid structured generation budget');return {maxTokens,temperature};}
export async function* lines(response:Response) {
 if(!response.ok)throw Error(`Local AI HTTP ${response.status}: ${(await response.text()).slice(0,200)}`);
 const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
 try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let idx;while((idx=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,idx).trim();buffer=buffer.slice(idx+1);if(line)yield line;}}if(buffer.trim())yield buffer.trim();}finally{await reader.cancel().catch(()=>{});}
}
export class OllamaBackend implements LLMBackend {
 name='ollama';supportsTurnGrammar=false;constructor(public url='http://127.0.0.1:11434'){}
 async structured(messages:Message[],model:string,signal:AbortSignal,context:number,schema:unknown,options?:StructuredOptions){const budget=structuredOptions(options);const response=await fetch(this.url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model,messages,stream:false,think:false,keep_alive:'10m',format:schema,options:{num_ctx:context,num_predict:budget.maxTokens,temperature:budget.temperature,top_k:budget.temperature?40:1,top_p:1,repeat_penalty:1,...(budget.temperature?{}:{seed:0})}})});if(!response.ok)throw Error('Structured planner HTTP '+response.status);const data=await response.json();return parseStructuredOutput(data.message?.content,data.done_reason);}
 async models(){const r=await fetch(this.url+'/api/tags',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('Ollama unavailable');return (await r.json()).models.map((m:{name:string})=>m.name);}
 async *stream(messages:Message[],model:string,signal:AbortSignal,context=4096,maxTokens=220,sampling:SamplingProfile='creative'){
  const requestController=new AbortController(),requestSignal=AbortSignal.any([signal,requestController.signal]);
  try{
   const r=await fetch(this.url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:requestSignal,body:JSON.stringify({model,messages,stream:true,think:false,keep_alive:'10m',options:{num_ctx:context,num_predict:maxTokens,...modelSampling(model,sampling)}})});
   for await(const line of lines(r)){const d=JSON.parse(line);if(d.error)throw Error(d.error);yield{text:d.message?.content||'',stats:d.done?d:undefined};}
  }finally{requestController.abort();}
 }
}
export class LlamaBackend implements LLMBackend {
 name='llama.cpp';supportsPrefill=true;supportsTurnGrammar=true;constructor(public url=process.env.BAMBI_LLM_URL||'http://127.0.0.1:8080'){}
 // Native HTTP servers retire keep-alive sockets during long evaluations.
 // Each local request owns its connection; SSE remains open until consumed
 // or cancelled, and the next request cannot reuse a retiring socket.
 private headers(){return {'Content-Type':'application/json',Connection:'close',...(process.env.BAMBI_DESKTOP_ALPHA==='1'?{Authorization:'Bearer '+process.env.BAMBI_LLM_TOKEN}:{} )};}
 private async renderTemplate(messages:Message[],signal:AbortSignal){
  const response=await fetch(this.url+'/apply-template',{method:'POST',headers:this.headers(),signal,body:JSON.stringify({messages,add_generation_prompt:true})});
  if(!response.ok)throw Error('Local AI template HTTP '+response.status);
  const rendered=await response.json();if(typeof rendered.prompt!=='string')throw Error('Invalid local chat template');return rendered.prompt;
 }
 async countTokens(messages:Message[],signal:AbortSignal){
  const prompt=await this.renderTemplate(messages,signal);
  const response=await fetch(this.url+'/tokenize',{method:'POST',headers:this.headers(),signal,body:JSON.stringify({content:prompt,add_special:false})});
  if(!response.ok)throw Error('Local AI tokenizer HTTP '+response.status);
  const data=await response.json();if(!Array.isArray(data.tokens))throw Error('Invalid local token count');return data.tokens.length;
 }
 async structured(messages:Message[],model:string,signal:AbortSignal,_context:number,schema:unknown,options?:StructuredOptions){const budget=structuredOptions(options);const response=await fetch(this.url+'/v1/chat/completions',{method:'POST',headers:this.headers(),signal,body:JSON.stringify({model,messages,stream:false,cache_prompt:true,temperature:budget.temperature,top_k:budget.temperature?40:1,top_p:1,min_p:0,xtc_probability:0,dry_multiplier:0,repeat_penalty:1,presence_penalty:0,frequency_penalty:0,...(budget.temperature?{}:{seed:0}),max_tokens:budget.maxTokens,response_format:{type:'json_object',schema}})});if(!response.ok)throw Error('Structured planner HTTP '+response.status);const data=await response.json();return parseStructuredOutput(data.choices?.[0]?.message?.content,data.choices?.[0]?.finish_reason);}
 async models(){const r=await fetch(this.url+'/v1/models',{headers:this.headers(),signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('llama.cpp unavailable');return (await r.json()).data.map((m:{id:string})=>m.id);}
 async *stream(messages:Message[],model:string,signal:AbortSignal,_context:number=BAMBISLEEP_SAMPLING.context,maxTokens:number=BAMBISLEEP_SAMPLING.max_tokens,sampling:SamplingProfile='creative',grammar?:string){
  const echo=new PrefillEchoFilter(messages.at(-1)?.role==='assistant'?messages.at(-1)!.content:'');
  const requestController=new AbortController(),requestSignal=AbortSignal.any([signal,requestController.signal]);
  try{
   // The pinned runner's specialized LFM template omits user-message
   // checkpoint delimiters (llama.cpp 6f767fe96/common/chat.cpp). Render its
   // own template unchanged, then supply those delimiters to /completion.
   // This keeps recurrent prefix reuse; no authored instruction is removed.
   const completion=model===liquidSmall;
   let payload:Record<string,unknown>;
   if(completion){
    const prompt=await this.renderTemplate(messages,requestSignal);
    if(!prompt.includes('<|im_start|>user\n')||!prompt.endsWith('<|im_start|>assistant\n'))throw Error('The pinned LiquidAI chat template changed.');
    payload={prompt,n_predict:maxTokens,message_delimiters:[{role:'user',delimiter:'<|im_start|>user\n'},{role:'assistant',delimiter:'<|im_start|>assistant\n'}]};
   }else payload={model,messages,max_tokens:maxTokens,stream_options:{include_usage:true}};
   const r=await fetch(this.url+(completion?'/completion':'/v1/chat/completions'),{method:'POST',headers:this.headers(),signal:requestSignal,body:JSON.stringify({stream:true,cache_prompt:true,...nativeModelSampling(model,sampling),...payload,...(grammar?{grammar}:{})})});
   for await(const line of lines(r)){if(!line.startsWith('data: ')||line==='data: [DONE]')continue;const d=JSON.parse(line.slice(6));yield{text:echo.push(completion?d.content||'':d.choices?.[0]?.delta?.content||''),stats:d.timings?{eval_count:d.timings.predicted_n,eval_duration:d.timings.predicted_ms*1e6,prompt_ms:d.timings.prompt_ms,prompt_tokens:d.timings.prompt_n,cache_tokens:d.timings.cache_n}:undefined};}
   const tail=echo.flush();if(tail)yield {text:tail};
  }finally{requestController.abort();}
 }
}
/** Sentence boundaries streamed immediately; bounded chunks avoid waiting for a long final sentence. */
export class SentenceChunker {
 private buffer='';
 push(text:string){this.buffer+=text;const out:string[]=[];while(true){const match=/^([\s\S]*?[.!?。！？](?:["”']?)(?:\s|$))/.exec(this.buffer);if(match){out.push(match[1].trim());this.buffer=this.buffer.slice(match[1].length);continue;}if(this.buffer.length>180){const cut=this.buffer.lastIndexOf(' ',150);if(cut>0){out.push(this.buffer.slice(0,cut).trim());this.buffer=this.buffer.slice(cut+1);continue;}}break;}return out;}
 flush(){const rest=this.buffer.trim();this.buffer='';return rest?[rest]:[];}
}
export {personaPrompt} from './persona';
