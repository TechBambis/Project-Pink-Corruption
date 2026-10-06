// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {parentPort,workerData} from 'node:worker_threads';
import {pipeline,env} from '@huggingface/transformers';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=workerData.directory;env.useFSCache=false;
let encoder,chain=Promise.resolve();const cancelled=new Set(),tasks=new Set();
parentPort.on('message',({id,texts,kind,cancel})=>{
 if(cancel!==undefined){if(tasks.has(cancel))cancelled.add(cancel);return;}tasks.add(id);
 chain=chain.then(async()=>{
  if(cancelled.delete(id)){tasks.delete(id);return;}
  try{
   encoder??=await pipeline('feature-extraction',workerData.model,{local_files_only:true,device:'cpu',dtype:workerData.dtype,session_options:{intraOpNumThreads:1,interOpNumThreads:1}});
   const result=await encoder(texts.map(text=>workerData.prefixes?`${kind}: ${text}`:text),{pooling:'mean',normalize:true,truncation:true,max_length:512});
   if(!cancelled.delete(id))parentPort.postMessage({id,vectors:result.tolist()});
  }catch(error){if(!cancelled.delete(id))parentPort.postMessage({id,error:String(error)});}finally{tasks.delete(id);}
 });
});
