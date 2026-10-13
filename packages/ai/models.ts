// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { llamaSampling,ollamaSampling,nativeContextForModel,NATIVE_CONTEXT,type SamplingProfile } from '../../config/sampling';
import {catalogModel} from './model-catalog';
export const communityQwen = 'bambi-qwen35-9b-hauhau:q4_k_m';
export const communityQwen4B = 'bambi-qwen35-4b-hauhau:q4_k_m';
export const communityQwen2B = 'bambi-qwen35-2b-hauhau:q4_k_m';
export const liquidSmall = 'bambi-lfm25-1.2b:Q4_K_M';
export const communityQwen4BMtp = 'bambi-qwen35-4b-hauhau-mtp-experiment:q4_k_m';
export const communityQwen4BMtpBaseline = 'bambi-qwen35-4b-hauhau-mtp-baseline:q4_k_m';
export const communityGemma = 'bambi-gemma4-e4b-hauhau:q4_k_m';
export const communityQwen36 = 'bambi-qwen36-35b-hauhau:iq3_m';
export const defiantFable = 'bambi-qwen35-9b-defiant-fable:iq4_xs';
export const roleplayQwen = 'bambi-qwen35-9b-rp:q4_k_m';
/** Ollama's Q4_K_M build of L3-8B-Stheno-v3.2 (8K context). */
export const sthenoV32 = 'fluffy/l3-8b-stheno-v3.2:latest';
/** Ollama's Q4_K_M import of TheDrummer's Anubis Mini 8B v1. */
export const anubisMiniV1 = 'hf.co/TheDrummer/Anubis-Mini-8B-v1-GGUF:Q4_K_M';
export const ANUBIS_CONTEXT=65536;
export const ANUBIS_TRAINING_CONTEXT=131072;
/** Ollama's Q8_0 build of Moophlo's MistralRP-Noromaid 7B. */
export const mistralRpNoromaid7B = 'moophlo/MistralRP-Noromaid-uncensored-Mistral-7B-GGUF:latest';
export const nativeSamplingModels = [communityQwen, communityQwen4B, communityQwen2B, liquidSmall, communityQwen4BMtp, communityQwen4BMtpBaseline, communityQwen36, defiantFable, roleplayQwen, anubisMiniV1];
export function nativeCheckpointModel(model:string){return [communityQwen2B,liquidSmall,communityQwen4B,communityQwen4BMtp,communityQwen4BMtpBaseline].includes(model)||/-9b(?:-|:)/i.test(model);}
/** Context capacity follows the authored prompt, independently of speech latency. */
export function modelContext(model:string,promptId:string){
 if(model===sthenoV32)return 8192;
 if(model===anubisMiniV1)return ANUBIS_CONTEXT;
 if(model===mistralRpNoromaid7B)return NATIVE_CONTEXT;
 if(nativeSamplingModels.includes(model))return nativeContextForModel(model);
 return promptId==='bambisleep-classic'?NATIVE_CONTEXT:4096;
}

export function modelLabel(model: string, labels: Record<string,string> = {}): string {
  if (typeof labels[model] === 'string') return labels[model];
  if (model.startsWith('cloud:')) return 'Remote AI';
  if (model === communityQwen) return 'Qwen3.5 9B · HauhauCS · Q4_K_M';
  if (model === communityQwen4B) return 'Qwen3.5 4B · HauhauCS · Q4_K_M · Experimental';
  if (model === communityQwen2B) return 'Qwen3.5 2B · HauhauCS · Q4_K_M · Experimental';
  if (model === liquidSmall) return 'LFM2.5 1.2B · Liquid AI · Q4_K_M · Experimental';
  if (model === communityQwen4BMtp) return 'Qwen3.5 4B · MTP on · Experimental';
  if (model === communityQwen4BMtpBaseline) return 'Qwen3.5 4B · MTP off · Same export';
  if (model === communityGemma) return 'Gemma 4 E4B · HauhauCS · Q4_K_M';
  if (model === communityQwen36) return 'Qwen3.6 35B-A3B · HauhauCS · IQ3_M';
  if (model === defiantFable) return 'Qwen3.5 9B · Defiant Fable NEO · IQ4_XS';
  if (model === roleplayQwen) return 'Qwen3.5 9B · NSFW-RP · Q4_K_M';
  if (model === sthenoV32) return 'Llama 3.1 8B · Stheno v3.2 · Q4_K_M';
  if (model === anubisMiniV1) return 'Anubis Mini 8B v1 · TheDrummer · Q4_K_M';
  if (model === mistralRpNoromaid7B) return 'MistralRP Noromaid 7B · Moophlo · Q8_0';
  return model.replace('qwen3.5:', 'Qwen3.5 ');
}

export function modelForPerformance(models: string[], quality: boolean): string | undefined {
  const order = quality
    ? [communityQwen, defiantFable, 'qwen3.5:9b', communityGemma, 'qwen3.5:4b']
    : ['qwen3.5:4b', communityGemma, communityQwen, 'qwen3.5:9b'];
  return order.find(model => models.includes(model)) ?? models[0];
}

export function modelSampling(model: string,profile:SamplingProfile='creative') {
  const small=catalogModel(model)?.samplingProfile;
  if(small){const {creativeTemperature,creativeTopP,...baseline}=small;return {...baseline,...(profile==='creative'?{temperature:creativeTemperature,top_p:creativeTopP}:{}),presence_penalty:0,frequency_penalty:0};}
  if (model === communityGemma) return { temperature: 1, top_p: .95, top_k: 64 };
  if (model === sthenoV32) return { temperature: .85, top_p: .95, top_k: 40, min_p: .05, repeat_penalty: 1.05 };
  if (model === anubisMiniV1) return {
    temperature: profile==='creative'?.95:.8, top_p: .95, top_k: 64, min_p: .02,
    repeat_penalty: 1.0, presence_penalty: 0.0,
    dry_multiplier: 0, dry_base: 1.75, dry_allowed_length: 2,
    xtc_probability: 0, xtc_threshold: .1,
  };
  if (model === mistralRpNoromaid7B) return { temperature: .85, top_p: .95, top_k: 40, min_p: .05, repeat_penalty: 1.05 };
  if (nativeSamplingModels.includes(model)) return ollamaSampling(profile);
  return { temperature: .7 };
}

/** Keep model-specific sampling when changing the transport to native llama.cpp. */
export function nativeModelSampling(model:string,profile:SamplingProfile='creative'){
 if([communityQwen2B,liquidSmall].includes(model))return {...llamaSampling('qwen'),...modelSampling(model,profile),dry_multiplier:0,xtc_probability:0};
 return model===anubisMiniV1?modelSampling(model,profile):llamaSampling(profile);
}

export function modelRuntimeInfo(model:string){
 if([communityQwen4BMtp,communityQwen4BMtpBaseline].includes(model))return {context:NATIVE_CONTEXT,cacheType:'f16',flashAttention:true,mtp:model===communityQwen4BMtp,draftTokens:model===communityQwen4BMtp?3:0};
 return model===anubisMiniV1?{context:ANUBIS_CONTEXT,trainingContext:ANUBIS_TRAINING_CONTEXT,cacheType:ANUBIS_CONTEXT>32768?'q4_0':'q8_0',flashAttention:true}:undefined;
}
