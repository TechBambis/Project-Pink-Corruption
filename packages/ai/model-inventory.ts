// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {z} from 'zod';
import {modelContext,modelLabel,nativeSamplingModels,communityQwen} from './models';
import type {ModelCandidate} from './recommendation';

const pinSchema=z.object({alias:z.string().min(1).max(200),file:z.string().min(1).max(250),bytes:z.number().positive().finite()});
const tagSchema=z.object({name:z.string().min(1).max(200),size:z.number().positive().finite().optional()});
export function modelInventory(tags:unknown):ModelCandidate[]{
 const candidates=new Map<string,ModelCandidate>();
 for(const path of ['docs/community-models.json','docs/qwen36-model.json','docs/comparison-models.json']){
  if(!existsSync(path))continue;
  try{const parsed=JSON.parse(readFileSync(path,'utf8'));
   for(const value of (Array.isArray(parsed)?parsed:[parsed]).slice(0,64)){
    const result=pinSchema.safeParse(value);if(!result.success||basename(result.data.file)!==result.data.file)continue;
    const pin=result.data;
    const file=resolve('models/community',pin.file);
    let installed=false;try{installed=statSync(file).isFile()&&statSync(file).size===pin.bytes;}catch{}
    candidates.set(pin.alias,{id:pin.alias,label:modelLabel(pin.alias),weightsBytes:pin.bytes,contextTokens:modelContext(pin.alias,'bambisleep-classic'),backend:nativeSamplingModels.includes(pin.alias)?'llama.cpp':'ollama',installed:nativeSamplingModels.includes(pin.alias)&&installed,priority:pin.alias===communityQwen?100:50});
   }
  }catch{}
 }
 const list=z.object({models:z.array(z.unknown()).max(256)}).safeParse(tags);
 if(list.success)for(const value of list.data.models){
  const parsed=tagSchema.safeParse(value);if(!parsed.success)continue;
  const tag=parsed.data,known=candidates.get(tag.name),native=nativeSamplingModels.includes(tag.name);
  candidates.set(tag.name,{id:tag.name,label:modelLabel(tag.name),weightsBytes:known?.weightsBytes??tag.size??null,contextTokens:modelContext(tag.name,'bambisleep-classic'),backend:native?'llama.cpp':'ollama',installed:native?known?.installed??false:true,priority:known?.priority??(tag.name==='qwen3.5:4b'?70:10)});
 }
 return [...candidates.values()];
}
