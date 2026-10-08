// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {resourcePath} from '../runtime/paths';

const schema=z.object({alias:z.string(),repo:z.string().regex(/^[\w.-]+\/[\w.-]+$/),revision:z.string().regex(/^[a-f0-9]{40}$/),file:z.string().regex(/^[\w.-]+\.gguf$/),bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),license:z.string().nullable(),context:z.number().int().positive(),desktopSupported:z.boolean(),qualification:z.enum(['reference-tested','experimental','development-only']),priority:z.number(),description:z.string()});
export const localModelCatalog=z.array(schema).parse(JSON.parse(readFileSync(resourcePath('config/local-model-catalog.json'),'utf8')));
export function catalogModel(alias:string){return localModelCatalog.find(model=>model.alias===alias);}
export function downloadableModel(alias:string){
 const model=catalogModel(alias);
 if(!model?.desktopSupported||model.license!=='apache-2.0')throw Error('This model is not available through verified setup.');
 return model;
}
export function modelAsset(alias:string){
 const model=downloadableModel(alias);
 return {path:'community/'+model.file,bytes:model.bytes,sha256:model.sha256,url:`https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`,license:model.license!};
}
