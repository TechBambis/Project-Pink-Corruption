// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {createReadStream,createWriteStream,readFileSync} from 'node:fs';
import {mkdir,lstat,realpath,rename,rm,statfs,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,basename,sep} from 'node:path';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resourcePath} from './paths';
import {desktopServices} from './desktop-services';

export interface Asset {path:string;bytes:number;sha256:string;url:string;license:string}
export const alphaModels=JSON.parse(readFileSync(resourcePath('config/desktop-alpha-models.json'),'utf8')) as {protocol:number;alias:string;context:number;assets:Asset[]};
type Phase='not-installed'|'downloading'|'verifying'|'installed'|'preparing'|'ready'|'cancelled'|'failed';
/** Only fixed reviewed assets enter the data store. Never trust a receipt instead of the files. */
export class DesktopSetup {
 state:{phase:Phase;asset?:string;completed:number;total:number;error?:string}={phase:'not-installed',completed:0,total:alphaModels.assets.reduce((n,a)=>n+a.bytes,0)};
 verified=false;private controller:AbortController|null=null;
 constructor(readonly directory=process.env.BAMBI_MODELS_ROOT!,private assets:Asset[]=alphaModels.assets){this.state.total=assets.reduce((n,a)=>n+a.bytes,0);}
 private async verify(asset:Asset,path:string,signal:AbortSignal,installed=true){
  signal.throwIfAborted();const actualParent=await realpath(dirname(path));const actualRoot=installed?await realpath(this.directory):actualParent;if(actualParent!==actualRoot&&!actualParent.startsWith(actualRoot+sep))throw Error('Model data path escapes its private root.');const stat=await lstat(path);if(!stat.isFile()||stat.size!==asset.bytes)throw Error('Asset size/type mismatch: '+asset.path);
  const hash=createHash('sha256');for await(const chunk of createReadStream(path)){signal.throwIfAborted();hash.update(chunk);}
  if(hash.digest('hex')!==asset.sha256)throw Error('Asset checksum mismatch: '+asset.path);
 }
 async check(){
  if(this.controller)return;
  this.controller=new AbortController();this.state={...this.state,phase:'verifying',error:undefined};
  try{for(const asset of this.assets){this.state.asset=asset.path;await this.verify(asset,resolve(this.directory,asset.path),this.controller.signal);}this.verified=true;this.state={...this.state,phase:'installed',asset:undefined,completed:this.state.total};}
  catch{this.verified=false;this.state={...this.state,phase:'not-installed',asset:undefined,completed:0};}
  finally{this.controller=null;}
 }
 cancel(){this.controller?.abort(Error('Setup cancelled. Verified assets are retained.'));}
 async install(source?:string){
  if(this.controller)throw Error('Setup is already running.');
  this.controller=new AbortController();const signal=this.controller.signal;this.verified=false;
  this.state={...this.state,phase:source?'verifying':'downloading',completed:0,error:undefined};
  let temporary:string|undefined;
  try{
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const sourceRoot=source?await realpath(source):undefined;
   for(const asset of this.assets){
    signal.throwIfAborted();this.state.asset=asset.path;
    const destination=resolve(this.directory,asset.path);await mkdir(dirname(destination),{recursive:true,mode:0o700});
    const realRoot=await realpath(this.directory),parent=await realpath(dirname(destination));if(parent!==realRoot&&!parent.startsWith(realRoot+sep))throw Error('Model data directory escapes its private root.');
    const prefix=basename(destination)+'.';for(const name of await readdir(parent))if(name.startsWith(prefix)&&/^[0-9a-f-]{36}\.partial$/.test(name.slice(prefix.length)))await rm(resolve(parent,name),{force:true});
    try{await this.verify(asset,destination,signal);this.state.completed+=asset.bytes;continue;}catch{signal.throwIfAborted();}
    // There is one staged file at a time; old installed bytes and all partials count in statfs.
    const disk=await statfs(this.directory);if(disk.bavail*disk.bsize<asset.bytes+256*2**20)throw Error('Not enough free space for the next staged asset (plus 256 MiB reserve).');
    temporary=destination+'.'+randomUUID()+'.partial';
    let input:Readable;
    if(sourceRoot){
     let candidate:string|undefined;
     const choices=[resolve(sourceRoot,asset.path),resolve(sourceRoot,basename(asset.path)),resolve(sourceRoot,'models',asset.path),...(asset.path.startsWith('streaming/')?[resolve(sourceRoot,'.runtime/streaming-speech/model',basename(asset.path))]:[])];
     for(const path of choices){try{const actual=await realpath(path);if(!actual.startsWith(sourceRoot+sep))continue;await this.verify(asset,path,signal,false);candidate=path;break;}catch{signal.throwIfAborted();}}
     if(!candidate)throw Error('Selected folder does not contain the verified public asset: '+asset.path);
     input=createReadStream(candidate);
    }else{
     this.state.phase='downloading';const response=await fetch(asset.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(30*60*1000)])});
     if(!response.ok||!response.body)throw Error('Download failed: '+asset.path+' (HTTP '+response.status+').');
     const size=response.headers.get('content-length');if(size&&Number(size)!==asset.bytes)throw Error('Download size differs from the reviewed manifest.');
     input=Readable.fromWeb(response.body as any);
    }
    let bytes=0;const hash=createHash('sha256');
    const bounded=new Transform({transform:(chunk,_encoding,done)=>{bytes+=chunk.length;if(bytes>asset.bytes){done(Error('Download exceeds its byte limit.'));return;}hash.update(chunk);this.state.completed+=chunk.length;done(null,chunk);}});
    await pipeline(input,bounded,createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal});
    this.state.phase='verifying';if(bytes!==asset.bytes||hash.digest('hex')!==asset.sha256)throw Error('Staged asset checksum mismatch: '+asset.path);
    signal.throwIfAborted();await rename(temporary,destination);temporary=undefined;
   }
   this.verified=true;this.state={...this.state,phase:'installed',asset:undefined,completed:this.state.total};
  }catch(error){this.state={...this.state,phase:signal.aborted?'cancelled':'failed',error:signal.aborted?'Setup cancelled. Retry to reuse verified assets.':String(error),asset:undefined};}
  finally{if(temporary)await rm(temporary,{force:true});this.controller=null;}
 }
 async prepare(signal?:AbortSignal){
  if(!this.verified)throw Error('Complete verified setup before preparing local AI.');
  if(this.controller)throw Error('Setup is already running.');
  this.controller=new AbortController();const prepareSignal=AbortSignal.any([this.controller.signal,...(signal?[signal]:[])]);
  this.state={...this.state,phase:'preparing',error:undefined};
  try{await desktopServices.prepare(alphaModels.alias,alphaModels.context,prepareSignal);this.state.phase='ready';}
  catch(error){this.state={...this.state,phase:prepareSignal.aborted?'cancelled':'failed',error:String(error)};throw error;}
  finally{this.controller=null;}
 }
}
export const desktopSetup=process.env.BAMBI_DESKTOP_ALPHA==='1'?new DesktopSetup():null;
