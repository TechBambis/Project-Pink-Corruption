// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import type {HardwareProfile} from '../hardware';

const MiB=2**20,GiB=2**30;
export type ModelMemoryProfile={kvBytesPerToken:number;recurrentStateMiB:number;weightsOverheadRatio:number;promptCacheMinimumMiB?:number;minimumCheckpoints?:number;compactBatchSize?:number;compactMicroBatchSize?:number};
export type ResourcePlan={mode:'compact'|'balanced'|'roomy';context:number;promptCacheMiB:number;batchSize:number;microBatchSize:number;checkpoints:number;reserveBytes:number;estimatedWorkingBytes:number|null;estimate:'model-profile'|'generic';};
/** Resource settings change allocation and batching, never the authored prompt,
 * sampling, model quantization, or full configured context. Estimates are not
 * Windows/native qualification or a guarantee of response speed. */
export function resourcePlan(hardware:Pick<HardwareProfile,'ramTotal'>,model:{weightsBytes:number|null;contextTokens:number;memoryProfile?:ModelMemoryProfile;resourceProfile?:{promptCacheMinimumMiB:number;minimumCheckpoints:number}}):ResourcePlan {
 const total=hardware.ramTotal,compact=Number.isFinite(total)&&total>0&&total<=10*GiB;
 const mode=compact?'compact':total<=20*GiB?'balanced':'roomy';
 const promptCacheMiB=Math.max(compact?128:mode==='balanced'?512:2048,model.memoryProfile?.promptCacheMinimumMiB??model.resourceProfile?.promptCacheMinimumMiB??0);
 const checkpoints=Math.max(compact?2:mode==='balanced'?8:16,model.memoryProfile?.minimumCheckpoints??model.resourceProfile?.minimumCheckpoints??0);
 const reserveBytes=compact?Math.max(2.5*GiB,total*.25):Math.max(4*GiB,total*.2);
 const weights=model.weightsBytes,profile=model.memoryProfile;
 const valid=weights!==null&&Number.isFinite(weights)&&weights>0&&Number.isSafeInteger(model.contextTokens)&&model.contextTokens>0;
 // The pinned 4B profile accounts for f16 KV, recurrent snapshots, expanded
 // tensors, scratch and resident speech. Unknown architectures retain the
 // conservative generic estimate instead of inheriting a guessed 4B profile.
 const estimatedWorkingBytes=!valid?null:Math.ceil(profile
  ?weights!*(1+profile.weightsOverheadRatio)+model.contextTokens*profile.kvBytesPerToken
   +profile.recurrentStateMiB*(checkpoints+1)*MiB+(compact?256:512)*MiB+768*MiB+promptCacheMiB*MiB
  :weights!+Math.max(2*GiB,weights!*.2)+model.contextTokens*64*1024+Math.max(0,promptCacheMiB-512)*MiB);
 return {mode,context:model.contextTokens,promptCacheMiB,batchSize:compact?(profile?.compactBatchSize??128):512,microBatchSize:compact?(profile?.compactMicroBatchSize??32):128,checkpoints,reserveBytes,estimatedWorkingBytes,estimate:profile?'model-profile':'generic'};
}
