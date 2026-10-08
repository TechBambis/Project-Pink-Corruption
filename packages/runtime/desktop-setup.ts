// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {createReadStream,createWriteStream,readFileSync} from 'node:fs';
import {mkdir,lstat,realpath,rename,rm,statfs,readdir,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,basename,sep} from 'node:path';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resourcePath} from './paths';
import {ModelSources} from './model-sources';
import {desktopServices} from './desktop-services';
import {downloadableModel,modelAsset} from '../ai/model-catalog';

export interface Asset {path:string;bytes:number;sha256:string;url:string;license:string}
export const alphaModels=JSON.parse(readFileSync(resourcePath('config/desktop-alpha-models.json'),'utf8')) as {protocol:number;alias:string;context:number;assets:Asset[]};
type Phase='not-installed'|'downloading'|'verifying'|'installed'|'preparing'|'ready'|'cancelled'|'failed'|'partial';
/** Only fixed reviewed assets enter the data store. Never trust a receipt instead of the files. */
export class DesktopSetup {
 readonly sources:ModelSources;
 private verifiedPaths=new Set<string>();
 state:{phase:Phase;asset?:string;completed:number;total:number;error?:string;operation?:'download'|'import'|'check'|'prepare';stage?:string;assetCompleted?:number;assetTotal?:number;assetIndex?:number;assetCount?:number;startedAt?:number;updatedAt?:number}={phase:'not-installed',completed:0,total:alphaModels.assets.reduce((n,a)=>n+a.bytes,0)};
 verified=false;private controller:AbortController|null=null;
 model=alphaModels.alias;
 get context(){return downloadableModel(this.model).context;}
 get busy(){return this.controller!==null;}
 get downloadBytes(){return this.assets.reduce((n,a)=>n+a.bytes,0);}
 get snapshot(){
  const runtime=this.includeSpeech?desktopServices.capabilities:undefined;
  const stopped=this.state.phase==='ready'&&runtime?.phase==='failed';
  return {...this.state,...(stopped?{phase:'failed',error:'Local AI stopped. Prepare local AI to restart.'}:{}),verified:this.verified,model:this.model,downloadBytes:this.downloadBytes,remainingBytes:this.assets.filter(asset=>!this.verifiedPaths.has(asset.path)).reduce((n,a)=>n+a.bytes,0),missing:this.assets.filter(asset=>!this.verifiedPaths.has(asset.path)).map(asset=>asset.path),...(runtime?{runtime}:{})};
 }
 constructor(readonly directory=process.env.BAMBI_MODELS_ROOT!,private assets:Asset[]=alphaModels.assets,readonly includeSpeech=true,private options:{downloadIdleMs?:number}={}){
  this.sources=new ModelSources(directory);
  if(assets===alphaModels.assets||!includeSpeech){
   try{const saved=JSON.parse(readFileSync(resolve(directory,'selected-model.json'),'utf8'));downloadableModel(saved.model);this.model=saved.model;}catch{}
   this.assets=this.assetsFor(this.model);
  }
  this.state.total=this.downloadBytes;
 }
 private assetsFor(model:string){return [modelAsset(model),...(this.includeSpeech?alphaModels.assets.slice(1):[])];}
 async select(model:string){
  downloadableModel(model);if(this.busy)throw Error('Finish or cancel setup before changing models.');
  if(model===this.model)return;
  this.controller=new AbortController();
  try{
   await mkdir(this.directory,{recursive:true,mode:0o700});
   if(this.includeSpeech)await desktopServices.stop();
   const selection=resolve(await realpath(this.directory),'selected-model.json'),temporary=selection+'.'+randomUUID()+'.partial';
   try{await writeFile(temporary,JSON.stringify({model})+'\n',{flag:'wx',mode:0o600});await rename(temporary,selection);}finally{await rm(temporary,{force:true});}
   this.model=model;this.assets=this.assetsFor(model);this.verified=false;this.verifiedPaths.clear();
   this.state={phase:'not-installed',completed:0,total:this.downloadBytes};
  }finally{this.controller=null;}
  await this.check();
 }
 private async verify(asset:Asset,path:string,signal:AbortSignal,installed=true){
  signal.throwIfAborted();const actualParent=await realpath(dirname(path));const actualRoot=installed?await realpath(this.directory):actualParent;if(actualParent!==actualRoot&&!actualParent.startsWith(actualRoot+sep))throw Error('Model data path escapes its private root.');const stat=await lstat(path);if(!stat.isFile()||stat.size!==asset.bytes)throw Error('Asset size/type mismatch: '+asset.path);
  this.state.stage='checking-file';this.state.assetCompleted=0;this.state.assetTotal=asset.bytes;
  const hash=createHash('sha256');for await(const chunk of createReadStream(path)){signal.throwIfAborted();hash.update(chunk);this.state.assetCompleted+=Buffer.byteLength(chunk);this.state.updatedAt=Date.now();}
  if(hash.digest('hex')!==asset.sha256)throw Error('Asset checksum mismatch: '+asset.path);
 }
 async check(){
  if(this.controller)return;
  this.controller=new AbortController();this.verifiedPaths.clear();this.state={phase:'verifying',operation:'check',completed:0,total:this.downloadBytes,startedAt:Date.now(),updatedAt:Date.now(),assetCount:this.assets.length};
  try{for(const [index,asset] of this.assets.entries()){this.state.asset=asset.path;this.state.assetIndex=index+1;try{await this.verify(asset,resolve(this.directory,asset.path),this.controller.signal);this.verifiedPaths.add(asset.path);this.state.completed+=asset.bytes;}catch{this.controller.signal.throwIfAborted();}}this.verified=this.verifiedPaths.size===this.assets.length;this.state={...this.state,phase:this.verified?'installed':this.verifiedPaths.has(this.assets[0]?.path??'')?'partial':'not-installed',stage:'complete',asset:undefined};}
  catch{this.verified=false;this.state={...this.state,phase:'cancelled',asset:undefined};}
  finally{this.controller=null;}
 }
 cancel(){this.controller?.abort(Error('Setup cancelled. Verified assets are retained.'));}
 async install(source?:string,permissionSignal?:AbortSignal,modelFile?:string){
  if(this.controller)throw Error('Setup is already running.');
  this.controller=new AbortController();const signal=AbortSignal.any([this.controller.signal,...(permissionSignal?[permissionSignal]:[])]);this.verified=false;
  this.verifiedPaths.clear();this.state={phase:source?'verifying':'downloading',operation:source?'import':'download',stage:'checking-installed',completed:0,total:this.downloadBytes,startedAt:Date.now(),updatedAt:Date.now(),assetCount:this.assets.length};
  let temporary:string|undefined,idle:ReturnType<typeof setTimeout>|undefined,stalled=false;
  const activity=()=>{clearTimeout(idle);if(!source)idle=setTimeout(()=>{stalled=true;this.controller?.abort(Error('No download data received for 90 seconds.'));},this.options.downloadIdleMs??90000);};
  try{
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const sourceRoot=source?await realpath(source):undefined;
   for(const [index,asset] of this.assets.entries()){
    signal.throwIfAborted();this.state.asset=asset.path;this.state.assetIndex=index+1;this.state.assetCompleted=0;this.state.assetTotal=asset.bytes;this.state.stage='checking-installed';
    const destination=resolve(this.directory,asset.path);await mkdir(dirname(destination),{recursive:true,mode:0o700});
    const realRoot=await realpath(this.directory),parent=await realpath(dirname(destination));if(parent!==realRoot&&!parent.startsWith(realRoot+sep))throw Error('Model data directory escapes its private root.');
    const prefix=basename(destination)+'.';for(const name of await readdir(parent))if(name.startsWith(prefix)&&/^[0-9a-f-]{36}\.partial$/.test(name.slice(prefix.length)))await rm(resolve(parent,name),{force:true});
    try{await this.verify(asset,destination,signal);this.verifiedPaths.add(asset.path);this.state.completed+=asset.bytes;continue;}catch{signal.throwIfAborted();}
    // There is one staged file at a time; old installed bytes and all partials count in statfs.
    const checkDisk=async()=>{const disk=await statfs(this.directory);if(disk.bavail*disk.bsize<asset.bytes+256*2**20)throw Error('Not enough free space for the next staged asset (plus 256 MiB reserve).');};
    let input:Readable;
    if(sourceRoot){
     let candidate:string|undefined;
     this.state.stage='finding-file';
     const choices=[...(index===0&&modelFile?[modelFile]:[]),resolve(sourceRoot,asset.path),resolve(sourceRoot,basename(asset.path)),resolve(sourceRoot,'models',asset.path),...(asset.path.startsWith('streaming/')?[resolve(sourceRoot,'.runtime/streaming-speech/model',basename(asset.path))]:[])];
     for(const path of choices){try{const actual=await realpath(path);if(!actual.startsWith(sourceRoot+sep))continue;const info=await lstat(actual);if(!info.isFile()||info.size!==asset.bytes)continue;candidate=actual;break;}catch{signal.throwIfAborted();}}
     if(!candidate){if(modelFile&&index>0){temporary=undefined;continue;}throw Error('Selected folder does not contain the verified public asset: '+asset.path);}
     await checkDisk();input=createReadStream(candidate);
    }else{
     await checkDisk();this.state.phase='downloading';this.state.stage='connecting';this.state.updatedAt=Date.now();activity();const response=await fetch(asset.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(30*60*1000)])});
     if(!response.ok||!response.body)throw Error('Download failed: '+asset.path+' (HTTP '+response.status+').');
     const size=response.headers.get('content-length');if(size&&Number(size)!==asset.bytes)throw Error('Download size differs from the reviewed manifest.');
     input=Readable.fromWeb(response.body as any);
    }
    temporary=destination+'.'+randomUUID()+'.partial';
    this.state.stage=source?'copying':'transferring';this.state.assetCompleted=0;this.state.updatedAt=Date.now();
    let bytes=0;const hash=createHash('sha256');
    const bounded=new Transform({transform:(chunk,_encoding,done)=>{bytes+=chunk.length;if(bytes>asset.bytes){done(Error('Download exceeds its byte limit.'));return;}hash.update(chunk);this.state.completed+=chunk.length;this.state.assetCompleted=bytes;this.state.updatedAt=Date.now();activity();done(null,chunk);}});
    await pipeline(input,bounded,createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal});
    clearTimeout(idle);this.state.phase='verifying';this.state.stage='checksum';if(bytes!==asset.bytes||hash.digest('hex')!==asset.sha256)throw Error('Staged asset checksum mismatch: '+asset.path);
    signal.throwIfAborted();await rename(temporary,destination);temporary=undefined;this.verifiedPaths.add(asset.path);
   }
   this.verified=this.verifiedPaths.size===this.assets.length;this.state={...this.state,phase:this.verified?'installed':'partial',stage:'complete',asset:undefined};
  }catch(error){this.state={...this.state,phase:signal.aborted&&!stalled?'cancelled':'failed',error:stalled?'The download stopped receiving data for 90 seconds. Check your connection and retry; verified files are kept.':signal.aborted?'Setup cancelled. Retry to reuse verified assets.':String(error),asset:undefined};}
  finally{clearTimeout(idle);try{if(temporary)await rm(temporary,{force:true});}catch{this.state={...this.state,phase:'failed',error:'The staged file could not be removed. Close the app, check the model folder permissions and retry. Verified files are kept.'};}finally{this.controller=null;}}
 }
 async prepare(signal?:AbortSignal){
  if(!this.verified)throw Error('Complete verified setup before preparing local AI.');
  if(this.controller)throw Error('Setup is already running.');
  this.controller=new AbortController();const prepareSignal=AbortSignal.any([this.controller.signal,...(signal?[signal]:[])]);
  this.state={...this.state,phase:'preparing',operation:'prepare',stage:'starting-runtime',startedAt:Date.now(),updatedAt:Date.now(),error:undefined};
  try{await desktopServices.prepare(this.model,this.context,prepareSignal);this.state.phase='ready';}
  catch(error){this.state={...this.state,phase:prepareSignal.aborted?'cancelled':'failed',error:String(error)};throw error;}
  finally{this.controller=null;}
 }
}
export const desktopSetup=process.env.BAMBI_DESKTOP_ALPHA==='1'?new DesktopSetup():null;
