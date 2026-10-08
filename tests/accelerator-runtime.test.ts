// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {acceleratorPlan,acceleratorEnvironment,backendLibraries} from '../packages/runtime/accelerator-runtime.mjs';
import {acceleratorDevices,acceleratorCandidates,acceleratorArguments,deviceKey,inferenceThreads} from '../packages/runtime/accelerator-policy';

test('small PCs retain CPU capacity for speech and the shared plan uses the same thread budget',async()=>{
 assert.deepEqual([1,2,4,8,64].map(inferenceThreads),[1,1,2,6,6]);
 assert.throws(()=>inferenceThreads(0));assert.throws(()=>inferenceThreads(2.5));
 const plan=await acceleratorPlan({command:{executable:'unavailable-fixture'},platform:'linux',library:'/unused-fixture',context:24576,mode:'cpu',environment:{},cpuThreads:4});
 assert.deepEqual(plan.attempts[0].args.slice(-4),['--threads','2','--threads-batch','2']);
});

test('unknown memory remains testable, busy devices and malformed/remote identifiers never enter the plan',()=>{
 const devices=acceleratorDevices('CUDA0: NVIDIA (8192 MiB, 7000 MiB free)\nVulkan0: Busy (8192 MiB, 0 MiB free)\nVulkan1: Integrated (0 MiB, 0 MiB free)\nMetal: Apple (0 MiB, 0 MiB free)\nVulkan2;bad: Bad (8192 MiB, 7000 MiB free)\nRPC0: Remote (8192 MiB, 7000 MiB free)\nVulkan3: Impossible (8192 MiB, 9000 MiB free)');
 assert.deepEqual(acceleratorCandidates(devices,'linux').map(d=>d.id),['CUDA0','Vulkan1']);
 assert.deepEqual(acceleratorCandidates(devices,'darwin').map(d=>d.id),['Metal']);
 assert.deepEqual(acceleratorCandidates(devices,'linux',[deviceKey(devices.find(d=>d.id==='CUDA0')!)]).map(d=>d.id),['Vulkan1']);
 const args=acceleratorArguments(null,24576);assert.equal(args[1],'none');assert.equal(args[3],'0');assert.equal(args[7],'24576');
 assert.throws(()=>acceleratorArguments(null,NaN));
});

test('loader and visibility overrides are removed in both CPU and GPU environments',()=>{
 const source={PATH:'system',Path:'other',GGML_BACKEND_PATH:'foreign',ggml_vk_visible_devices:'-1',CUDA_VISIBLE_DEVICES:'-1',LLAMA_ARG_CTX_SIZE:'4096',LD_LIBRARY_PATH:'foreign'};
 const cpu=acceleratorEnvironment(source,{platform:'win32',library:'owned'});
 assert.equal(cpu.PATH,'owned;system');assert.equal(cpu.Path,undefined);
 for(const key of ['GGML_BACKEND_PATH','ggml_vk_visible_devices','CUDA_VISIBLE_DEVICES','LLAMA_ARG_CTX_SIZE','LD_LIBRARY_PATH'])assert.equal(cpu[key],undefined);
 const gpu=acceleratorEnvironment(source,{platform:'linux',library:'/owned',backendPath:'/owned/vulkan/libggml-vulkan.so'});
 assert.equal(gpu.GGML_BACKEND_PATH,'/owned/vulkan/libggml-vulkan.so');assert.equal(gpu.LD_LIBRARY_PATH,'/owned:/owned/vulkan');
 assert.equal(source.GGML_BACKEND_PATH,'foreign');
});

test('an unusable optional plugin leaves a working backend available; CPU never inherits its loader',async t=>{
 const root=await mkdtemp(join(tmpdir(),'Bambi backend probes ü '));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const backend of ['cuda','vulkan']){await mkdir(join(root,backend));await writeFile(join(root,backend,`libggml-${backend}.so`),'fixture');}
 const script=join(root,'probe.mjs'),events=join(root,'events.jsonl');
 await writeFile(script,`import {appendFileSync} from 'node:fs';
appendFileSync(process.env.FIXTURE_EVENTS,JSON.stringify({backendPath:process.env.GGML_BACKEND_PATH,visible:process.env.GGML_VK_VISIBLE_DEVICES})+'\\n');
if(process.env.GGML_BACKEND_PATH?.includes('cuda'))process.exit(1);
if(process.env.GGML_BACKEND_PATH?.includes('vulkan'))console.log('Vulkan0: GPU (8192 MiB, 7000 MiB free)');
`);
 const plan=await acceleratorPlan({command:{executable:process.execPath,prefix:[script]},platform:'linux',library:root,context:24576,environment:{...process.env,FIXTURE_EVENTS:events,GGML_VK_VISIBLE_DEVICES:'-1'},probeTimeoutMs:3000});
 assert.equal(plan.probeFailures.length,1);assert.deepEqual(plan.attempts.map(a=>a.device?.backend??'cpu'),['vulkan','cpu']);
 assert.equal(plan.attempts[0].environment.GGML_BACKEND_PATH,join(root,'vulkan/libggml-vulkan.so'));
 assert.equal(plan.attempts[1].environment.GGML_BACKEND_PATH,undefined);
 const rows=(await readFile(events,'utf8')).trim().split('\n').map(row=>JSON.parse(row));
 assert.equal(rows.length,3);assert(rows.every(row=>row.visible===undefined));
});

test('a backend symlink cannot load a library outside the owned runtime', {skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'Bambi backend links '));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'owned/vulkan'),{recursive:true});await writeFile(join(root,'foreign.so'),'fixture');
 await symlink(join(root,'foreign.so'),join(root,'owned/vulkan/libggml-vulkan.so'));
 assert.throws(()=>backendLibraries(join(root,'owned'),'linux'),/escapes/);
});

test('Python policy pipe uses the same full-context plan without enumerating in CPU mode',async()=>{
 const request={action:'plan',options:{command:{executable:'unavailable-fixture'},platform:'linux',library:'/unused-fixture',context:24576,mode:'cpu',environment:{}}};
 const child=spawn(process.execPath,['scripts/accelerator-plan.mjs'],{stdio:['pipe','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>errors+=part);child.stdin.end(JSON.stringify(request));
 const code=await new Promise<number|null>(resolve=>child.once('close',resolve));assert.equal(code,0,errors);
 const plan=JSON.parse(output);assert.equal(plan.requested,'cpu');assert.equal(plan.devices.length,0);assert.equal(plan.attempts.length,1);
 assert.equal(plan.attempts[0].args[7],'24576');assert.equal(plan.attempts[0].environment.GGML_BACKEND_PATH,undefined);
});
