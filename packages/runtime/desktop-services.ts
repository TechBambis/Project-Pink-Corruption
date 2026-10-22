// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {spawn,type ChildProcess} from 'node:child_process';
import {openSync,closeSync,readFileSync,fstatSync,readSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {resourcePath} from './paths';
import {llamaExecutable,speechExecutable} from './executables';
import {downloadableModel,modelAsset} from '../ai/model-catalog';
import {acceleratorMode,acceleratorCandidates,deviceKey,cudaVersion,gpuFailureReason,offloadEvidence,desktopMemoryReserveMiB,type AcceleratorDevice,type GpuBackend} from './accelerator-policy';
import {acceleratorPlan} from './accelerator-runtime.mjs';
import {ServiceLifecycle} from './service-lifecycle';
import {validateKvCache,type KvCacheMode} from './kv-cache';
import {performanceSnapshot} from '../hardware';
import {resourcePlan,type ResourcePlan} from './resource-plan';
import {validateRuntimeTuning,type RuntimeTuning} from './runtime-tuning.mjs';

type Command={executable:string;prefix?:string[]};
export interface DesktopServicesOptions {
 environment?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;llama?:Command;speech?:Command;
 logsDirectory?:string;libraryDirectory?:string;startupTimeoutMs?:number;probeTimeoutMs?:number;
 memory?:()=>{total:number;available:number};
}
class RuntimeFailure extends Error {
 constructor(message:string,readonly kind:'exit'|'timeout'|'inference'|'invariant'){super(message);}
}
/** Children inherit the backend's private Windows job or POSIX process group. */
export class DesktopServices {
 private llama:ChildProcess|null=null;private speech:ChildProcess|null=null;
 private lifecycle=new ServiceLifecycle({
  ready:(model,context,profile)=>this.modelReady&&this.speechReady&&this.loadedModel===model&&this.report.context===context&&this.loadedProfile===profile,
  start:(model,context,signal,profile)=>this.start(model,context,signal,profile),
  stop:()=>this.closeServices(),
 });
 private llamaValidated=false;private speechValidated=false;private loadedModel:string|null=null;
 private loadedCache:KvCacheMode|null=null;
 private loadedProfile:string|null=null;
 private allocation:ResourcePlan|null=null;
 private blockedDevices=new Map<string,string>();private inventory:AcceleratorDevice[]|undefined;
 private readonly env:NodeJS.ProcessEnv;private readonly platform:NodeJS.Platform;
 private readonly library:string;private readonly logs:string;
 private readonly llamaCommand:Command;private readonly speechCommand:Command;
 private logStart=0;
 private report:{phase:'stopped'|'probing'|'loading'|'ready'|'failed';requested:'auto'|'cpu';backend:'cpu'|GpuBackend|'unverified'|null;cudaVersion?:12|13;device?:string;deviceName?:string;attempts:number;context?:number;reserveMiB:number;fallbackReason?:string;offloadedLayers?:number;totalLayers?:number;inferenceVerified:boolean;inferenceMs?:number;failures?:{backend:GpuBackend;device:string;reason:string}[]}={phase:'stopped',requested:'auto',backend:null,attempts:0,reserveMiB:desktopMemoryReserveMiB,inferenceVerified:false};
 constructor(private readonly options:DesktopServicesOptions={}){
  this.env=options.environment??process.env;this.platform=options.platform??process.platform;
  this.library=options.libraryDirectory??resourcePath('native/llama');this.logs=options.logsDirectory??resolve('logs');
  this.llamaCommand=options.llama??{executable:llamaExecutable()};this.speechCommand=options.speech??{executable:speechExecutable()};
 }
 get modelReady(){return this.llamaValidated&&this.alive(this.llama);}
 get speechReady(){return this.speechValidated&&this.alive(this.speech);}
 async calibrationDevices(context:number,signal:AbortSignal){
  const plan=await acceleratorPlan({command:this.llamaCommand,library:this.library,platform:this.platform,environment:this.env,mode:'auto',context,blocked:[...this.blockedDevices.keys()],probeTimeoutMs:this.options.probeTimeoutMs,signal});
  this.inventory=plan.devices;return acceleratorCandidates(plan.devices,this.platform,[...this.blockedDevices.keys()],16);
 }
 get state(){return this.lifecycle.state;}
 get capabilities(){return {...this.report,resourcePlan:this.allocation,cacheType:this.loadedCache==='q8_0'?'q8_0':'f16',devices:this.inventory?.map(({id,backend,name,totalMiB,freeMiB})=>({id,backend,name,totalMiB,freeMiB})),phase:this.state.phase==='failed'?'failed':this.report.phase,ready:this.modelReady,speech:{synthesis:{backend:'cpu',ready:this.speechReady},recognition:{backend:'cpu',qualification:'cpu-only'}}};}
 private memory(){if(this.options.memory)return this.options.memory();const value=performanceSnapshot();return {total:value.ramTotal,available:value.ramFree};}
 private alive(child:ChildProcess|null){return !!child&&!!child.pid&&child.exitCode===null&&child.signalCode===null;}
 private async freePort(port:number){
  await new Promise<void>((accept,reject)=>{const probe=createServer();probe.once('error',()=>reject(Error('Port '+port+' is occupied. Quit this app and retry with another --bambi-port. No unrelated process was stopped.')));probe.listen(port,'127.0.0.1',()=>probe.close(()=>accept()));});
 }
 private launch(command:Command,args:string[],name:string,env=this.env){
  const log=openSync(resolve(this.logs,name+'.log'),'a',0o600);
  try{
   if(name==='llama')this.logStart=fstatSync(log).size;
   const child=spawn(command.executable,[...(command.prefix??[]),...args],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore',log,log]});child.on('error',()=>{});return child;
  }finally{closeSync(log);}
 }
 private currentLog(){
  try{const fd=openSync(resolve(this.logs,'llama.log'),'r');try{const size=fstatSync(fd).size,start=Math.max(this.logStart,size-65536),bytes=Buffer.alloc(Math.max(0,size-start));readSync(fd,bytes,0,bytes.length,start);return bytes.toString('utf8');}finally{closeSync(fd);}}catch{return '';}
 }
 private async wait(child:ChildProcess,url:string,headers:Record<string,string>,check:(value:any)=>boolean,signal:AbortSignal){
  const deadline=Date.now()+(this.options.startupTimeoutMs??120000);
  while(Date.now()<deadline){
   signal.throwIfAborted();
   if(!this.alive(child))throw new RuntimeFailure('Owned service stopped during preparation. See logs.','exit');
   try{const response=await fetch(url,{headers,signal:AbortSignal.any([AbortSignal.timeout(600),signal])});if(response.ok&&check(await response.json()))return;}catch{signal.throwIfAborted();}
   await new Promise(r=>setTimeout(r,150));
  }
  throw new RuntimeFailure('Owned service exceeded its preparation deadline. See logs.','timeout');
 }
 private async verifyInference(context:number,signal:AbortSignal){
  const headers={Authorization:'Bearer '+this.env.BAMBI_LLM_TOKEN,'Content-Type':'application/json'};
  const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
  const props=await fetch(this.env.BAMBI_LLM_URL!+'/props',{headers,signal:requestSignal});
  if(!props.ok)throw new RuntimeFailure('Local AI could not report its full context.','invariant');
  const settings=await props.json() as {default_generation_settings?:{n_ctx?:number}};
  if(settings.default_generation_settings?.n_ctx!==context)throw new RuntimeFailure('Local AI changed the selected model’s full context. Preparation stopped.','invariant');
  const response=await fetch(this.env.BAMBI_LLM_URL!+'/completion',{method:'POST',headers,signal:requestSignal,body:JSON.stringify({prompt:'A public runtime test.',n_predict:1,stream:false,temperature:0,cache_prompt:false})});
  if(!response.ok)throw new RuntimeFailure('Local AI failed its inference check. See logs.','inference');
  const completion=await response.json() as {content?:string;tokens_predicted?:number};
  if(typeof completion.content!=='string'||!Number.isInteger(completion.tokens_predicted)||completion.tokens_predicted!<1)throw new RuntimeFailure('Local AI returned an invalid inference check.','inference');
  signal.throwIfAborted();
 }
 async prepare(model:string,context:number,signal?:AbortSignal,kvCache:KvCacheMode='default',tryAnyway=false,tuning?:RuntimeTuning){
  if(tuning){tuning=validateRuntimeTuning(tuning);if(kvCache!=='default'||tuning.cpuMoeLayers!==undefined&&!model.includes('35b'))throw Error('Measured settings require the default cache and a matching model architecture.');}
  validateKvCache(kvCache,model,this.platform);
  const selected=downloadableModel(model);
  if(context!==selected.context)throw Error('Use the selected model’s full configured context.');
  const plan=resourcePlan({ramTotal:this.memory().total},{weightsBytes:selected.bytes,contextTokens:context,memoryProfile:selected.memoryProfile,resourceProfile:selected.resourceProfile});
  if(!tryAnyway&&plan.estimatedWorkingBytes!==null&&plan.estimatedWorkingBytes>this.memory().total-plan.reserveBytes)throw Error('This model and its full companion instructions exceed the memory budget. Choose a smaller model, or explicitly enable Try anyway in setup.');
  await this.lifecycle.prepare(model,context,signal,JSON.stringify({kvCache,plan,tryAnyway,...(tuning?{tuning}:{})}));
 }
 private async start(model:string,context:number,signal:AbortSignal,profile:string){
  const {kvCache,plan:originalPlan,tryAnyway,tuning}=JSON.parse(profile) as {kvCache:KvCacheMode;plan:ResourcePlan;tryAnyway:boolean;tuning?:RuntimeTuning};
  const allocation=tuning?{...originalPlan,batchSize:tuning.batchSize,microBatchSize:tuning.microBatchSize}:originalPlan;
  this.allocation=allocation;
  try{
   signal.throwIfAborted();
   const requested=acceleratorMode(tuning?.accelerator??this.env.BAMBI_DESKTOP_ACCELERATOR);
   this.report=this.modelReady&&this.loadedModel===model?{...this.report,phase:'loading'}:{phase:'loading',requested,backend:null,attempts:0,context,reserveMiB:desktopMemoryReserveMiB,inferenceVerified:false};
   if(!this.modelReady){
    // Detect conflicts before probing/retrying. Never reuse or stop their listeners.
    await this.freePort(Number(this.env.BAMBI_LLM_PORT));
    await this.closeLlama();
    this.report.phase=requested==='auto'?'probing':'loading';
    const plan=await acceleratorPlan({command:this.llamaCommand,library:this.library,platform:this.platform,environment:this.env,mode:requested,context,blocked:[...this.blockedDevices.keys()],devices:this.inventory,probeTimeoutMs:this.options.probeTimeoutMs,signal,deviceId:tuning?.deviceId});
    if(requested==='auto')this.inventory=plan.devices;
    this.report.fallbackReason=plan.fallbackReason;
    if(requested==='auto'&&plan.attempts.length===1&&this.blockedDevices.size)this.report.fallbackReason=[...this.blockedDevices.values()].at(-1);
    this.report.failures=[];
    for(const attempt of plan.attempts){
     if(tuning)for(const flag of ['--threads','--threads-batch'])attempt.args[attempt.args.indexOf(flag)+1]=String(tuning.threads);
     signal.throwIfAborted();const device=attempt.device,cpu=device===null;
     // This runs after the lifecycle has released our old workers. Never ask a
     // loaded model to compete against its own footprint or kill other apps.
     if(!tryAnyway&&cpu&&allocation.estimatedWorkingBytes!==null&&this.memory().available<allocation.estimatedWorkingBytes+256*2**20)throw Error('Not enough available RAM to start this model on the CPU. Close other apps and retry, choose a smaller model, or explicitly enable Try anyway in setup. Verified files are kept.');
     this.report.phase='loading';this.report.attempts++;
     this.report.device=device?.id;this.report.deviceName=device?.name;
     this.report.cudaVersion=cudaVersion(device);
     this.report.offloadedLayers=undefined;this.report.totalLayers=undefined;this.report.inferenceVerified=false;this.report.inferenceMs=undefined;
     const args=[
      '-m',resolve(this.env.BAMBI_MODELS_ROOT!,modelAsset(model).path),'--alias',model,
      '--host','127.0.0.1','--port',this.env.BAMBI_LLM_PORT!,'--api-key',this.env.BAMBI_LLM_TOKEN!,
      '--ctx-size',String(context),'--parallel','1','--batch-size',String(allocation.batchSize),'--ubatch-size',String(allocation.microBatchSize),
      '--poll','0','--poll-batch','0','--ctx-checkpoints',String(allocation.checkpoints),'--checkpoint-min-step','512','--cache-ram',String(allocation.promptCacheMiB),
      '--log-verbosity','4',
      ...attempt.args,
      ...(tuning?.cpuMoeLayers!==undefined?['--n-cpu-moe',String(tuning.cpuMoeLayers)]:[]),
      '--flash-attn','on','--jinja','--reasoning','off','--no-webui','--n-predict','8192','--cache-type-k',kvCache==='default'?'f16':kvCache,'--cache-type-v',kvCache==='default'?'f16':kvCache,
      ...(downloadableModel(model).samplingProfile?['--chat-template-kwargs','{"enable_thinking":false}','--verbosity','4']:[]),
     ];
     this.llama=this.launch(this.llamaCommand,args,'llama',attempt.environment);
     try{
      await this.wait(this.llama,this.env.BAMBI_LLM_URL!+'/v1/models',{Authorization:'Bearer '+this.env.BAMBI_LLM_TOKEN},v=>v.data?.some((a:any)=>a.id===model),signal);
      const inferenceStart=performance.now();
      try{await this.verifyInference(context,signal);}catch(error){
       signal.throwIfAborted();if(error instanceof RuntimeFailure)throw error;
       throw new RuntimeFailure('Local AI inference check could not complete.',!this.alive(this.llama)?'exit':error instanceof Error&&error.name==='TimeoutError'?'timeout':'inference');
      }
      if(!this.alive(this.llama))throw new RuntimeFailure('Owned AI stopped after inference.','exit');
      const evidence=offloadEvidence(this.currentLog());
      this.report.backend=cpu?'cpu':evidence?(evidence.offloadedLayers>0?device!.backend:'cpu'):'unverified';
      if(this.report.backend!=='cuda')delete this.report.cudaVersion;
      if(evidence)Object.assign(this.report,evidence);
      if(cpu)this.report.offloadedLayers=0;
      if(tuning?.deviceId&&this.report.backend!==device!.backend)throw new RuntimeFailure('The selected GPU path did not offload layers. It cannot be measured as GPU acceleration.','invariant');
      this.report.inferenceMs=Math.round(performance.now()-inferenceStart);
      if(!cpu&&evidence?.offloadedLayers===0)this.report.fallbackReason='runtime-selected-cpu';
      this.report.inferenceVerified=true;this.llamaValidated=true;this.loadedModel=model;this.loadedCache=kvCache;this.loadedProfile=profile;
      const owned=this.llama;
      owned.once('exit',()=>{
       if(this.llama!==owned||!this.llamaValidated)return;
       this.llamaValidated=false;this.report.phase='failed';
       if(device){
        this.blockedDevices.set(deviceKey(device),'gpu-runtime-stopped');this.report.fallbackReason='gpu-runtime-stopped';
       }
      });break;
     }catch(error){
      signal.throwIfAborted();
      const reason=!cpu&&error instanceof RuntimeFailure&&error.kind!=='invariant'?gpuFailureReason(this.currentLog(),error.kind):null;
      await this.closeLlama();
      if(!reason)throw error;
      this.blockedDevices.set(deviceKey(device!),reason);this.report.fallbackReason=reason;
      this.report.failures.push({backend:device!.backend,device:device!.id,reason});
     }
    }
   }
   if(!this.speechReady){
    signal.throwIfAborted();await this.freePort(Number(this.env.BAMBI_TTS_PORT));
    const manifest=JSON.parse(readFileSync(resourcePath('config/desktop-alpha-models.json'),'utf8'));
    this.speech=this.launch(this.speechCommand,['kokoro'],'kokoro');
    await this.wait(this.speech,this.env.BAMBI_TTS_URL!+'/desktop/identity',{'X-Bambi-TTS-Token':this.env.BAMBI_TTS_TOKEN!},v=>v.app==='bambi-local'&&v.service==='kokoro'&&v.protocol===1&&v.pid===this.speech?.pid&&v.instance===this.env.BAMBI_INSTANCE_TOKEN&&v.modelSha256===manifest.assets[1].sha256,signal);this.speechValidated=true;
   }
   signal.throwIfAborted();
   if(!this.modelReady||!this.speechReady)throw new RuntimeFailure('Owned AI service stopped during preparation.','exit');
   this.report.phase='ready';
  }catch(error){this.report.phase='failed';await this.closeServices();throw error;}
 }
 private async closeChild(child:ChildProcess|null){
  if(!this.alive(child))return;
  await new Promise<void>((accept,reject)=>{
   const exited=()=>{clearTimeout(force);clearTimeout(deadline);accept();};
   const force=setTimeout(()=>{try{child!.kill('SIGKILL');}catch{}},2000);
   const deadline=setTimeout(()=>{child!.removeListener('exit',exited);reject(Error('Owned service did not stop. Preparation will not start another service.'));},6000);
   child!.once('exit',exited);try{child!.kill('SIGTERM');}catch{}
  });
 }
 private async closeLlama(){this.llamaValidated=false;await this.closeChild(this.llama);this.llama=null;this.loadedModel=null;this.loadedCache=null;this.loadedProfile=null;}
 private async closeServices(){await Promise.all([this.closeLlama(),this.closeChild(this.speech).then(()=>{this.speech=null;this.speechValidated=false;})]);}
 async stop(){
  await this.lifecycle.stop();this.report.phase='stopped';
 }
}
export const desktopServices=new DesktopServices();
