// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {statSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {modelContext,modelLabel,nativeSamplingModels} from './models';
import {localModelCatalog} from './model-catalog';
import {NATIVE_CONTEXT} from '../../config/sampling';
import type {ModelCandidate} from './recommendation';

const tagSchema=z.object({name:z.string().min(1).max(200),size:z.number().positive().finite().optional()});
export function modelInventory(tags:unknown,options:{desktop?:boolean;directory?:string;installedModel?:string;verified?:boolean}={}):ModelCandidate[]{
 const candidates=new Map<string,ModelCandidate>();
 for(const pin of localModelCatalog){
  let installed=false;
  if(options.desktop)installed=options.verified===true&&options.installedModel===pin.alias;
  else try{const file=statSync(resolve(options.directory??'models','community',pin.file));installed=file.isFile()&&file.size===pin.bytes;}catch{}
  const native=nativeSamplingModels.includes(pin.alias),contextTokens=options.desktop?pin.context:modelContext(pin.alias,'bambisleep-classic');
  candidates.set(pin.alias,{id:pin.alias,label:modelLabel(pin.alias),weightsBytes:pin.bytes,contextTokens,backend:native?'llama.cpp':'ollama',installed:native&&installed,priority:pin.priority,desktopSupported:options.desktop?pin.desktopSupported:undefined,qualification:pin.qualification,description:pin.description,sourceUrl:`https://huggingface.co/${pin.repo}/tree/${pin.revision}`,downloadBytes:pin.bytes,canDownload:pin.desktopSupported&&pin.license==='apache-2.0',promptCompatible:contextTokens>=NATIVE_CONTEXT});
 }
 const list=z.object({models:z.array(z.unknown()).max(256)}).safeParse(tags);
 if(list.success)for(const value of list.data.models){
  const parsed=tagSchema.safeParse(value);if(!parsed.success)continue;
  const tag=parsed.data,known=candidates.get(tag.name),native=nativeSamplingModels.includes(tag.name);
  const contextTokens=known?.contextTokens??modelContext(tag.name,'bambisleep-classic');
  candidates.set(tag.name,{...known,id:tag.name,label:modelLabel(tag.name),weightsBytes:known?.weightsBytes??tag.size??null,contextTokens,backend:native?'llama.cpp':'ollama',installed:native?known?.installed??false:true,priority:known?.priority??(tag.name==='qwen3.5:4b'?70:10),canDownload:known?.canDownload??false,promptCompatible:contextTokens>=NATIVE_CONTEXT});
 }
 return [...candidates.values()];
}
