// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,lstat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelCalibration,CalibrationProfiles,calibrationHash,calibrationConfigurations,calibrationPerformance,calibrationModels,type CalibrationInput,type CalibrationOperations,type CalibrationProfile} from '../packages/runtime/model-calibration';
import {runtimeDeviceId,validateRuntimeTuning} from '../packages/runtime/runtime-tuning.mjs';
import {InferenceQueue} from '../packages/ai/inference';
import type {Message} from '../packages/ai';
import {calibrationContext} from '../packages/runtime/calibration-context';
import type {RuntimeTuning} from '../packages/runtime/runtime-tuning.mjs';

const input:CalibrationInput={model:'bambi-qwen35-2b-hauhau:q4_k_m',context:24576,base:'COMPLETE PERSONA\nCOMPLETE ENABLED COLLAR\nCOMPLETE STRATEGY',sampling:'qwen',interaction:'reactive',conversationTopic:'general',key:calibrationHash('fixture'),cpuThreads:8,batchSize:512,microBatchSize:128,speech:false};
function fixture(overrides:Partial<CalibrationOperations>={}){
 let held=false,stops=0;const requests:Message[][]=[],preparations:unknown[]=[],saved:CalibrationProfile[]=[];
 const operations:CalibrationOperations={
  exclusive:async work=>{assert(!held);held=true;try{return await work();}finally{held=false;}},
  prepare:async tuning=>{assert(held);preparations.push(tuning);},stop:async()=>{assert(held);stops++;},
  capabilities:()=>({backend:'cpu',offloadedLayers:0}),memory:()=>({available:2**30,hostBytes:512*2**20}),
  backend:{name:'llama.cpp',models:async()=>[input.model],countTokens:async(_messages,signal)=>{signal.throwIfAborted();return 1500;},async *stream(messages,_model,signal,context,maxTokens,sampling){assert(held);signal.throwIfAborted();assert.equal(context,24576);assert.equal(maxTokens,96);assert.equal(sampling,'qwen');requests.push(structuredClone(messages));yield {text:'A short break can help. Return when ready.'};yield {text:'',stats:{eval_count:24,eval_duration:1e9,prompt_tokens:100,cache_tokens:1400}};}},
  save:async(profile,signal)=>{assert(held);signal.throwIfAborted();saved.push(profile);},...overrides,
 };
 return {operations,requests,preparations,saved,get stops(){return stops;},get held(){return held;}};
}
test('comparison retains separate public CUDA versions in saved results and winner summaries',async()=>{
 const devices=[12,13].map(version=>({backend:'cuda' as const,id:'CUDA0',name:'NVIDIA fixture',totalMiB:32768,freeMiB:31000,backendPath:`/owned/cuda_v${version}/libggml-cuda.so`}));
 let tuning:RuntimeTuning|undefined;
 const f=fixture({prepare:async value=>{tuning=value;},devices:async()=>devices,capabilities:()=>tuning?.accelerator==='cpu'?{backend:'cpu',offloadedLayers:0}:{backend:'cuda',cudaVersion:tuning?.deviceId===runtimeDeviceId(devices[0])?12:13,device:'NVIDIA fixture',offloadedLayers:41}});
 const calibration=new ModelCalibration();calibration.start(input,f.operations);await calibration.settled();
 assert.equal(calibration.state.phase,'complete');const profile=f.saved[0];
 assert(profile.results.some(result=>result.cudaVersion===12));assert(profile.results.some(result=>result.cudaVersion===13));
 assert(profile.results.filter(result=>result.backend==='cpu').every(result=>result.cudaVersion===undefined));
 assert.equal(calibrationPerformance(profile)?.cudaVersion,profile.results[profile.winner!].cudaVersion);
 assert(!JSON.stringify(profile).includes('/owned/'));
});

test('calibration retains full authored instructions and context, evolves history, repeats the winner and saves only metadata',async()=>{
 const f=fixture(),calibration=new ModelCalibration();calibration.start(input,f.operations);await calibration.settled();
 assert.equal(calibration.state.phase,'complete');assert(!calibration.busy);assert(!f.held);assert.equal(f.saved.length,1);
 const profile=f.saved[0];assert.equal(profile.results.length,4);assert.equal(profile.winner,3);assert.equal(f.requests.length,16);assert.equal(f.preparations.length,5);
 assert.deepEqual(f.preparations.at(-1),profile.results[profile.winner!].tuning);
 for(const request of f.requests)for(const section of ['COMPLETE PERSONA','COMPLETE ENABLED COLLAR','COMPLETE STRATEGY'])assert(request.map(m=>m.content).join('\n').includes(section));
 assert(f.requests[1].some(m=>m.role==='assistant'&&m.content.includes('A short break')));
 assert(!f.requests[4].some(m=>m.role==='assistant'&&m.content.includes('A short break')));
 for(const result of profile.results){assert.deepEqual(result.samples.map(s=>s.cold),[true,false,false,false]);assert.equal(result.peakHostBytes,512*2**20);}
 const measured=calibrationPerformance(profile)!;assert.equal(measured.scope,'text-measured');assert.equal(measured.quality,'unreviewed');assert.equal(measured.tokensPerSecond,24);
 assert(!JSON.stringify(profile).includes('COMPLETE PERSONA'));assert(!JSON.stringify(profile).includes('A short break'));
});

test('cancellation closes active speech and runtime, releases the slot and does not save a profile',async()=>{
 let speechClosed=false,started!:()=>void;const gate=new Promise<void>(resolve=>started=resolve),f=fixture({speech:signal=>new Promise<void>((_resolve,reject)=>{started();signal.addEventListener('abort',()=>{speechClosed=true;reject(signal.reason);},{once:true});})});
 const calibration=new ModelCalibration();calibration.start({...input,speech:true},f.operations);await gate;calibration.cancel();await calibration.settled();
 assert.equal(calibration.state.phase,'cancelled');assert(speechClosed);assert(f.stops>=1);assert(!f.held);assert.equal(f.saved.length,0);
});

test('incomplete or low-headroom results cannot become automatic settings',async()=>{
 for(const memory of [64*2**20,200*2**20,NaN]){
  const f=fixture({memory:()=>({available:memory})}),calibration=new ModelCalibration();calibration.start(input,f.operations);await calibration.settled();
  assert.equal(calibration.state.phase,'failed');assert.equal(f.saved.length,0);assert.equal(calibration.state.profile?.winner,null);assert(f.stops>=3);
 }
});

test('unverified GPU use is not accepted as a measured backend',async()=>{
 const f=fixture({capabilities:()=>({backend:null})}),calibration=new ModelCalibration();calibration.start(input,f.operations);await calibration.settled();
 assert.equal(calibration.state.phase,'failed');assert.equal(f.requests.length,0);assert.equal(f.saved.length,0);
});
test('whitespace, hidden voice markers and presentation actions are not counted as visible content',async()=>{
 const f=fixture(),backend={...f.operations.backend,async *stream(){yield {text:' \n[owner][pause:500]'};yield {text:'<action>{"type":"scene","scene":"Soft Pink"}</action>'};}},calibration=new ModelCalibration();
 calibration.start(input,{...f.operations,backend});await calibration.settled();assert.equal(calibration.state.phase,'failed');assert.equal(f.saved.length,0);
});
test('audio workload uses different uncached public phrases and reports synthesis rather than audible playback',async()=>{
 const phrases:string[]=[],f=fixture({speech:async(_signal,text)=>{phrases.push(text);}}),calibration=new ModelCalibration();calibration.start({...input,speech:true},f.operations);await calibration.settled();
 assert.equal(calibration.state.phase,'complete');assert.equal(new Set(phrases).size,16);assert(phrases.every(text=>text.startsWith('Sample ')&&text.length<180));
 assert.equal(calibrationPerformance(f.saved[0])?.scope,'text-and-synthesis-measured');
});

test('a failed repeat rejects the provisional winner',async()=>{
 let loads=0;const f=fixture({prepare:async()=>{if(++loads===4)throw Error('Repeat failed.');}}),calibration=new ModelCalibration();calibration.start(input,f.operations);await calibration.settled();
 assert.equal(calibration.state.phase,'failed');assert.equal(calibration.state.profile?.winner,null);assert.equal(f.saved.length,0);
});
test('a fast first token cannot select a configuration with slower sustained generation',async()=>{
 let threads=0;const f=fixture({prepare:async tuning=>{threads=tuning.threads;}}),backend={...f.operations.backend,async *stream(){yield {text:'A short visible response.'};yield {text:'',stats:{eval_count:threads===3?48:4,eval_duration:1e9}};}},calibration=new ModelCalibration();
 calibration.start(input,{...f.operations,backend});await calibration.settled();assert.equal(calibration.state.phase,'complete');assert.equal(f.saved[0].results.at(-1)?.tuning.threads,3);
});
test('missing generation timing cannot select automatic settings',async()=>{
 const f=fixture(),backend={...f.operations.backend,async *stream(){yield {text:'A short visible response.'};}},calibration=new ModelCalibration();
 calibration.start(input,{...f.operations,backend});await calibration.settled();assert.equal(calibration.state.phase,'failed');assert.equal(f.saved.length,0);
});

test('calibration waits for the shared native/Ollama slot; cancelling the wait never prepares or stops another owner',async()=>{
 const queue=new InferenceQueue();let release!:()=>void;const other=queue.run(()=>new Promise<void>(resolve=>release=resolve),new AbortController().signal);await Promise.resolve();
 const f=fixture({exclusive:(work,signal)=>queue.run(work,signal)}),calibration=new ModelCalibration();calibration.start(input,f.operations);await Promise.resolve();
 assert.equal(f.preparations.length,0);calibration.cancel();await calibration.settled();assert.equal(f.stops,0);assert.equal(calibration.state.phase,'cancelled');release();await other;
});

test('bounded tuning rejects injected arguments and leaves a core budget for voice',()=>{
 assert.deepEqual(calibrationConfigurations(8,512,128).map(c=>c.threads),[6,6,3]);assert.equal(calibrationConfigurations(1,128,32).length,2);
 assert(calibrationConfigurations(8,512,128,'cpu').every(tuning=>tuning.accelerator==='cpu'));
 const valid={accelerator:'cpu',threads:3,batchSize:128,microBatchSize:32};assert.deepEqual(validateRuntimeTuning(valid),valid);
 for(const invalid of [{...valid,command:'evil'},{...valid,threads:64},{...valid,accelerator:'CUDA0'},{...valid,batchSize:2048},{...valid,microBatchSize:64}])assert.throws(()=>validateRuntimeTuning(invalid));
});

test('private profiles are atomic, bounded, expire and reject malformed, future or symlinked files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bambi-calibration-')),path=join(directory,'profiles.json'),profiles=new CalibrationProfiles(path);
 try{
  const f=fixture(),calibration=new ModelCalibration();calibration.start(input,f.operations);await calibration.settled();const profile=f.saved[0];
  await profiles.save(profile,new AbortController().signal);if(process.platform!=='win32')assert.equal((await lstat(path)).mode&0o777,0o600);assert.equal((await profiles.find(input.key))?.winner,3);
  const signal=AbortSignal.abort();await assert.rejects(profiles.save({...profile,key:calibrationHash('cancelled')},signal));assert.equal((await profiles.list()).length,1);
  await writeFile(path,JSON.stringify([{...profile,createdAt:Date.now()-8*86400000}]));assert.equal(await profiles.find(input.key),undefined);
  await writeFile(path,JSON.stringify([{...profile,createdAt:Date.now()+86400000}]));assert.equal(await profiles.find(input.key),undefined);
  await writeFile(path,JSON.stringify([{...profile,unexpected:'command'}]));assert.deepEqual(await profiles.list(),[]);
  await writeFile(path,'x'.repeat(2*1024*1024+1));assert.deepEqual(await profiles.list(),[]);
  await rm(path);await writeFile(join(directory,'target'),JSON.stringify([profile]));await symlink(join(directory,'target'),path);assert.deepEqual(await profiles.list(),[]);
  assert(!JSON.stringify(JSON.parse(await readFile(join(directory,'target'),'utf8'))).includes(input.base));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('profile identity invalidates changed authored content, runner build, voice assets and speech CPU settings',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bambi-calibration-identity-')),previous=process.cwd(),environment={models:process.env.BAMBI_MODELS_ROOT,threads:process.env.BAMBI_TTS_THREADS};
 try{
  process.chdir(directory);delete process.env.BAMBI_MODELS_ROOT;delete process.env.BAMBI_TTS_THREADS;
  const {mkdir}=await import('node:fs/promises');for(const dir of ['.runtime/lib/ollama','.runtime/tts-venv/bin','models/kokoro'])await mkdir(dir,{recursive:true});
  await writeFile('.runtime/lib/ollama/llama-server','fixture runner');await writeFile('.runtime/tts-venv/bin/python','fixture interpreter');
  await writeFile('models/kokoro/kokoro-v1.0.onnx','fixture speech');await writeFile('models/kokoro/voices-v1.0.bin','fixture voices');
  const profile={'prompt-template':'bambisleep-classic',persona:'Fixture persona','collar-enabled':true,'collar-name':'Fixture collar'};
  const context=await calibrationContext(input.model,profile,false);assert(context.input.base.includes('Fixture collar'));assert.equal(context.input.context,24576);
  assert.equal((await calibrationContext(input.model,profile,false)).input.key,context.input.key);
  assert.notEqual((await calibrationContext(input.model,{...profile,'collar-name':'Changed collar'},false)).input.key,context.input.key);
  const custom={...profile,'prompt-template':'custom'};assert.notEqual((await calibrationContext(input.model,custom,false)).input.key,(await calibrationContext(input.model,{...custom,persona:'Changed persona'},false)).input.key);
  await writeFile('.runtime/lib/ollama/llama-server','changed fixture runner');assert.notEqual((await calibrationContext(input.model,profile,false)).input.key,context.input.key);
  if(process.platform!=='darwin'){
  await mkdir('.runtime/lib/ollama/cuda_v13',{recursive:true});
  const plugin=process.platform==='win32'?'ggml-cuda.dll':'libggml-cuda.so',blas=process.platform==='win32'?'cublas64_13.dll':'libcublas.so.13';
  await writeFile('.runtime/lib/ollama/cuda_v13/'+plugin,'fixture CUDA');await writeFile('.runtime/lib/ollama/cuda_v13/'+blas,'fixture cuBLAS');
  const cuda=await calibrationContext(input.model,profile,false);await writeFile('.runtime/lib/ollama/cuda_v13/'+blas,'changed fixture cuBLAS');
  assert.notEqual((await calibrationContext(input.model,profile,false)).input.key,cuda.input.key);
  }
  const voice=await calibrationContext(input.model,profile,true);await writeFile('models/kokoro/voices-v1.0.bin','changed fixture voices');assert.notEqual((await calibrationContext(input.model,profile,true)).input.key,voice.input.key);
  const current=await calibrationContext(input.model,profile,true);process.env.BAMBI_TTS_THREADS='2';assert.notEqual((await calibrationContext(input.model,profile,true)).input.key,current.input.key);
 }finally{
  process.chdir(previous);for(const [name,value] of [['BAMBI_MODELS_ROOT',environment.models],['BAMBI_TTS_THREADS',environment.threads]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  await rm(directory,{recursive:true,force:true});
 }
});

test('comparison includes reference 9B, Defiant Fable and 35B, saves separately and restores the user selection',async()=>{
 assert.equal(calibrationModels.length,6);
 for(const model of ['bambi-qwen35-9b-hauhau:q4_k_m','bambi-qwen35-9b-defiant-fable:iq4_xs','bambi-qwen36-35b-hauhau:iq3_m'])assert(calibrationModels.includes(model));
 const f=fixture(),calibration=new ModelCalibration();let restored=0;
 const models=calibrationModels.map(model=>({...input,model,key:calibrationHash(model)}));
 calibration.start(models,()=>f.operations,async()=>{assert(!f.held);restored++;});await calibration.settled();
 assert.equal(restored,1);assert.equal(calibration.state.phase,'complete');assert.equal(calibration.state.modelCount,6);assert.equal(f.saved.length,6);
 assert.deepEqual(f.saved.map(profile=>profile.model),calibrationModels);assert.equal(new Set(f.saved.map(profile=>profile.key)).size,6);
 assert.equal(calibration.state.profiles?.length,6);assert.deepEqual(calibration.state.modelErrors,[]);
});
test('comparison records one failed model and continues without marking it as measured',async()=>{
 const good=fixture(),bad=fixture({prepare:async()=>{throw Error('Model cannot load on this PC.');}}),calibration=new ModelCalibration();
 const second={...input,model:'bambi-qwen36-35b-hauhau:iq3_m',key:calibrationHash('35b')};
 calibration.start([second,input],item=>item.model===second.model?bad.operations:good.operations);await calibration.settled();
 assert.equal(calibration.state.phase,'complete');assert.equal(calibration.state.modelErrors?.length,1);assert.equal(bad.saved.length,0);assert.equal(good.saved.length,1);
 assert.equal(calibrationPerformance(calibration.state.profiles![0]),null);
});
test('cancelled comparison restores selection and never starts a later model',async()=>{
 let started!:()=>void,restored=false;const gate=new Promise<void>(resolve=>started=resolve);
 const first=fixture({prepare:async(_tuning,signal)=>{started();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}),later=fixture(),calibration=new ModelCalibration();
 calibration.start([input,{...input,model:'bambi-qwen36-35b-hauhau:iq3_m'}],item=>item.model===input.model?first.operations:later.operations,async()=>{restored=true;});
 await gate;calibration.cancel();await calibration.settled();assert(restored);assert.equal(later.preparations.length,0);assert.equal(later.stops,0);assert.equal(calibration.state.phase,'cancelled');
});
test('high-end comparison targets CUDA and Vulkan independently, tests large batches and GPU expert placement, and bounds the sweep',()=>{
 const devices=[{backend:'cuda' as const,id:'CUDA0',name:'RTX 5090 fixture',totalMiB:32768,freeMiB:31000},{backend:'vulkan' as const,id:'Vulkan0',name:'RTX 5090 fixture',totalMiB:32768,freeMiB:31000}];
 const configs=calibrationConfigurations(32,512,128,'auto',devices,'bambi-qwen36-35b-hauhau:iq3_m');
 assert(configs.some(item=>item.accelerator==='cpu'&&item.threads===28));
 for(const device of devices){const targeted=configs.filter(item=>item.deviceId===runtimeDeviceId(device));assert.equal(targeted.length,2);assert(targeted.every(item=>item.cpuMoeLayers===0));assert(targeted.some(item=>item.batchSize===1024&&item.microBatchSize===256));}
 assert(calibrationConfigurations(64,512,128,'auto',Array.from({length:32},(_,i)=>({...devices[0],id:'CUDA'+i})),'35b').length+1<=40);
 assert(calibrationConfigurations(32,512,128,'cpu',devices,'35b').every(item=>item.accelerator==='cpu'&&!item.deviceId));
});
test('an explicit GPU attempt that falls back to CPU cannot win as GPU evidence',async()=>{
 const f=fixture({devices:async()=>[{backend:'cuda',id:'CUDA0',name:'High-end fixture',totalMiB:32768,freeMiB:31000}]}),calibration=new ModelCalibration();
 calibration.start(input,f.operations);await calibration.settled();assert.equal(calibration.state.phase,'complete');
 const targets=f.saved[0].results.filter(result=>result.tuning.deviceId);assert.equal(targets.length,2);assert(targets.every(result=>!!result.error&&result.samples.length===0));assert(!calibrationPerformance(f.saved[0])!.tuning.deviceId);
});
