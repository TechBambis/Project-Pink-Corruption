// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {runtimeDeviceId} from '../packages/runtime/runtime-tuning.mjs';
import {acceleratorPlan,acceleratorEnvironment,backendLibraries,backendRuntimeFiles} from '../packages/runtime/accelerator-runtime.mjs';
import {acceleratorDevices,acceleratorCandidates,acceleratorArguments,deviceKey,cudaVersion,inferenceThreads} from '../packages/runtime/accelerator-policy';

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

test('the received Mac MTL identifier selects Metal without changing Windows/Linux candidates',()=>{
 const devices=acceleratorDevices('Available devices:\n  MTL0: Apple Paravirtual device (4778 MiB, 4778 MiB free)\n  BLAS: Accelerate (0 MiB, 0 MiB free)');
 assert.deepEqual(devices,[{id:'MTL0',backend:'metal',name:'Apple Paravirtual device',totalMiB:4778,freeMiB:4778}]);
 assert.deepEqual(acceleratorCandidates(devices,'darwin').map(device=>device.id),['MTL0']);
 assert.deepEqual(acceleratorCandidates(devices,'linux'),[]);assert.deepEqual(acceleratorCandidates(devices,'win32'),[]);
 assert.equal(acceleratorArguments(devices[0],24576)[1],'MTL0');
 assert.equal(acceleratorDevices('MTL: Missing index (4778 MiB, 4778 MiB free)\nMTL0;bad: Bad (4778 MiB, 4778 MiB free)').length,0);
});

test('cold Mac discovery may exceed the existing eight-second bound and still produce a Metal plan',async t=>{
 const root=await mkdtemp(join(tmpdir(),'Bambi cold Metal fixture '));t.after(()=>rm(root,{recursive:true,force:true}));
 const script=join(root,'probe.mjs');await writeFile(script,"setTimeout(()=>console.log('MTL0: Apple Paravirtual device (4778 MiB, 4778 MiB free)'),8500);");
 const plan=await acceleratorPlan({command:{executable:process.execPath,prefix:[script]},platform:'darwin',library:root,context:24576,environment:process.env});
 assert.deepEqual(plan.attempts.map(attempt=>attempt.device?.backend??'cpu'),['metal','cpu']);assert.deepEqual(plan.probeFailures,[]);
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
test('CUDA 13 and 12 remain independent paths; an incompatible modern plugin falls back to the older CUDA before Vulkan',async t=>{
 const root=await mkdtemp(join(tmpdir(),'Bambi CUDA variants '));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const backend of ['cuda_v13','cuda_v12','vulkan']){await mkdir(join(root,backend));await writeFile(join(root,backend,`libggml-${backend==='vulkan'?'vulkan':'cuda'}.so`),'fixture');}
 await writeFile(join(root,'cuda_v12/libcublas.so.12'),'fixture cuBLAS');
 assert(backendRuntimeFiles(root,'linux').includes(join(root,'cuda_v12/libcublas.so.12')));
 const script=join(root,'probe.mjs');await writeFile(script,`if(process.env.GGML_BACKEND_PATH?.includes('cuda_v13'))process.exit(1);
if(process.env.GGML_BACKEND_PATH?.includes('cuda_v12'))console.log('CUDA0: NVIDIA fixture (32768 MiB, 31000 MiB free)');
if(process.env.GGML_BACKEND_PATH?.includes('vulkan'))console.log('Vulkan0: NVIDIA fixture (32768 MiB, 31000 MiB free)');`);
 const options={command:{executable:process.execPath,prefix:[script]},platform:'linux' as const,library:root,context:24576,environment:process.env,probeTimeoutMs:4000};
 const plan=await acceleratorPlan(options);assert.equal(plan.probeFailures.length,1);assert.deepEqual(plan.attempts.map(a=>a.device?.backend??'cpu'),['cuda','vulkan','cpu']);
 assert.equal(plan.attempts[0].device?.backendPath,join(root,'cuda_v12/libggml-cuda.so'));
 const devices=[{...plan.devices[0],backendPath:join(root,'cuda_v13/libggml-cuda.so')},...plan.devices];
 assert.notEqual(runtimeDeviceId(devices[0]),runtimeDeviceId(devices[1]));
 const targeted=await acceleratorPlan({...options,devices,deviceId:runtimeDeviceId(devices[1])});assert.equal(targeted.attempts.length,1);assert.equal(targeted.attempts[0].device?.backendPath,devices[1].backendPath);
});
test('CUDA dependency symlinks cannot escape the owned runtime',{skip:process.platform==='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'Bambi CUDA dependency '));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'owned/cuda_v13'),{recursive:true});await writeFile(join(root,'owned/cuda_v13/libggml-cuda.so'),'fixture');await writeFile(join(root,'foreign.so'),'foreign');
 await symlink(join(root,'foreign.so'),join(root,'owned/cuda_v13/libcublas.so.13'));assert.throws(()=>backendRuntimeFiles(join(root,'owned'),'linux'),/escapes/);
});
test('public CUDA version labels follow exact package folders and omit private paths',()=>{
 const device={id:'CUDA0',backend:'cuda' as const,name:'fixture',totalMiB:8192,freeMiB:7000};
 assert.equal(cudaVersion({...device,backendPath:'/owned/cuda_v13/libggml-cuda.so'}),13);
 assert.equal(cudaVersion({...device,backendPath:'C:\\Bambi ü\\cuda_v12\\ggml-cuda.dll'}),12);
 assert.equal(cudaVersion({...device,backendPath:'/owned/cuda_v130/libggml-cuda.so'}),undefined);
 assert.equal(cudaVersion({...device,backend:'vulkan',backendPath:'/owned/cuda_v13/libggml-vulkan.so'}),undefined);
 assert.equal(cudaVersion(device),undefined);assert.equal(cudaVersion(null),undefined);
});

test('Python policy pipe uses the same full-context plan without enumerating in CPU mode',async()=>{
 const request={action:'plan',options:{command:{executable:'unavailable-fixture'},platform:'linux',library:'/unused-fixture',context:24576,mode:'cpu',environment:{}}};
 const child=spawn(process.execPath,['scripts/accelerator-plan.mjs'],{stdio:['pipe','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>errors+=part);child.stdin.end(JSON.stringify(request));
 const code=await new Promise<number|null>(resolve=>child.once('close',resolve));assert.equal(code,0,errors);
 const plan=JSON.parse(output);assert.equal(plan.requested,'cpu');assert.equal(plan.devices.length,0);assert.equal(plan.attempts.length,1);
 assert.equal(plan.attempts[0].args[7],'24576');assert.equal(plan.attempts[0].environment.GGML_BACKEND_PATH,undefined);
});

test('measured targets select the exact owned GPU/backend and never add CPU or another device as fallback',async()=>{
 const devices=[{backend:'cuda' as const,id:'CUDA0',name:'RTX fixture',totalMiB:32768,freeMiB:31000},{backend:'vulkan' as const,id:'Vulkan0',name:'RTX fixture',totalMiB:32768,freeMiB:31000}];
 const options={command:{executable:'unused'},library:'/owned',platform:'linux' as const,context:24576,environment:{},devices};
 const plan=await acceleratorPlan({...options,deviceId:runtimeDeviceId(devices[1])});assert.equal(plan.attempts.length,1);assert.equal(plan.attempts[0].device?.backend,'vulkan');
 await assert.rejects(acceleratorPlan({...options,deviceId:'0'.repeat(64)}),/unavailable/);
 await assert.rejects(acceleratorPlan({...options,deviceId:runtimeDeviceId(devices[1]),blocked:[deviceKey(devices[1])]}),/quarantined/);
 await assert.rejects(acceleratorPlan({...options,deviceId:'--device CUDA0'}),/Invalid/);
 await assert.rejects(acceleratorPlan({...options,mode:'cpu',deviceId:runtimeDeviceId(devices[0])}),/Invalid/);
 assert.equal((await acceleratorPlan(options)).attempts.at(-1)?.device,null);
});
