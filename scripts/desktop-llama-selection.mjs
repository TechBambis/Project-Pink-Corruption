// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {realpathSync,statSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,relative,dirname,join} from 'node:path';

const crt='(?:concrt140|msvcp140(?:_[12]|_atomic_wait|_codecvt_ids)?|vccorlib140|vcruntime140(?:_1|_threads)?)';
/** Exact native slice of the checksum-pinned Ollama 0.35.1 archives. */
export function llamaEntries(listing,platform='win32'){
 if(!['win32','linux'].includes(platform))throw Error('Unsupported llama package platform.');
 const windows=new RegExp(`^(?:llama-server\\.exe|ggml(?:-base|-cpu-[a-z0-9]+)?\\.dll|lib(?:c\\+\\+|llama|llama-common|llama-server-impl|mtmd|omp|unwind|winpthread-1)\\.dll|vulkan/(?:ggml-vulkan|${crt})\\.dll)$`);
 const linux=/^(?:llama-server|lib(?:ggml(?:-base|-cpu-[a-z0-9]+)?|llama(?:-common|-server-impl)?|mtmd|gomp)\.so(?:\.[0-9]+)*|vulkan\/libggml-vulkan\.so)$/;
 const approved=[...new Set(listing.map(path=>path.replaceAll('\\','/')).filter(path=>{
  if(!path.startsWith('lib/ollama/'))return false;
  const local=path.slice('lib/ollama/'.length);
  if(local.split('/').some(part=>!part||part==='.'||part==='..'))return false;
  if(/^[^/]*(?:LICENSE|NOTICE|COPYING)[^/]*$/.test(local))return true;
  if((platform==='win32'?windows:linux).test(local))return true;
  for(const version of [12,13]){
   const cuda=platform==='win32'
    ?new RegExp(`^cuda_v${version}/(?:ggml-cuda|cublas(?:Lt)?64_${version}|cudart64_${version}|${crt})\\.dll$`)
    :new RegExp(`^cuda_v${version}/(?:libggml-cuda\\.so|lib(?:cublas(?:Lt)?|cudart)\\.so\\.${version}(?:\\.[0-9]+)*)$`);
   if(cuda.test(local))return true;
  }
  return false;
 }))].sort();
 const required=platform==='win32'
  ?['llama-server.exe','ggml.dll','ggml-base.dll','ggml-cpu-x64.dll','libllama.dll','libllama-server-impl.dll','vulkan/ggml-vulkan.dll',
    'cuda_v12/ggml-cuda.dll','cuda_v12/cublas64_12.dll','cuda_v12/cublasLt64_12.dll','cuda_v12/cudart64_12.dll',
    'cuda_v13/ggml-cuda.dll','cuda_v13/cublas64_13.dll','cuda_v13/cublasLt64_13.dll']
  :['llama-server','libggml.so','libggml-base.so','libggml-cpu-x64.so','libllama.so','libllama-server-impl.so','libgomp.so.1','vulkan/libggml-vulkan.so',
    ...[12,13].flatMap(version=>['libggml-cuda.so',`libcublas.so.${version}`,`libcublasLt.so.${version}`,`libcudart.so.${version}`].map(name=>`cuda_v${version}/${name}`))];
 // This pinned Windows CUDA 13 build links cudart statically; Linux does not.
 for(const file of required)if(!approved.includes('lib/ollama/'+file))throw Error('Reviewed llama runtime missing '+file);
 return approved;
}
/** Extract versioned link targets, but ship one regular file per CUDA SONAME. */
export function linuxLlamaFiles(entries){
 return entries.filter(path=>!/^lib\/ollama\/cuda_v(?:12|13)\/lib(?:cublas(?:Lt)?|cudart)\.so\.\d+\./.test(path));
}
export function stageLinuxLlama(extracted,destination,entries){
 const origin=realpathSync(resolve(extracted,'lib/ollama')),selected=new Set(entries.map(path=>resolve(extracted,path)));
 const files=linuxLlamaFiles(entries);
 // Resolve every link before copying; only selected internal archive targets qualify.
 const resolved=files.map(path=>{
  const source=resolve(extracted,path),real=realpathSync(source);
  if(!real.startsWith(origin+'/')||!selected.has(real)||!statSync(real).isFile())throw Error('Escaping or unselected llama link: '+path);
  return {source:real,target:join(destination,relative(origin,source))};
 });
 for(const {source,target} of resolved){mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);}
 return files;
}
