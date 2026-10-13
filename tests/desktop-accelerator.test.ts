// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {runtimeDeviceId} from '../packages/runtime/runtime-tuning.mjs';
import {DesktopServices} from '../packages/runtime/desktop-services';
import {alphaModels} from '../packages/runtime/desktop-setup';
import {acceleratorDevices,offloadEvidence,gpuFailureReason} from '../packages/runtime/accelerator-policy';

// Real owned child processes and HTTP servers, without model weights or GPUs.
// This fixture verifies controller behavior; it is not native AI qualification.
const childSource=String.raw`
import {appendFileSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
const scenario=process.env.FIXTURE_SCENARIO;
const note=value=>appendFileSync(process.env.FIXTURE_EVENTS,JSON.stringify({...value,pid:process.pid})+'\n');
note({args});
if(args.includes('--list-devices')){
 if(scenario==='slow-probe'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
 else{console.log(process.env.FIXTURE_INVENTORY||'Available devices:\n  Vulkan0: Display GPU (4096 MiB, 256 MiB free)\n  Vulkan1: Compute GPU (8192 MiB, 7168 MiB free)');process.exit(0);}
}else if(args[0]==='kokoro'){
 const server=createServer((_req,res)=>res.end(JSON.stringify({app:'bambi-local',service:'kokoro',protocol:1,pid:process.pid,instance:process.env.BAMBI_INSTANCE_TOKEN,modelSha256:process.env.FIXTURE_SPEECH_HASH})));
 server.listen(Number(process.env.BAMBI_TTS_PORT),'127.0.0.1');
}else{
 const cpu=option('--gpu-layers')==='0';
 if(scenario==='cuda-oom'&&option('--device').startsWith('CUDA')){console.error('cudaErrorMemoryAllocation: failed to load model');process.exit(1);}
 if(scenario==='cuda-kernel'&&option('--device').startsWith('CUDA')){console.error('no kernel image is available for execution on the device');process.exit(1);}
 if(scenario==='bad-model'){console.error('invalid magic: failed to load model');process.exit(1);}
 if(scenario==='oom'&&!cpu){console.error('VK_ERROR_OUT_OF_DEVICE_MEMORY: failed to load model');process.exit(1);}
 if(scenario==='slow-load'){setInterval(()=>{},1000);}
 else{
  console.error('offloaded '+(cpu||scenario==='zero-offload'?'0':'20')+'/33 layers to GPU');
  const server=createServer((req,res)=>{
   if(req.headers.authorization!=='Bearer fixture-llama'){res.writeHead(403);res.end();return;}
   if(req.url==='/v1/models')res.end(JSON.stringify({data:[{id:option('--alias')}]}));
   else if(req.url==='/props')res.end(JSON.stringify({default_generation_settings:{n_ctx:scenario==='wrong-context'?4096:Number(option('--ctx-size'))}}));
   else if(req.url==='/completion'){
    let body='';req.on('data',part=>body+=part);req.on('end',()=>{note({inference:JSON.parse(body)});res.end(JSON.stringify({content:'test',tokens_predicted:1}));});
   }else{res.writeHead(404);res.end();}
  });server.listen(Number(option('--port')),'127.0.0.1');
 }
}
`;
async function freePort(){const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return port;}
async function fixture(t:TestContext,scenario='',mode='auto',platform:NodeJS.Platform='linux',inventory?:string,memory=()=>({total:32*2**30,available:24*2**30})){
 const root=await mkdtemp(join(tmpdir(),'Bambi accelerator ü ')),script=join(root,'child.mjs'),events=join(root,'events.jsonl');
 await mkdir(join(root,'logs'));await writeFile(script,childSource);await writeFile(events,'');
 const llmPort=await freePort(),speechPort=await freePort();
 const services=new DesktopServices({memory,environment:{...process.env,FIXTURE_SCENARIO:scenario,FIXTURE_INVENTORY:inventory,FIXTURE_EVENTS:events,FIXTURE_SPEECH_HASH:alphaModels.assets[1].sha256,BAMBI_DESKTOP_ACCELERATOR:mode,BAMBI_MODELS_ROOT:root,BAMBI_LLM_PORT:String(llmPort),BAMBI_LLM_URL:'http://127.0.0.1:'+llmPort,BAMBI_LLM_TOKEN:'fixture-llama',BAMBI_TTS_PORT:String(speechPort),BAMBI_TTS_URL:'http://127.0.0.1:'+speechPort,BAMBI_TTS_TOKEN:'fixture-speech',BAMBI_INSTANCE_TOKEN:'fixture-instance'},llama:{executable:process.execPath,prefix:[script]},speech:{executable:process.execPath,prefix:[script]},platform,libraryDirectory:root,logsDirectory:join(root,'logs'),startupTimeoutMs:8000,probeTimeoutMs:scenario==='slow-probe'?1000:3000});
 t.after(async()=>{await services.stop();await rm(root,{recursive:true,force:true});});
 return {services,llmPort,events:async()=> (await readFile(events,'utf8')).trim().split('\n').filter(Boolean).map(row=>JSON.parse(row))};
}
test('device inventory selects usable free memory and rejects malformed command identifiers',()=>{
 const devices=acceleratorDevices('Vulkan0: A (8192 MiB, 300 MiB free)\n Vulkan1: B (4096 MiB, 3000 MiB free)\nVulkan2;bad: C (8192 MiB, 8000 MiB free)\nCUDA0: N (9000 MiB, 8500 MiB free)\nVulkan3: D (4096 MiB, 9000 MiB free)','vulkan');
 assert.deepEqual(devices.map(d=>d.id),['Vulkan1','Vulkan0']);
 assert.deepEqual(offloadEvidence('offloaded 20/33 layers to GPU'),{offloadedLayers:20,totalLayers:33});
 assert.equal(offloadEvidence('offloaded 40/33 layers to GPU'),null);
 assert.equal(gpuFailureReason('VK_ERROR_OUT_OF_DEVICE_MEMORY: failed to load model','exit'),'gpu-memory');
 assert.equal(gpuFailureReason('invalid magic: failed to load model','exit'),null);
});
test('measured tuning changes only bounded threads and batching and replaces the owned worker once',async t=>{
 const {services,events}=await fixture(t),model='bambi-qwen35-2b-hauhau:q4_k_m',tuning={accelerator:'cpu',threads:3,batchSize:128,microBatchSize:32} as const;
 await services.prepare(model,24576,undefined,'default',false,tuning);
 const launches=()=>events().then(rows=>rows.filter(row=>row.args?.includes('--gpu-layers'))),first=(await launches())[0],value=(flag:string)=>first.args[first.args.indexOf(flag)+1];
 for(const [flag,expected] of [['--threads','3'],['--threads-batch','3'],['--batch-size','128'],['--ubatch-size','32'],['--ctx-size','24576'],['--gpu-layers','0'],['--cache-type-k','f16']])assert.equal(value(flag),expected);
 assert.equal(services.capabilities.backend,'cpu');assert.equal(services.capabilities.inferenceVerified,true);
 await services.prepare(model,24576,undefined,'default',false,tuning);assert.equal((await launches()).length,1);
 await services.prepare(model,24576);assert.equal((await launches()).length,2);assert.throws(()=>process.kill(first.pid,0));
 await assert.rejects(services.prepare(model,24576,undefined,'default',false,{...tuning,cpuMoeLayers:0}),/matching model architecture/);
 await assert.rejects(services.prepare(model,24576,undefined,'default',false,{...tuning,threads:99}),/Invalid measured/);
 assert.equal((await launches()).length,2);
});
test('compact preparation uses its planned allocations on an 8 GB CPU host and reuses a ready worker under later pressure',async t=>{
 let available=6*2**30;
 const {services,events}=await fixture(t,'','cpu','win32',undefined,()=>({total:8*2**30,available}));
 const model='bambi-qwen35-2b-hauhau:q4_k_m';
 await services.prepare(model,24576);
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));
 const args=launches[0].args,value=(flag:string)=>args[args.indexOf(flag)+1];
 assert.equal(value('--cache-ram'),'512');assert.equal(value('--batch-size'),'512');assert.equal(value('--ubatch-size'),'128');assert.equal(value('--ctx-checkpoints'),'8');assert.equal(value('--ctx-size'),'24576');
 assert.equal(services.capabilities.resourcePlan?.mode,'compact');
 available=256*2**20;
 await services.prepare(model,24576);assert.equal((await events()).filter(row=>row.args?.includes('--gpu-layers')).length,1);
 await assert.rejects(services.prepare(alphaModels.alias,24576),/memory budget/);assert.equal(services.modelReady,true);
 await services.stop();await assert.rejects(services.prepare(model,24576),/available RAM/);
 assert.equal(services.modelReady,false);assert.equal(services.speechReady,false);
});
test('explicit memory trial reaches startup while preserving context checks and ordinary memory gates',async t=>{
 const {services,events}=await fixture(t,'','cpu','win32',undefined,()=>({total:8*2**30,available:512*2**20}));
 await assert.rejects(services.prepare(alphaModels.alias,24576),/memory budget/);
 assert.equal((await events()).length,0);
 await assert.rejects(services.prepare(alphaModels.alias,4096,undefined,'default',true),/full configured context/);
 await assert.rejects(services.prepare('unknown-model',24576,undefined,'default',true));
 await services.prepare(alphaModels.alias,24576,undefined,'default',true);
 assert.equal(services.capabilities.backend,'cpu');assert.equal(services.capabilities.inferenceVerified,true);
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));
 assert.equal(launches.length,1);assert.equal(launches[0].args[launches[0].args.indexOf('--ctx-size')+1],'24576');
 await services.prepare(alphaModels.alias,24576,undefined,'default',true);
 assert.equal((await events()).filter(row=>row.args?.includes('--gpu-layers')).length,1);
 await services.stop();await assert.rejects(services.prepare(alphaModels.alias,24576),/memory budget/);
});
test('GPU memory failure cannot fall back into an already exhausted CPU memory budget',async t=>{
 const {services,events}=await fixture(t,'oom','auto','win32',undefined,()=>({total:32*2**30,available:512*2**20}));
 await assert.rejects(services.prepare(alphaModels.alias,24576),/available RAM/);
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));
 assert.equal(launches.length,1);assert.throws(()=>process.kill(launches[0].pid,0));assert.equal(services.modelReady,false);
});
test('automatic preparation preserves full context, selects GPU, verifies inference and reports actual offload',async t=>{
 const {services,events}=await fixture(t);await services.prepare(alphaModels.alias,24576);
 const state=services.capabilities;assert.equal(state.backend,'vulkan');assert.equal(state.device,'Vulkan1');assert.equal(state.context,24576);assert.equal(state.offloadedLayers,20);assert.equal(state.inferenceVerified,true);assert.equal(state.ready,true);assert.equal(state.speech.synthesis.backend,'cpu');
 const rows=await events(),launch=rows.find(row=>row.args?.includes('--gpu-layers')).args;
 const value=(flag:string)=>launch[launch.indexOf(flag)+1];
 assert.equal(value('--gpu-layers'),'auto');assert.equal(value('--fit-ctx'),'24576');assert.equal(value('--fit-target'),'1024');assert.equal(value('--ctx-size'),'24576');
 assert.equal(value('--log-verbosity'),'4');assert(!launch.includes('--log-verbose'));assert(!launch.includes('--log-prompts-dir'));
 assert.equal(rows.filter(row=>row.inference).length,1);
 await services.prepare(alphaModels.alias,24576);assert.equal((await events()).length,rows.length);
 await services.stop();assert.equal(services.modelReady,false);assert.equal(services.speechReady,false);
 await services.prepare(alphaModels.alias,24576);assert.equal(services.capabilities.backend,'vulkan');assert.equal(services.capabilities.fallbackReason,undefined);
});
test('Q8 can be enabled, reused and switched off without changing the model or full context',async t=>{
 const {services,events}=await fixture(t);
 await services.prepare(alphaModels.alias,24576);
 await services.prepare(alphaModels.alias,24576,undefined,'q8_0');
 await services.prepare(alphaModels.alias,24576,undefined,'q8_0');
 await services.prepare(alphaModels.alias,24576);
 const launches=(await events()).filter(row=>row.args?.includes('--cache-type-k'));
 assert.equal(launches.length,3,'Identical Q8 preparation reuses its existing child');
 assert.deepEqual(launches.map(row=>row.args[row.args.indexOf('--cache-type-k')+1]),['f16','q8_0','f16']);
 for(const {args} of launches){assert.equal(args[args.indexOf('--cache-type-v')+1],args[args.indexOf('--cache-type-k')+1]);assert.equal(args[args.indexOf('--alias')+1],alphaModels.alias);assert.equal(args[args.indexOf('--ctx-size')+1],'24576');}
 assert.equal(services.capabilities.cacheType,'f16');
});
test('unqualified Windows Q8 preparation leaves the already prepared standard runner alive',async t=>{
 const {services,events}=await fixture(t,'','auto','win32');await services.prepare(alphaModels.alias,24576);
 await assert.rejects(services.prepare(alphaModels.alias,24576,undefined,'q8_0'),/available.*Linux/);
 assert.equal(services.modelReady,true);assert.equal((await events()).filter(row=>row.args?.includes('--cache-type-k')).length,1);
});
test('GPU memory failure stops its worker, retries CPU once and quarantines GPU until restart',async t=>{
 const {services,events}=await fixture(t,'oom');await services.prepare(alphaModels.alias,24576);
 assert.equal(services.capabilities.backend,'cpu');assert.equal(services.capabilities.attempts,2);assert.equal(services.capabilities.fallbackReason,'gpu-memory');
 let rows=await events();assert.equal(rows.filter(row=>row.args?.includes('--gpu-layers')).length,2);
 await services.stop();await services.prepare(alphaModels.alias,24576);rows=await events();
 assert.equal(rows.filter(row=>row.args?.includes('--list-devices')).length,1);assert.equal(services.capabilities.attempts,1);assert.equal(services.capabilities.backend,'cpu');
});
test('CPU mode skips GPU enumeration and does not inherit old GPU log evidence',async t=>{
 const {services,events}=await fixture(t,'','cpu');await services.prepare(alphaModels.alias,24576);
 assert.equal(services.capabilities.backend,'cpu');assert.equal(services.capabilities.offloadedLayers,0);assert.equal((await events()).filter(row=>row.args?.includes('--list-devices')).length,0);
});
test('available GPU with zero actual offload is truthfully reported as CPU',async t=>{
 const {services}=await fixture(t,'zero-offload');await services.prepare(alphaModels.alias,24576);
 assert.equal(services.capabilities.backend,'cpu');assert.equal(services.capabilities.fallbackReason,'runtime-selected-cpu');
});
test('invalid model and changed context fail without CPU retries or surviving workers',async t=>{
 for(const scenario of ['bad-model','wrong-context']){
  const {services,events}=await fixture(t,scenario);await assert.rejects(services.prepare(alphaModels.alias,24576));
  assert.equal((await events()).filter(row=>row.args?.includes('--gpu-layers')).length,1);assert.equal(services.modelReady,false);assert.equal(services.speechReady,false);
 }
});
test('cancelled preparation cannot launch fallback or leave the model port occupied',async t=>{
 const {services,llmPort,events}=await fixture(t,'slow-load'),controller=new AbortController();
 const running=services.prepare(alphaModels.alias,24576,controller.signal);const rejected=assert.rejects(running);
 while(!(await events()).some(row=>row.args?.includes('--gpu-layers')))await new Promise(r=>setTimeout(r,10));
 controller.abort();await rejected;assert.equal((await events()).filter(row=>row.args?.includes('--gpu-layers')).length,1);assert.equal(services.modelReady,false);
 const canary=createServer();await new Promise<void>(r=>canary.listen(llmPort,'127.0.0.1',r));await new Promise<void>(r=>canary.close(()=>r()));
});
test('occupied unrelated listener is preserved without probing or launching AI',async t=>{
 const {services,llmPort,events}=await fixture(t),canary=createServer();await new Promise<void>(r=>canary.listen(llmPort,'127.0.0.1',r));
 try{await assert.rejects(services.prepare(alphaModels.alias,24576),/occupied/);assert.equal((await events()).length,0);assert.equal(canary.listening,true);}finally{await new Promise<void>(r=>canary.close(()=>r()));}
});
test('hung GPU inventory is forcibly bounded and leaves CPU preparation available',async t=>{
 const {services,events}=await fixture(t,'slow-probe');await services.prepare(alphaModels.alias,24576);
 assert.equal(services.capabilities.backend,'cpu');assert.equal(services.capabilities.fallbackReason,'gpu-probe-unavailable');
 const probe=(await events()).find(row=>row.args?.includes('--list-devices'));assert.throws(()=>process.kill(probe.pid,0));
});

test('desktop stop invalidates waiting prepares before they can launch another owned process',async t=>{
 const {services,events,llmPort}=await fixture(t,'slow-load');
 const first=services.prepare(alphaModels.alias,24576),second=services.prepare(alphaModels.alias,24576);
 const results=Promise.allSettled([first,second]);
 while(!(await events()).some(row=>row.args?.includes('--gpu-layers')))await new Promise(r=>setTimeout(r,10));
 await services.stop();assert((await results).every(result=>result.status==='rejected'));
 assert.equal((await events()).filter(row=>row.args?.includes('--gpu-layers')).length,1);
 assert.deepEqual(services.state,{phase:'idle',model:null});assert.equal(services.modelReady,false);assert.equal(services.speechReady,false);
 const canary=createServer();await new Promise<void>(r=>canary.listen(llmPort,'127.0.0.1',r));await new Promise<void>(r=>canary.close(()=>r()));
});

test('desktop simultaneous model switches retain the requested full context and exact model ownership',async t=>{
 const {services,events}=await fixture(t,'','cpu');const other='bambi-qwen36-35b-hauhau:iq3_m';
 await Promise.all([services.prepare(alphaModels.alias,24576),services.prepare(other,24576)]);
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));
 assert.deepEqual(launches.map(row=>row.args[row.args.indexOf('--alias')+1]),[alphaModels.alias,other]);
 assert.equal(services.state.model,other);assert.equal(services.state.phase,'ready');assert.equal(services.capabilities.context,24576);
});
test('a crashed GPU worker is quarantined; recovery happens only on a new preparation',async t=>{
 const {services,events}=await fixture(t);await services.prepare(alphaModels.alias,24576);
 const owned=(await events()).find(row=>row.args?.includes('--gpu-layers'));
 process.kill(owned.pid,'SIGKILL');
 const deadline=Date.now()+3000;while(services.modelReady){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
 assert.equal(services.capabilities.phase,'failed');assert.equal(services.capabilities.fallbackReason,'gpu-runtime-stopped');
 const before=(await events()).length;await new Promise(r=>setTimeout(r,30));assert.equal((await events()).length,before,'Never replay or restart a live reply');
 await services.prepare(alphaModels.alias,24576);
 assert.equal(services.capabilities.backend,'cpu');assert.equal((await events()).filter(row=>row.args?.includes('--list-devices')).length,1);
});
test('stop during a GPU probe cancels owned work and serializes a later preparation',async t=>{
 const {services,events}=await fixture(t,'slow-probe');
 const first=services.prepare(alphaModels.alias,24576);const rejected=assert.rejects(first);
 const deadline=Date.now()+3000;
 while(!(await events()).some(row=>row.args?.includes('--list-devices'))){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));}
 const stopping=services.stop(),next=services.prepare(alphaModels.alias,24576);
 await rejected;await stopping;await next;
 const stoppedProbe=(await events()).find(row=>row.args?.includes('--list-devices'));assert.throws(()=>process.kill(stoppedProbe.pid,0));
 assert.equal(services.modelReady,true);assert.equal(services.speechReady,true);
 assert.equal((await events()).filter(row=>row.args?.includes('--gpu-layers')).length,1);
});


test('a failing CUDA device falls back to Vulkan and stays quarantined without blocking healthy acceleration',async t=>{
 const {services,events}=await fixture(t,'cuda-oom','auto','win32','CUDA0: NVIDIA (8192 MiB, 7000 MiB free)\nVulkan0: NVIDIA (8192 MiB, 7000 MiB free)');
 await services.prepare(alphaModels.alias,24576);
 assert.equal(services.capabilities.backend,'vulkan');assert.equal(services.capabilities.attempts,2);
 assert.deepEqual(services.capabilities.failures,[{backend:'cuda',device:'CUDA0',reason:'gpu-memory'}]);
 assert.equal(typeof services.capabilities.inferenceMs,'number');
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));
 assert.deepEqual(launches.map(row=>row.args[row.args.indexOf('--device')+1]),['CUDA0','Vulkan0']);
 for(const launch of launches){assert.equal(launch.args[launch.args.indexOf('--ctx-size')+1],'24576');assert.equal(launch.args[launch.args.indexOf('--fit-ctx')+1],'24576');}
 assert.throws(()=>process.kill(launches[0].pid,0));
 await services.stop();await services.prepare(alphaModels.alias,24576);
 assert.equal(services.capabilities.backend,'vulkan');assert.equal(services.capabilities.attempts,1);
 assert.equal((await events()).filter(row=>row.args?.includes('--list-devices')).length,1);
});
test('unsupported CUDA kernels fall back to Vulkan with the full context and quarantine the failed path',async t=>{
 const {services,events}=await fixture(t,'cuda-kernel','auto','win32','CUDA0: NVIDIA fixture (32768 MiB, 31000 MiB free)\nVulkan0: NVIDIA fixture (32768 MiB, 31000 MiB free)');
 await services.prepare(alphaModels.alias,24576);assert.equal(services.capabilities.backend,'vulkan');assert.deepEqual(services.capabilities.failures,[{backend:'cuda',device:'CUDA0',reason:'gpu-driver'}]);
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));assert.equal(launches.length,2);
 for(const launch of launches)assert.equal(launch.args[launch.args.indexOf('--ctx-size')+1],'24576');assert.throws(()=>process.kill(launches[0].pid,0));
 for(const log of ['CUDA driver version is insufficient for CUDA runtime version','CUDA_ERROR_UNSUPPORTED_PTX_VERSION','cudaErrorNoKernelImageForDevice'])assert.equal(gpuFailureReason(log,'inference'),'gpu-driver');
 assert.equal(gpuFailureReason('no kernel image is available; invalid model magic','inference'),null);
});

test('Metal and integrated devices with unknown memory are tested instead of rejected',async t=>{
 for(const [platform,inventory,backend,id] of [
  ['darwin','Metal: Apple GPU (0 MiB, 0 MiB free)','metal','Metal'],
  ['linux','Vulkan0: Integrated GPU (0 MiB, 0 MiB free)','vulkan','Vulkan0'],
 ] as const){
  const {services}=await fixture(t,'','auto',platform,inventory);
  await services.prepare(alphaModels.alias,24576);
  assert.equal(services.capabilities.backend,backend);assert.equal(services.capabilities.device,id);
  assert.equal(services.capabilities.devices?.[0].freeMiB,null);assert.equal(services.capabilities.inferenceVerified,true);
 }
});

test('35B performance target keeps the full context and places experts on the selected GPU with measured batches',async t=>{
 const {services,events}=await fixture(t,'','auto','linux','CUDA0: RTX 5090 fixture (32768 MiB, 31000 MiB free)\nVulkan0: RTX 5090 fixture (32768 MiB, 31000 MiB free)');
 const devices=await services.calibrationDevices(24576,new AbortController().signal);assert.equal(devices.length,2);
 const target=devices.find(device=>device.backend==='vulkan')!;
 await services.prepare('bambi-qwen36-35b-hauhau:iq3_m',24576,undefined,'default',false,{accelerator:'auto',threads:6,batchSize:1024,microBatchSize:256,deviceId:runtimeDeviceId(target),cpuMoeLayers:0});
 assert.equal(services.capabilities.backend,'vulkan');assert.equal(services.capabilities.offloadedLayers,20);
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));assert.equal(launches.length,1);
 const args=launches[0].args,value=(flag:string)=>args[args.indexOf(flag)+1];
 assert.equal(value('--n-cpu-moe'),'0');assert.equal(value('--ctx-size'),'24576');assert.equal(value('--device'),'Vulkan0');assert.equal(value('--batch-size'),'1024');assert.equal(value('--ubatch-size'),'256');
});
test('explicit GPU zero-offload fails without silently measuring a CPU fallback',async t=>{
 const {services,events}=await fixture(t,'zero-offload');const devices=await services.calibrationDevices(24576,new AbortController().signal);
 await assert.rejects(services.prepare(alphaModels.alias,24576,undefined,'default',false,{accelerator:'auto',threads:6,batchSize:512,microBatchSize:128,deviceId:runtimeDeviceId(devices[0])}),/did not offload/);
 const launches=(await events()).filter(row=>row.args?.includes('--gpu-layers'));assert.equal(launches.length,1);assert.throws(()=>process.kill(launches[0].pid,0));assert.equal(services.modelReady,false);
});
