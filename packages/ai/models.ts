// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { ollamaSampling,nativeContextForModel,NATIVE_CONTEXT,type SamplingProfile } from '../../config/sampling';
export const communityQwen = 'bambi-qwen35-9b-hauhau:q4_k_m';
export const communityGemma = 'bambi-gemma4-e4b-hauhau:q4_k_m';
export const communityQwen36 = 'bambi-qwen36-35b-hauhau:iq3_m';
export const defiantFable = 'bambi-qwen35-9b-defiant-fable:iq4_xs';
export const roleplayQwen = 'bambi-qwen35-9b-rp:q4_k_m';
export const nativeSamplingModels = [communityQwen, communityQwen36, defiantFable, roleplayQwen];
/** Context capacity follows the authored prompt, independently of speech latency. */
export function modelContext(model:string,promptId:string){
 if(nativeSamplingModels.includes(model))return nativeContextForModel(model);
 return promptId==='bambisleep-classic'?NATIVE_CONTEXT:4096;
}

export function modelLabel(model: string): string {
  if (model === 'cloud:cydonia-24b-v4.3') return 'Cydonia 24B v4.3 · Q5_K_M · Cloud';
  if (model === communityQwen) return 'Qwen3.5 9B · HauhauCS · Q4_K_M';
  if (model === communityGemma) return 'Gemma 4 E4B · HauhauCS · Q4_K_M';
  if (model === communityQwen36) return 'Qwen3.6 35B-A3B · HauhauCS · IQ3_M';
  if (model === defiantFable) return 'Qwen3.5 9B · Defiant Fable NEO · IQ4_XS';
  if (model === roleplayQwen) return 'Qwen3.5 9B · NSFW-RP · Q4_K_M';
  return model.replace('qwen3.5:', 'Qwen3.5 ');
}

export function modelForPerformance(models: string[], quality: boolean): string | undefined {
  const order = quality
    ? [communityQwen, defiantFable, 'qwen3.5:9b', communityGemma, 'qwen3.5:4b']
    : ['qwen3.5:4b', communityGemma, communityQwen, 'qwen3.5:9b'];
  return order.find(model => models.includes(model)) ?? models[0];
}

export function modelSampling(model: string,profile:SamplingProfile='creative') {
  if (model === communityGemma) return { temperature: 1, top_p: .95, top_k: 64 };
  if (nativeSamplingModels.includes(model)) return ollamaSampling(profile);
  return { temperature: .7 };
}
