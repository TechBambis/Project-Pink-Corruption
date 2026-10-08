// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {spawn,type ChildProcess} from 'node:child_process';
import {openSync,closeSync,readFileSync,fstatSync,readSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {resourcePath} from './paths';
import {llamaExecutable,speechExecutable} from './executables';
import {downloadableModel,modelAsset} from '../ai/model-catalog';
import {acceleratorMode,deviceKey,gpuFailureReason,offloadEvidence,desktopMemoryReserveMiB,type AcceleratorDevice,type GpuBackend} from './accelerator-policy';
import {acceleratorPlan} from './accelerator-runtime.mjs';
import {ServiceLifecycle} from './service-lifecycle';

type Command={executable:string;prefix?:string[]};
export interface DesktopServicesOptions {
 environment?:NodeJS.ProcessEnv;platform?:NodeJS.Platform;llama?:Command;speech?:Command;
 logsDirectory?:string;libraryDirectory?:string;startupTimeoutMs?:number;probeTimeoutMs?:number;
}
class RuntimeFailure extends Error {
 constructor(message:string,readonly kind:'exit'|'timeout'|'inference'|'invariant'){super(message);}
}
/** Children inherit the backend's private Windows job or POSIX process group. */
export class DesktopServices {
 private llama:ChildProcess|null=null;private speech:ChildProcess|null=null;
 private lifecycle=new ServiceLifecycle({
  ready:model=>this.modelReady&&this.speechReady&&this.loadedModel===model,
  start:(model,context,signal)=>this.start(model,context,signal),
  stop:()=>this.closeServices(),
 });
 private llamaValidated=false;private speechValidated=false;private loadedModel:string|null=null;
 private blockedDevices=new Map<string,string>();private inventory:AcceleratorDevice[]|undefined;
 private readonly env:NodeJS.ProcessEnv;private readonly platform:NodeJS.Platform;
 private readonly library:string;private readonly logs:string;
 private readonly llamaCommand:Command;private readonly speechCommand:Command;
 private logStart=0;
 private report:{phase:'stopped'|'probing'|'loading'|'ready'|'failed';requested:'auto'|'cpu';backend:'cpu'|GpuBackend|'unverified'|null;device?:string;deviceName?:string;attempts:number;context?:number;reserveMiB:number;fallbackReason?:string;offloadedLayers?:number;totalLayers?:number;inferenceVerified:boolean;inferenceMs?:number;failures?:{backend:GpuBackend;device:string;reason:string}[]}={phase:'stopped',requested:'auto',backend:null,attempts:0,reserveMiB:desktopMemoryReserveMiB,inferenceVerified:false};
 constructor(private readonly options:DesktopServicesOptions={}){
  this.env=options.environment??process.env;this.platform=options.platform??process.platform;
  this.library=options.libraryDirectory??resourcePath('native/llama');this.logs=options.logsDirectory??resolve('logs');
  this.llamaCommand=options.llama??{executable:llamaExecutable()};this.speechCommand=options.speech??{executable:speechExecutable()};
 }
 get modelReady(){return this.llamaValidated&&this.alive(this.llama);}
 get speechReady(){return this.speechValidated&&this.alive(this.speech);}
 get state(){return this.lifecycle.state;}
 get capabilities(){return {...this.report,devices:this.inventory?.map(({id,backend,name,totalMiB,freeMiB})=>({id,backend,name,totalMiB,freeMiB})),phase:this.state.phase==='failed'?'failed':this.report.phase,ready:this.modelReady,speech:{synthesis:{backend:'cpu',ready:this.speechReady},recognition:{backend:'cpu',qualification:'cpu-only'}}};}
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
 async prepare(model:string,context:number,signal?:AbortSignal){
  const selected=downloadableModel(model);
  if(context!==selected.context)throw Error('Use the selected model’s full configured context.');
  await this.lifecycle.prepare(model,context,signal);
 }
 private async start(model:string,context:number,signal:AbortSignal){
  try{
   signal.throwIfAborted();
   const requested=acceleratorMode(this.env.BAMBI_DESKTOP_ACCELERATOR);
   this.report=this.modelReady&&this.loadedModel===model?{...this.report,phase:'loading'}:{phase:'loading',requested,backend:null,attempts:0,context,reserveMiB:desktopMemoryReserveMiB,inferenceVerified:false};
   if(!this.modelReady){
    // Detect conflicts before probing/retrying. Never reuse or stop their listeners.
    await this.freePort(Number(this.env.BAMBI_LLM_PORT));
    await this.closeLlama();
    this.report.phase=requested==='auto'?'probing':'loading';
    const plan=await acceleratorPlan({command:this.llamaCommand,library:this.library,platform:this.platform,environment:this.env,mode:requested,context,blocked:[...this.blockedDevices.keys()],devices:this.inventory,probeTimeoutMs:this.options.probeTimeoutMs,signal});
    if(requested==='auto')this.inventory=plan.devices;
    this.report.fallbackReason=plan.fallbackReason;
    if(plan.attempts.length===1&&this.blockedDevices.size)this.report.fallbackReason=[...this.blockedDevices.values()].at(-1);
    this.report.failures=[];
    for(const attempt of plan.attempts){
     signal.throwIfAborted();const device=attempt.device,cpu=device===null;
     this.report.phase='loading';this.report.attempts++;
     this.report.device=device?.id;this.report.deviceName=device?.name;
     this.report.offloadedLayers=undefined;this.report.totalLayers=undefined;this.report.inferenceVerified=false;this.report.inferenceMs=undefined;
     const args=[
      '-m',resolve(this.env.BAMBI_MODELS_ROOT!,modelAsset(model).path),'--alias',model,
      '--host','127.0.0.1','--port',this.env.BAMBI_LLM_PORT!,'--api-key',this.env.BAMBI_LLM_TOKEN!,
      '--ctx-size',String(context),'--parallel','1','--threads','6','--threads-batch','6','--batch-size','512','--ubatch-size','128',
      '--poll','0','--poll-batch','0','--ctx-checkpoints','16','--checkpoint-min-step','512','--cache-ram','2048',
      ...attempt.args,
      '--flash-attn','on','--jinja','--reasoning','off','--no-webui','--n-predict','8192','--cache-type-k','f16','--cache-type-v','f16',
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
      if(evidence)Object.assign(this.report,evidence);
      if(cpu)this.report.offloadedLayers=0;
      this.report.inferenceMs=Math.round(performance.now()-inferenceStart);
      if(!cpu&&evidence?.offloadedLayers===0)this.report.fallbackReason='runtime-selected-cpu';
      this.report.inferenceVerified=true;this.llamaValidated=true;this.loadedModel=model;
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
 private async closeLlama(){this.llamaValidated=false;await this.closeChild(this.llama);this.llama=null;this.loadedModel=null;}
 private async closeServices(){await Promise.all([this.closeLlama(),this.closeChild(this.speech).then(()=>{this.speech=null;this.speechValidated=false;})]);}
 async stop(){
  await this.lifecycle.stop();this.report.phase='stopped';
 }
}
export const desktopServices=new DesktopServices();
