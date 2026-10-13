// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {backendArguments} from '../apps/desktop/windows-runtime-paths.mjs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {buildOptions,downloadPinned,digest,llamaEntries,assertWindowsX64,sourcePathAllowed,inventory,peImports,windowsDependencyReport} from '../scripts/desktop-windows-support.mjs';
const {runtimeEnvironment}=createRequire(import.meta.url)('../apps/desktop/runtime-environment.cjs');

test('bounded frozen-release transport retains matching evidence and rejects another source or failed gates',t=>{
 const root=mkdtempSync(join(tmpdir(),'Bambi release transfer ü '));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const output=join(root,'output');mkdirSync(output);
 const version='0.1.0-alpha.8',applicationDigest='a'.repeat(64),sourceDigest='b'.repeat(64);
 const put=(name,data)=>writeFileSync(join(output,name),JSON.stringify(data));
 const gates={sourceChecks:'passed',packaging:'passed',installer:'passed',speech:'passed',localConversation:'pending'};
 put('RUNTIME-MANIFEST.json',{version,phase:'alpha',sourceDigest,release:{snapshot:'prepared',applicationDigest}});
 const source={version,applicationDigest,sourceDigest,platform:'win32',architecture:'x64',result:'passed'};
 const qualification={version,applicationDigest,sourceDigest,target:'windows-x64',gates};
 put('SOURCE-CHECKS.json',source);put('DESKTOP-QUALIFICATION.json',qualification);put('RELEASE-STATUS.json',{version,applicationDigest,ready:false});
 for(const name of ['WINDOWS-PACKAGING-CHECK.json','INSTALLER-CHECK.json','WINDOWS-NATIVE-SPEECH-CHECK.json'])put(name,{result:'passed',checks:[]});
 for(const name of ['NOTICES.tar.gz','TESTER-GUIDE.md',`bambi-local-${version}-x64.exe`,`bambi-local-${version}-source.tar.gz`])writeFileSync(join(output,name),'Public transport fixture; no real native runtime.');
 writeFileSync(join(output,'private.sqlite'),'Must never enter transport.');
 const run=folder=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/desktop-windows-transfer.mjs',import.meta.url)),'prepare',output,join(root,folder),'32'],{encoding:'utf8',env:{...process.env,GITHUB_RUN_ID:'123',GITHUB_SHA:'c'.repeat(40)}});
 const accepted=run('accepted');assert.equal(accepted.status,0,accepted.stderr);
 const manifest=JSON.parse(readFileSync(join(root,'accepted/0/TRANSFER-MANIFEST.json')));
 for(const name of ['SOURCE-CHECKS.json','DESKTOP-QUALIFICATION.json','RELEASE-STATUS.json','NOTICES.tar.gz'])assert(manifest.files.some(file=>file.name===name));
 assert(!manifest.files.some(file=>file.name==='private.sqlite'));
 assert.equal(JSON.parse(readFileSync(join(output,'CAPABILITY-RECORD.json'))).releaseGates.localConversation,'pending');
 put('SOURCE-CHECKS.json',{...source,sourceDigest:'d'.repeat(64)});assert.notEqual(run('wrong-source').status,0);assert(!existsSync(join(root,'wrong-source')));
 put('SOURCE-CHECKS.json',source);put('DESKTOP-QUALIFICATION.json',{...qualification,gates:{...gates,speech:'failed'}});assert.notEqual(run('failed-speech').status,0);assert(!existsSync(join(root,'failed-speech')));
});

test('Windows private runtime environment keeps canonical OS paths and excludes developer/provider overrides',()=>{
 const env=runtimeEnvironment({SYSTEMROOT:'C:\\Windows',PATH:'C:\\developer',Path:'C:\\other',NODE_OPTIONS:'--require attacker',PYTHONPATH:'bad',BAMBI_CLOUD_API_KEY:'secret',BAMBI_WINDOWS_JOB_OWNED:'1',GGML_BACKEND_PATH:'bad',LOCALAPPDATA:'C:\\Users\\Name ä\\AppData\\Local'},{platform:'win32',resources:'C:\\Program Files\\Bambi ü\\resources\\backend',data:'C:\\Users\\Name ä\\Bambi data',port:6969,alpha:true,tokens:{instance:'own',llama:'own-llama',speech:'own-speech'},ownerPid:123});
 assert.equal(env.PATH,'C:\\Program Files\\Bambi ü\\resources\\backend\\node\\bin');
 assert.equal(env.BAMBI_DATABASE,'C:\\Users\\Name ä\\Bambi data\\data\\bambi.sqlite');assert.equal(env.TEMP,env.TMP);
 assert.equal(env.SystemRoot,'C:\\Windows');assert.equal(env.BAMBI_ELECTRON_PID,'123');
 for(const key of ['Path','NODE_OPTIONS','PYTHONPATH','BAMBI_CLOUD_API_KEY','BAMBI_WINDOWS_JOB_OWNED','GGML_BACKEND_PATH'])assert(!(key in env),key);
 assert.throws(()=>runtimeEnvironment({SystemRoot:'relative'},{platform:'win32',tokens:{}}),/SystemRoot/);
});
test('Windows builds start with smoke and reject phase/version mismatches and path traversal',()=>{
 assert.deepEqual(buildOptions([]),{phase:'smoke',alpha:false,version:'0.1.0-smoke.2'});
 assert.equal(buildOptions(['alpha','0.1.0-alpha.3']).alpha,true);
 for(const args of [['alpha','0.1.0-smoke.2'],['smoke','../escape'],['other'],['alpha','0.1.0-alpha.3','extra']])assert.throws(()=>buildOptions(args));
});
test('desktop loader is an encoded file URL and launches through paths containing spaces and Unicode',t=>{
 const args=backendArguments('file:///C:/Received%20app%20%C3%BC/resources/backend/apps/desktop/windows-supervisor.mjs');
 assert.equal(args[1],'file:///C:/Received%20app%20%C3%BC/resources/backend/node_modules/tsx/dist/loader.mjs');
 const folder=mkdtempSync(join(tmpdir(),'Bambi loader ä '));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const loader=join(folder,'node_modules/tsx/dist');mkdirSync(loader,{recursive:true});writeFileSync(join(loader,'loader.mjs'),'globalThis.__fixtureImported=true;');
 const local=backendArguments(pathToFileURL(join(folder,'apps/desktop/windows-supervisor.mjs')));
 const result=spawnSync(process.execPath,[local[0],local[1],'--input-type=module','-e','if(!globalThis.__fixtureImported)process.exit(1)'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);
});
test('Windows llama selection includes complete CUDA 12/13 while excluding drivers, daemon and traversal',()=>{
 const required=['llama-server.exe','ggml.dll','ggml-base.dll','ggml-cpu-x64.dll','libllama.dll','libllama-server-impl.dll'];
 const cuda=[...[12,13].flatMap(version=>['ggml-cuda.dll',`cublas64_${version}.dll`,`cublasLt64_${version}.dll`,'msvcp140.dll','vcruntime140_1.dll'].map(name=>`cuda_v${version}/${name}`)),'cuda_v12/cudart64_12.dll'];
 const listing=[...required,...cuda,'ggml-cpu-zen4.dll','libc++.dll','DLFCN_WIN32_COPYING','LLAMA_CPP_LICENSE','vulkan/ggml-vulkan.dll','vulkan/msvcp140.dll','cuda_v13/nvcuda.dll','cuda_v13/cublas64_12.dll','cuda_v12/../evil.dll','cuda_v13/extra.dll','libllama-quantize-impl.dll','llama-quantize.exe','../evil.dll'].map(path=>'lib/ollama/'+path);
 listing.push('ollama.exe');const result=llamaEntries(listing);
 assert(result.includes('lib/ollama/ggml-cpu-zen4.dll'));assert(result.includes('lib/ollama/vulkan/msvcp140.dll'));assert(result.includes('lib/ollama/DLFCN_WIN32_COPYING'));
 for(const path of cuda)assert(result.includes('lib/ollama/'+path));
 assert(!result.some(path=>/nvcuda|extra|quantize|\.\.|^ollama/.test(path)));assert(!result.includes('lib/ollama/cuda_v13/cublas64_12.dll'));
 assert.throws(()=>llamaEntries(listing.filter(path=>!path.endsWith('llama-server.exe'))),/missing/);
 for(const path of cuda.filter(path=>!/msvcp|vcruntime/.test(path)))assert.throws(()=>llamaEntries(listing.filter(entry=>entry!=='lib/ollama/'+path)),/missing/);
});
test('source allowlist handles Windows separators and excludes local reports, weights and generated assets',()=>{
 for(const path of ['tests\\reports\\result.json','apps\\web\\public\\vad\\model.json','packages\\speech\\models\\private.json','.runtime\\data.json','docs/internal/record.md'])assert(!sourcePathAllowed(path),path);
 for(const path of ['apps\\desktop\\windows-job.cs','apps/web/public/sounds/bell-chime.wav','packages/content/stable-2.0/manifest.json','scripts/desktop-windows-support.d.mts'])assert(sourcePathAllowed(path),path);
});
test('PE validation rejects renamed Linux executables and wrong architecture',t=>{
 const folder=mkdtempSync(join(tmpdir(),'Bambi PE ü '));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const path=join(folder,'native.exe'),valid=Buffer.alloc(128);valid.write('MZ');valid.writeUInt32LE(64,0x3c);valid.write('PE\0\0',64);valid.writeUInt16LE(0x8664,68);valid.writeUInt16LE(0x20b,88);
 writeFileSync(path,valid);assert.doesNotThrow(()=>assertWindowsX64(path));
 const wrong=Buffer.from(valid);wrong.writeUInt16LE(0x14c,68);writeFileSync(path,wrong);assert.throws(()=>assertWindowsX64(path),/PE x64/);
 writeFileSync(path,Buffer.from('\x7fELF'));assert.throws(()=>assertWindowsX64(path),/PE x64/);
});
test('bounded downloads verify before publishing and remove failed partials; caches are rechecked',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'Bambi download ü '));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const body=Buffer.alloc(2*1024**2,7),server=createServer((request,response)=>response.end(request.url==='/oversize'?Buffer.concat([body,Buffer.from('extra')]):body));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const asset={url:`http://127.0.0.1:${server.address().port}/ok`,bytes:body.length,sha256:digest(body)},path=join(folder,'checked.zip');
 await downloadPinned(asset,path);assert.equal(digest(readFileSync(path)),asset.sha256);await downloadPinned(asset,path);
 writeFileSync(path,Buffer.alloc(body.length,8));await assert.rejects(downloadPinned(asset,path),/checksum/);
 rmSync(path);await assert.rejects(downloadPinned({...asset,url:asset.url.replace('/ok','/oversize')},path),/size/);
 assert(!existsSync(path));assert(!readdirSync(folder).some(name=>name.includes('.partial-')));
 await assert.rejects(downloadPinned({...asset,sha256:'0'.repeat(64)},path),/checksum/);assert(!existsSync(path));
 const rows=await inventory(folder);assert.equal(rows.length,0);
});
test('PE dependency inspection catches omitted DLLs and does not accept a build-host VC runtime as an inbox dependency',t=>{
 const folder=mkdtempSync(join(tmpdir(),'Bambi imports ü '));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 function pe(importName){
  const bytes=Buffer.alloc(1024);bytes.write('MZ');bytes.writeUInt32LE(64,0x3c);bytes.write('PE\0\0',64);bytes.writeUInt16LE(0x8664,68);bytes.writeUInt16LE(1,70);bytes.writeUInt16LE(240,84);bytes.writeUInt16LE(0x20b,88);
  bytes.writeUInt32LE(512,148);bytes.writeUInt32LE(16,196);bytes.writeUInt32LE(0x1000,208);
  bytes.writeUInt32LE(512,336);bytes.writeUInt32LE(0x1000,340);bytes.writeUInt32LE(512,344);bytes.writeUInt32LE(512,348);
  bytes.writeUInt32LE(0x1080,524);bytes.write(importName+'\0',640);return bytes;
 }
 const path=join(folder,'server.exe');writeFileSync(path,pe('VCRUNTIME140.dll'));assert.deepEqual(peImports(path),['vcruntime140.dll']);
 assert.deepEqual(windowsDependencyReport(folder).unresolved,[{path:'server.exe',dll:'vcruntime140.dll'}]);
 writeFileSync(join(folder,'vcruntime140.dll'),pe('KERNEL32.dll'));assert.equal(windowsDependencyReport(folder).unresolved.length,0);
 for(const backend of ['cuda_v12','cuda_v13','vulkan'])mkdirSync(join(folder,backend));
 writeFileSync(join(folder,'cuda_v12/ggml-cuda.dll'),pe('NVCUDA.dll'));
 writeFileSync(join(folder,'cuda_v13/ggml-cuda.dll'),pe('MSVCP140.dll'));
 writeFileSync(join(folder,'vulkan/ggml-vulkan.dll'),pe('VULKAN-1.dll'));
 writeFileSync(join(folder,'vulkan/msvcp140.dll'),pe('KERNEL32.dll'));
 const isolated=windowsDependencyReport(folder);
 assert.deepEqual(isolated.unresolved,[{path:'cuda_v13/ggml-cuda.dll',dll:'msvcp140.dll'}]);
 assert.deepEqual(isolated.optionalDriver,[{path:'cuda_v12/ggml-cuda.dll',dll:'nvcuda.dll'},{path:'vulkan/ggml-vulkan.dll',dll:'vulkan-1.dll'}]);
 writeFileSync(join(folder,'cuda_v13/msvcp140.dll'),pe('KERNEL32.dll'));assert.equal(windowsDependencyReport(folder).unresolved.length,0);
});
