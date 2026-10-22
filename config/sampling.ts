// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export const NATIVE_CONTEXT=24576;
/** Qualified context profiles retain the complete persona, history and output. */
export function nativeContextForModel(model:string){return /^bambi-qwen35-(?:2b|4b)-hauhau(?:-mtp-(?:experiment|baseline))?:q4_k_m$/.test(model)||model==='bambi-lfm25-1.2b:Q4_K_M'||model==='bambi-qwen36-35b-hauhau:iq3_m'||/-9b(?:-|:)/i.test(model)?NATIVE_CONTEXT:16384;}
/** User-requested comparison profile; these values are experimental, not model defaults. */
export const BAMBISLEEP_SAMPLING = {
  temperature: 1.0, top_p: .95, top_k: 50, min_p: .05,
  repetition_penalty: 1.0, presence_penalty: 0.0, frequency_penalty: 0.0,
  dry_multiplier: .8, dry_base: 1.75, dry_allowed_length: 2,
  xtc_probability: .4, xtc_threshold: .1,
  max_tokens: 8192, context: NATIVE_CONTEXT,
} as const;

export type SamplingProfile='qwen'|'creative';
/** Publisher's non-thinking baseline; explicitly disable inherited experimental samplers. */
export const QWEN_SAMPLING={...BAMBISLEEP_SAMPLING,temperature:.7,top_p:.8,top_k:20,min_p:0,dry_multiplier:0,xtc_probability:0} as const;
export function samplingProfile(profile:SamplingProfile='creative'){return profile==='qwen'?QWEN_SAMPLING:BAMBISLEEP_SAMPLING;}

export function ollamaSampling(profile:SamplingProfile='creative') {
  const s = samplingProfile(profile);
  return { temperature: s.temperature, top_p: s.top_p, top_k: s.top_k, min_p: s.min_p,
    repeat_penalty: s.repetition_penalty, presence_penalty: s.presence_penalty, frequency_penalty: s.frequency_penalty };
}
export function llamaSampling(profile:SamplingProfile='creative') {
  const { repetition_penalty, context: _context, ...sampling } = samplingProfile(profile);
  return { ...sampling, repeat_penalty: repetition_penalty };
}
