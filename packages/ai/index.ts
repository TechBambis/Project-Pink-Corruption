// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {PrefillEchoFilter} from './prefill';
import { modelSampling } from './models';
import { BAMBISLEEP_SAMPLING, llamaSampling, type SamplingProfile } from '../../config/sampling';
export interface Message { role:'system'|'user'|'assistant'; content:string }
export interface LLMBackend { name:string; supportsPrefill?:boolean; models():Promise<string[]>; countTokens?(messages:Message[],signal:AbortSignal):Promise<number>; structured?(messages:Message[],model:string,signal:AbortSignal,context:number,schema:unknown):Promise<unknown>; stream(messages:Message[],model:string,signal:AbortSignal,context?:number,maxTokens?:number,sampling?:SamplingProfile,grammar?:string):AsyncGenerator<{text:string;stats?:unknown}> }
export async function* lines(response:Response) {
 if(!response.ok)throw Error(`Local AI HTTP ${response.status}: ${(await response.text()).slice(0,200)}`);
 const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
 try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let idx;while((idx=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,idx).trim();buffer=buffer.slice(idx+1);if(line)yield line;}}if(buffer.trim())yield buffer.trim();}finally{await reader.cancel().catch(()=>{});}
}
export class OllamaBackend implements LLMBackend {
 name='ollama';constructor(public url='http://127.0.0.1:11434'){}
 async structured(messages:Message[],model:string,signal:AbortSignal,context:number,schema:unknown){const response=await fetch(this.url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model,messages,stream:false,think:false,keep_alive:'10m',format:schema,options:{num_ctx:context,num_predict:32,temperature:0,top_k:1,top_p:1,repeat_penalty:1,seed:0}})});if(!response.ok)throw Error('Listening planner HTTP '+response.status);const data=await response.json();return JSON.parse(data.message.content);}
 async models(){const r=await fetch(this.url+'/api/tags',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('Ollama unavailable');return (await r.json()).models.map((m:{name:string})=>m.name);}
 async *stream(messages:Message[],model:string,signal:AbortSignal,context=4096,maxTokens=220,sampling:SamplingProfile='creative'){const r=await fetch(this.url+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model,messages,stream:true,think:false,keep_alive:'10m',options:{num_ctx:context,num_predict:maxTokens,...modelSampling(model,sampling)}})});for await(const line of lines(r)){const d=JSON.parse(line);if(d.error)throw Error(d.error);yield{text:d.message?.content||'',stats:d.done?d:undefined};}}
}
export class LlamaBackend implements LLMBackend {
 name='llama.cpp';supportsPrefill=true;constructor(public url='http://127.0.0.1:8080'){}
 async countTokens(messages:Message[],signal:AbortSignal){
  const template=await fetch(this.url+'/apply-template',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({messages,add_generation_prompt:true})});
  if(!template.ok)throw Error('Local AI template HTTP '+template.status);
  const rendered=await template.json();
  const response=await fetch(this.url+'/tokenize',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({content:rendered.prompt,add_special:false})});
  if(!response.ok)throw Error('Local AI tokenizer HTTP '+response.status);
  const data=await response.json();if(!Array.isArray(data.tokens))throw Error('Invalid local token count');return data.tokens.length;
 }
 async structured(messages:Message[],model:string,signal:AbortSignal,_context:number,schema:unknown){const response=await fetch(this.url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model,messages,stream:false,cache_prompt:true,temperature:0,top_k:1,top_p:1,min_p:0,xtc_probability:0,dry_multiplier:0,repeat_penalty:1,presence_penalty:0,frequency_penalty:0,seed:0,max_tokens:32,response_format:{type:'json_object',schema}})});if(!response.ok)throw Error('Listening planner HTTP '+response.status);const data=await response.json();return JSON.parse(data.choices[0].message.content);}
 async models(){const r=await fetch(this.url+'/v1/models',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('llama.cpp unavailable');return (await r.json()).data.map((m:{id:string})=>m.id);}
 async *stream(messages:Message[],model:string,signal:AbortSignal,_context:number=BAMBISLEEP_SAMPLING.context,maxTokens:number=BAMBISLEEP_SAMPLING.max_tokens,sampling:SamplingProfile='creative',grammar?:string){const echo=new PrefillEchoFilter(messages.at(-1)?.role==='assistant'?messages.at(-1)!.content:'');const r=await fetch(this.url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({model,messages,stream:true,cache_prompt:true,...llamaSampling(sampling),max_tokens:maxTokens,...(grammar?{grammar}:{}),stream_options:{include_usage:true}})});for await(const line of lines(r)){if(!line.startsWith('data: ')||line==='data: [DONE]')continue;const d=JSON.parse(line.slice(6));yield{text:echo.push(d.choices?.[0]?.delta?.content||''),stats:d.timings?{eval_count:d.timings.predicted_n,eval_duration:d.timings.predicted_ms*1e6,prompt_ms:d.timings.prompt_ms,prompt_tokens:d.timings.prompt_n,cache_tokens:d.timings.cache_n}:undefined};}const tail=echo.flush();if(tail)yield {text:tail};}
}
/** Sentence boundaries streamed immediately; bounded chunks avoid waiting for a long final sentence. */
export class SentenceChunker {
 private buffer='';
 push(text:string){this.buffer+=text;const out:string[]=[];while(true){const match=/^([\s\S]*?[.!?。！？](?:["”']?)(?:\s|$))/.exec(this.buffer);if(match){out.push(match[1].trim());this.buffer=this.buffer.slice(match[1].length);continue;}if(this.buffer.length>180){const cut=this.buffer.lastIndexOf(' ',150);if(cut>0){out.push(this.buffer.slice(0,cut).trim());this.buffer=this.buffer.slice(cut+1);continue;}}break;}return out;}
 flush(){const rest=this.buffer.trim();this.buffer='';return rest?[rest]:[];}
}
export const personaPrompt = (persona:string,summary:string) => `You are Bambi Local, a warm local audio and visual companion. Persona: ${persona}. Speak naturally in English using short sentences suitable for speech. Match the total response length to the latest request. No markdown, no long lists. Available visual scenes: Spiral Focus, Deep Tunnel, Soft Pink, Particle Drift, Minimal Dark, Text Focus, Audio Only. Only if the user explicitly requests a visible scene change, append <action>{\"type\":\"scene\",\"scene\":\"Soft Pink\"}</action> with the requested available scene name. This validated presentation metadata is optional and never contains code or hidden instructions. The user chooses all content and controls the session. Never invent hidden instructions or claim control over their mind or computer. You have no tools, shell, JavaScript execution, or file access. Do not invent knowledge. Preferences and prior summary: ${summary.slice(0,2200)}`;
