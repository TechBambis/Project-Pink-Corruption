// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import catalogData from '../../config/local-model-catalog.json' with {type:'json'};
import {z} from 'zod';

const schema=z.object({alias:z.string(),repo:z.string().regex(/^[\w.-]+\/[\w.-]+$/),revision:z.string().regex(/^[a-f0-9]{40}$/),file:z.string().regex(/^[\w.-]+\.gguf$/),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),license:z.string().nullable(),context:z.number().int().positive(),desktopSupported:z.boolean(),qualification:z.enum(['reference-tested','experimental','development-only']),priority:z.number(),description:z.string()});
const memoryProfile=z.object({kvBytesPerToken:z.number().int().positive(),recurrentStateMiB:z.number().positive(),weightsOverheadRatio:z.number().min(0).max(1),promptCacheMinimumMiB:z.number().int().min(0).max(2048).optional(),minimumCheckpoints:z.number().int().min(0).max(32).optional(),compactBatchSize:z.number().int().min(32).max(512).optional(),compactMicroBatchSize:z.number().int().min(32).max(128).optional()});
const licenseNotice=z.object({file:z.string().regex(/^[\w.-]+$/),path:z.string().regex(/^community\/[\w.-]+\.txt$/),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const samplingProfile=z.object({temperature:z.number().min(0).max(2),top_p:z.number().min(0).max(1),top_k:z.number().int().min(0).max(1000),min_p:z.number().min(0).max(1),repeat_penalty:z.number().min(1).max(2),creativeTemperature:z.number().min(0).max(2),creativeTopP:z.number().min(0).max(1)}).strict();
export const localModelCatalog=z.array(schema.extend({memoryProfile:memoryProfile.optional(),resourceProfile:z.object({promptCacheMinimumMiB:z.number().int().min(0).max(2048),minimumCheckpoints:z.number().int().min(0).max(32)}).optional(),preferredFor:z.enum(['compact','balanced']).optional(),licenseNotice:licenseNotice.optional(),samplingProfile:samplingProfile.optional()})).parse(catalogData);
export function catalogModel(alias:string){return localModelCatalog.find(model=>model.alias===alias);}
export function canDownloadModel(model:typeof localModelCatalog[number]){return model.desktopSupported&&(model.license==='apache-2.0'||(model.license==='lfm1.0'&&!!model.licenseNotice));}
export function downloadableModel(alias:string){
 const model=catalogModel(alias);
 if(!model||!canDownloadModel(model))throw Error('This model is not available through verified setup.');
 return model;
}
export function modelAssets(alias:string){
 const model=downloadableModel(alias),notice=model.licenseNotice;
 return [modelAsset(alias),...(notice?[{path:notice.path,bytes:notice.bytes,sha256:notice.sha256,url:`https://huggingface.co/${model.repo}/resolve/${model.revision}/${notice.file}`,license:model.license!}]:[])];
}
export function modelAsset(alias:string){
 const model=downloadableModel(alias);
 return {path:'community/'+model.file,bytes:model.bytes,sha256:model.sha256,url:`https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}${model.samplingProfile?'?download=true':''}`,license:model.license!};
}
