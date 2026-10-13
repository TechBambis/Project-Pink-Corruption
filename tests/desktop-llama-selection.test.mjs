// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync,symlinkSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {llamaEntries,linuxLlamaFiles,stageLinuxLlama} from '../scripts/desktop-llama-selection.mjs';
import {verifyCudaNotices} from '../scripts/desktop-cuda-notices.mjs';

const linux=['llama-server','libggml.so','libggml-base.so','libggml-cpu-x64.so','libllama.so','libllama-server-impl.so','libgomp.so.1','vulkan/libggml-vulkan.so','LLAMA_CPP_LICENSE',
 ...[12,13].flatMap(version=>['libggml-cuda.so',...['cublas','cublasLt','cudart'].flatMap(name=>[`lib${name}.so.${version}`,`lib${name}.so.${version}.1.2`])].map(name=>`cuda_v${version}/${name}`))].map(path=>'lib/ollama/'+path);
test('Linux slice includes CUDA link targets and OpenMP, excludes foreign files and requires both backend closures',()=>{
 const entries=llamaEntries([...linux,'bin/ollama','lib/ollama/llama-quantize','lib/ollama/libllama-quantize-impl.so','lib/ollama/cuda_v12/libcublas.so.13','lib/ollama/cuda_v13/libcuda.so.1','lib/ollama/vulkan/../evil.so'],'linux');
 assert.deepEqual(entries,[...linux].sort());
 assert.equal(linuxLlamaFiles(entries).filter(path=>path.includes('/cuda_')).length,8);
 for(const path of linuxLlamaFiles(linux).filter(path=>!path.endsWith('LICENSE')))assert.throws(()=>llamaEntries(linux.filter(entry=>entry!==path),'linux'),/missing/);
 assert.throws(()=>llamaEntries(linux,'darwin'),/platform/);
});
test('Linux staging flattens selected CUDA SONAMEs exactly once and refuses escaping or unselected links',{skip:process.platform==='win32'},t=>{
 const root=mkdtempSync(join(tmpdir(),'Bambi CUDA stage ü '));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const extracted=join(root,'extracted'),destination=join(root,'native');
 for(const path of linux){const full=join(extracted,path);mkdirSync(dirname(full),{recursive:true});
  if(/cuda_v\d+\/lib(?:cublas(?:Lt)?|cudart)\.so\.\d+$/.test(path))symlinkSync(path.split('/').at(-1)+'.1.2',full);
  else writeFileSync(full,'fixture '+path);
 }
 const shipped=stageLinuxLlama(extracted,destination,llamaEntries(linux,'linux'));
 for(const version of [12,13])for(const name of ['cublas','cublasLt','cudart']){
  const path=join(destination,`cuda_v${version}/lib${name}.so.${version}`);
  assert(lstatSync(path).isFile());assert(readFileSync(path,'utf8').includes(`.so.${version}.1.2`));assert(!existsSync(path+'.1.2'));
 }
 assert.equal(shipped.length,linux.length-6);
 const link=join(extracted,'lib/ollama/cuda_v12/libcublas.so.12');rmSync(link);
 const foreign=join(root,'foreign.so');writeFileSync(foreign,'foreign');symlinkSync(foreign,link);
 assert.throws(()=>stageLinuxLlama(extracted,join(root,'rejected'),linux),/Escaping/);assert(!existsSync(join(root,'rejected')));
 rmSync(link);writeFileSync(join(extracted,'lib/ollama/unselected.so'),'unselected');symlinkSync('../unselected.so',link);
 assert.throws(()=>stageLinuxLlama(extracted,join(root,'rejected'),linux),/unselected/);
});
test('CUDA SDK notices match their retained provenance and tampering blocks a native build',async t=>{
 const root=mkdtempSync(join(tmpdir(),'Bambi CUDA terms '));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const directory=join(root,'docs/licenses/nvidia-cuda');mkdirSync(directory,{recursive:true});
 const provenance=await verifyCudaNotices(fileURLToPath(new URL('../',import.meta.url)));
 writeFileSync(join(directory,'PROVENANCE.json'),JSON.stringify(provenance));
 for(const notice of provenance.notices)writeFileSync(join(directory,notice.file),readFileSync(new URL('../docs/licenses/nvidia-cuda/'+notice.file,import.meta.url)));
 await verifyCudaNotices(root);
 const path=join(directory,provenance.notices[0].file),bytes=readFileSync(path);bytes[bytes.length-1]^=1;writeFileSync(path,bytes);
 await assert.rejects(verifyCudaNotices(root),/notice differs/);
});
