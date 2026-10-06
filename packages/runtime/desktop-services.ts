// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {spawn,type ChildProcess} from 'node:child_process';
import {openSync,closeSync,readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {resourcePath} from './paths';
import {llamaExecutable,speechExecutable} from './executables';

/** Children inherit the backend's private Windows job or POSIX process group. */
export class DesktopServices {
 private llama:ChildProcess|null=null;private speech:ChildProcess|null=null;
 private loading:Promise<void>|null=null;private llamaValidated=false;private speechValidated=false;
 get modelReady(){return this.llamaValidated&&!!this.llama&&this.llama.exitCode===null&&this.llama.signalCode===null;}
 get speechReady(){return this.speechValidated&&!!this.speech&&this.speech.exitCode===null&&this.speech.signalCode===null;}
 private async freePort(port:number){
  await new Promise<void>((accept,reject)=>{const probe=createServer();probe.once('error',()=>reject(Error(`Port ${port} is occupied. Quit this app and retry with another --bambi-port. No unrelated process was stopped.`)));probe.listen(port,'127.0.0.1',()=>probe.close(()=>accept()));});
 }
 private launch(executable:string,args:string[],name:string,env=process.env){
  const log=openSync(resolve('logs',name+'.log'),'a',0o600);
  try{const child=spawn(executable,args,{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore',log,log]});child.on('error',()=>{});return child;}finally{closeSync(log);}
 }
 private async wait(child:ChildProcess,url:string,headers:Record<string,string>,check:(value:any)=>boolean,signal?:AbortSignal){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
   signal?.throwIfAborted();
   if(!child.pid||child.exitCode!==null||child.signalCode!==null)throw Error('Owned service stopped during preparation. See logs.');
   try{const response=await fetch(url,{headers,signal:AbortSignal.any([AbortSignal.timeout(600),...(signal?[signal]:[])])});if(response.ok&&check(await response.json()))return;}catch{signal?.throwIfAborted();}
   await new Promise(r=>setTimeout(r,150));
  }
  throw Error('Owned service exceeded its preparation deadline. See logs.');
 }
 async prepare(model:string,context:number,signal?:AbortSignal){
  const manifest=JSON.parse(readFileSync(resourcePath('config/desktop-alpha-models.json'),'utf8'));
  if(model!==manifest.alias||context!==manifest.context)throw Error('This alpha requires its verified 9B model and full 24576-token context.');
  if(this.loading){await this.loading;signal?.throwIfAborted();return;}
  if(this.modelReady&&this.speechReady)return;
  this.loading=this.start(model,context,signal);
  try{await this.loading;}finally{this.loading=null;}
 }
 private async start(model:string,context:number,signal?:AbortSignal){
  const library=resourcePath('native/llama'),manifest=JSON.parse(readFileSync(resourcePath('config/desktop-alpha-models.json'),'utf8'));
  try{
   if(!this.modelReady){
    await this.freePort(Number(process.env.BAMBI_LLM_PORT));
    const cpu=process.env.BAMBI_DESKTOP_ACCELERATOR==='cpu',windows=process.platform==='win32';
    const nativeEnv={...process.env,...(windows?{PATH:[library,resolve(library,'vulkan'),process.env.PATH].join(';')}:{LD_LIBRARY_PATH:library}),...(!cpu?{GGML_BACKEND_PATH:resolve(library,windows?'vulkan/ggml-vulkan.dll':'vulkan/libggml-vulkan.so')}:{})};
    this.llama=this.launch(llamaExecutable(),[
     '-m',resolve(process.env.BAMBI_MODELS_ROOT!,manifest.assets[0].path),'--alias',model,
     '--host','127.0.0.1','--port',process.env.BAMBI_LLM_PORT!,'--api-key',process.env.BAMBI_LLM_TOKEN!,
     '--ctx-size',String(context),'--parallel','1','--threads','6','--threads-batch','6','--batch-size','512','--ubatch-size','128',
     '--poll','0','--poll-batch','0','--ctx-checkpoints','16','--checkpoint-min-step','512','--cache-ram','2048',
     '--gpu-layers',cpu?'0':'all','--flash-attn','on','--jinja','--reasoning','off','--no-webui','--n-predict','8192','--cache-type-k','f16','--cache-type-v','f16',
    ],'llama',{...nativeEnv,VK_LOADER_LAYERS_DISABLE:'~implicit~',DISABLE_LSFG:'1',DISABLE_LSFGVK:'1'});
    await this.wait(this.llama,process.env.BAMBI_LLM_URL!+'/v1/models',{Authorization:'Bearer '+process.env.BAMBI_LLM_TOKEN},v=>v.data?.some((a:any)=>a.id===model),signal);this.llamaValidated=true;
   }
   if(!this.speechReady){
    await this.freePort(Number(process.env.BAMBI_TTS_PORT));
    this.speech=this.launch(speechExecutable(),['kokoro'],'kokoro');
    await this.wait(this.speech,process.env.BAMBI_TTS_URL!+'/desktop/identity',{'X-Bambi-TTS-Token':process.env.BAMBI_TTS_TOKEN!},v=>v.app==='bambi-local'&&v.service==='kokoro'&&v.protocol===1&&v.pid===this.speech?.pid&&v.instance===process.env.BAMBI_INSTANCE_TOKEN&&v.modelSha256===manifest.assets[1].sha256,signal);this.speechValidated=true;
   }
  }catch(error){await this.stop();throw error;}
 }
 async stop(){
  await Promise.all([this.llama,this.speech].filter((p):p is ChildProcess=>!!p).map(child=>new Promise<void>(accept=>{
   if(!child.pid||child.exitCode!==null||child.signalCode!==null){accept();return;}
   const timer=setTimeout(()=>{child.kill('SIGKILL');},2000);child.once('exit',()=>{clearTimeout(timer);accept();});child.kill('SIGTERM');
  })));this.llama=null;this.speech=null;this.llamaValidated=false;this.speechValidated=false;
 }
}
export const desktopServices=new DesktopServices();
