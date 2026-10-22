// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { LLMBackend, Message, StructuredOptions } from './index';
import { lines, structuredOptions } from './index';
import {parseStructuredOutput} from './structured';
import { z } from 'zod';
import type { SamplingProfile } from '../../config/sampling';
import { PrefillEchoFilter } from './prefill';

// Keep the persisted slot ID stable; the UI displays the configured model name.
export const CLOUD_MODEL_ALIAS = 'cloud:cydonia-24b-v4.3';
export const CYDONIA_SAMPLING = {temperature:.7,creativeTemperature:1,topP:.95,topK:40,minP:.05,repeatPenalty:1} as const;
const samplingConfiguration=z.object({
  temperature:z.coerce.number().min(0).max(2).default(CYDONIA_SAMPLING.temperature),
  creativeTemperature:z.coerce.number().min(0).max(2).default(CYDONIA_SAMPLING.creativeTemperature),
  topP:z.coerce.number().min(.01).max(1).default(CYDONIA_SAMPLING.topP),
  topK:z.coerce.number().int().min(0).max(1000).default(CYDONIA_SAMPLING.topK),
  minP:z.coerce.number().min(0).max(1).default(CYDONIA_SAMPLING.minP),
  repeatPenalty:z.coerce.number().min(.1).max(2).default(CYDONIA_SAMPLING.repeatPenalty),
});
const configuration = z.object({
  url: z.string().url().refine(value => /^https?:\/\//.test(value) && !new URL(value).username && !new URL(value).password && !new URL(value).search, 'Use an HTTP(S) API base URL without embedded credentials or query parameters'),
  model: z.string().min(1).max(200), key: z.string().default(''), gatewayKey: z.string().optional(),
  context: z.coerce.number().int().min(4096).max(131072).default(32768),
  kind: z.enum(['llama.cpp', 'openai-compatible', 'ollama']).default('llama.cpp'),
  timeoutMs: z.coerce.number().int().min(5000).max(600000).default(300000),
  sampling:samplingConfiguration.optional(),
  tokenizerUrl:z.string().url().refine(value=>/^https?:\/\//.test(value)&&!new URL(value).username&&!new URL(value).password&&!new URL(value).search,'Use a private tokenizer URL without embedded credentials').optional(),
});
export type CloudConfiguration = z.infer<typeof configuration>;
export function cloudConfiguration(env: NodeJS.ProcessEnv = process.env): CloudConfiguration | null {
  if (!env.BAMBI_CLOUD_URL) return null;
  return configuration.parse({ url: env.BAMBI_CLOUD_URL.replace(/\/$/, ''), model: env.BAMBI_CLOUD_MODEL ?? 'Cydonia-24B-v4.3', key: env.BAMBI_CLOUD_API_KEY, gatewayKey: env.BAMBI_CLOUD_GATEWAY_KEY,
    context: env.BAMBI_CLOUD_CONTEXT, kind: env.BAMBI_CLOUD_KIND, timeoutMs: env.BAMBI_CLOUD_TIMEOUT_MS,
    sampling:{temperature:env.BAMBI_CLOUD_TEMPERATURE?.trim()||undefined,
      creativeTemperature:env.BAMBI_CLOUD_CREATIVE_TEMPERATURE?.trim()||undefined,
      topP:env.BAMBI_CLOUD_TOP_P?.trim()||undefined,topK:env.BAMBI_CLOUD_TOP_K?.trim()||undefined,
      minP:env.BAMBI_CLOUD_MIN_P?.trim()||undefined,repeatPenalty:env.BAMBI_CLOUD_REPEAT_PENALTY?.trim()||undefined},
    tokenizerUrl:env.BAMBI_CLOUD_TOKENIZER_URL?.trim()||undefined,
  });
}
export function cloudSampling(config:CloudConfiguration,profile:SamplingProfile='qwen'){
  const s=config.sampling??CYDONIA_SAMPLING;
  return {temperature:profile==='creative'?s.creativeTemperature:s.temperature,top_p:s.topP,
    ...(config.kind==='llama.cpp'||config.kind==='ollama'?{top_k:s.topK,min_p:s.minP,repeat_penalty:s.repeatPenalty,...(config.kind==='llama.cpp'?{dry_multiplier:0,xtc_probability:0}:{})}:{}),
  };
}
/** A fixed, server-configured endpoint. Secrets and arbitrary endpoint selection never reach clients. */
export class CloudBackend implements LLMBackend {
  name = 'cloud';
  supportsPrefill = false;
  countTokens?: (messages: Message[], signal: AbortSignal) => Promise<number>;
  constructor(readonly config: CloudConfiguration,private access?:{signal:()=>AbortSignal}) {
    if (config.kind === 'llama.cpp') {
      this.supportsPrefill = true;
      this.countTokens = async (messages, signal) => {
        if(this.config.tokenizerUrl){
          const response=await this.request('/token-count',{messages,model:this.config.model},signal,this.config.tokenizerUrl);
          const data=await response.json();
          if(data.model!==this.config.model||!Number.isInteger(data.count)||data.count<0)throw Error('Cloud token counter returned an invalid count');
          return data.count as number;
        }
        const rendered = await this.request('/apply-template', { messages, add_generation_prompt: true }, signal);
        const { prompt } = await rendered.json();
        if (typeof prompt !== 'string') throw Error('Cloud chat template returned no prompt');
        const response = await this.request('/tokenize', { content: prompt, add_special: false }, signal);
        const { tokens } = await response.json();
        if (!Array.isArray(tokens)) throw Error('Cloud tokenizer returned no token count');
        return tokens.length;
      };
    }
  }
  private headers(contentType = false): Record<string, string> {
    return { ...(contentType ? { 'Content-Type': 'application/json' } : {}),
      ...(this.config.key ? { Authorization: 'Bearer ' + this.config.key } : {}),
      ...(this.config.gatewayKey ? { 'Salad-Api-Key': this.config.gatewayKey } : {}) };
  }
  private async request(path: string, body: unknown, signal: AbortSignal,endpoint=this.config.url) {
    const accessSignal=this.access?.signal();
    const root = endpoint.replace(/\/v1$/, '').replace(/\/$/,'');
    let response: Response;
    try {
      response = await fetch(root + path, { method: 'POST', headers: this.headers(true), body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs),...(accessSignal?[accessSignal]:[])]) });
    } catch (error) {
      if (signal.aborted) throw error;
      throw Error('Cloud inference is unavailable. Check the inference server and reconnect the cloud connection.');
    }
    // Provider bodies may contain credentials or private prompts; never echo them to the browser.
    if (!response.ok) { await response.body?.cancel(); throw Error(`Cloud inference HTTP ${response.status}`); }
    return response;
  }
  async models() {
    const accessSignal=this.access?.signal();
    const response = await fetch(this.config.url.replace(/\/v1$/, '') + (this.config.kind === 'ollama' ? '/api/tags' : '/v1/models'), {
      headers: this.headers(), signal: AbortSignal.any([AbortSignal.timeout(3000),...(accessSignal?[accessSignal]:[])]) });
    if (!response.ok) throw Error('Cloud inference is unavailable');
    const data = await response.json();
    const available = this.config.kind === 'ollama' ? data.models : data.data;
    if (!Array.isArray(available) || !available.some(model => (this.config.kind === 'ollama' ? model?.name : model?.id) === this.config.model)) throw Error('Configured cloud model is not available');
    return [CLOUD_MODEL_ALIAS];
  }
  async structured(messages: Message[], _model: string, signal: AbortSignal, _context: number, schema: unknown, options?:StructuredOptions) {
    const budget=structuredOptions({maxTokens:64,...options});
    if (this.config.kind === 'ollama') {
      const response = await this.request('/api/chat', {model:this.config.model,messages,stream:false,think:false,format:schema,
        options:{num_ctx:this.config.context,num_predict:budget.maxTokens,temperature:budget.temperature,top_k:budget.temperature?40:1,top_p:1,repeat_penalty:1,...(budget.temperature?{}:{seed:0})}}, signal);
      const data = await response.json();
      if(data.error)throw Error('Cloud generation failed');
      return parseStructuredOutput(data.message?.content,data.done_reason);
    }
    const response = await this.request('/v1/chat/completions', { model: this.config.model, messages, stream: false,
      temperature: budget.temperature, max_tokens: budget.maxTokens, response_format: this.config.kind === 'llama.cpp' ? { type: 'json_object', schema } : { type: 'json_object' } }, signal);
    const data = await response.json();
    return parseStructuredOutput(data.choices?.[0]?.message?.content,data.choices?.[0]?.finish_reason);
  }
  async *stream(messages: Message[], _model: string, signal: AbortSignal, _context = this.config.context, maxTokens = 2048, sampling: SamplingProfile = 'qwen') {
    const echo = new PrefillEchoFilter(messages.at(-1)?.role === 'assistant' ? messages.at(-1)!.content : '');
    const requestController = new AbortController();
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    try {
      if (this.config.kind === 'ollama') {
        const response = await this.request('/api/chat', {model:this.config.model,messages,stream:true,think:false,
          options:{num_ctx:this.config.context,num_predict:maxTokens,...cloudSampling(this.config,sampling)}}, requestSignal);
        for await(const line of lines(response)){
          let data;
          try { data=JSON.parse(line); }
          catch { throw Error('Cloud streaming response is invalid'); }
          if(data.error)throw Error('Cloud generation failed');
          yield {text:typeof data.message?.content==='string'?data.message.content:'',stats:data.done?{
            eval_count:data.eval_count,eval_duration:data.eval_duration,prompt_ms:typeof data.prompt_eval_duration==='number'?data.prompt_eval_duration/1e6:undefined,
            prompt_tokens:data.prompt_eval_count,cache_tokens:data.prompt_eval_cached_count,
          }:undefined};
        }
        return;
      }
      const response = await this.request('/v1/chat/completions', { model: this.config.model, messages, stream: true,
        ...cloudSampling(this.config,sampling),max_tokens: maxTokens,
        ...(this.config.kind === 'llama.cpp' ? { cache_prompt: true } : {}),
        stream_options: { include_usage: true } }, requestSignal);
      for await (const line of lines(response)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') break;
        const data = JSON.parse(payload);
        if (data.error) throw Error('Cloud generation failed');
        const text = data.choices?.[0]?.delta?.content;
        yield { text: echo.push(typeof text === 'string' ? text : ''), stats: data.timings ? {
          eval_count: data.timings.predicted_n, eval_duration: data.timings.predicted_ms * 1e6,
          prompt_ms: data.timings.prompt_ms, prompt_tokens: data.timings.prompt_n, cache_tokens: data.timings.cache_n,
        } : undefined };
      }
      const tail=echo.flush();if(tail)yield {text:tail};
    } finally { requestController.abort(); }
  }
}
