// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
export type SetupState={phase:string;completed:number;total:number;verified:boolean;model:string;error?:string;asset?:string;operation?:string;stage?:string;assetCompleted?:number;assetTotal?:number;assetIndex?:number;assetCount?:number;remainingBytes?:number;missing?:string[];startedAt?:number;updatedAt?:number;runtime?:{phase:string;ready:boolean;backend:string|null;deviceName?:string;fallbackReason?:string}};
export const setupBusy=(state:SetupState|null)=>!!state&&['downloading','verifying','preparing'].includes(state.phase);
export const size=(bytes:number)=>bytes<1e9?`${(bytes/1e6).toFixed(1)} MB`:`${(bytes/1e9).toFixed(2)} GB`;
export function modelProgress(state:SetupState|null,model:string,label:string,now=Date.now(),bytesPerSecond=0){
 if(!state||state.model!==model||state.phase==='not-installed')return {title:'Download has not started',detail:`${label?label+' is selected. ':''}Choose Download and verify, or import an existing model.`,ratio:0};
 const file=state.asset?.split(/[\\/]/).at(-1),count=state.assetIndex&&state.assetCount?`File ${state.assetIndex} of ${state.assetCount}. `:'';
 let title='',detail='',ratio:number|null=state.total?Math.min(1,state.completed/state.total):0;
 if(state.phase==='downloading'||state.phase==='verifying'){
  if(state.stage==='checking-file'||state.stage==='checking-installed'||state.stage==='checksum'||state.operation==='check'){
   title='Checking model files';detail=count+'Verifying file size and SHA-256 before use.';
   ratio=state.assetTotal?Math.min(1,(state.assetCompleted??0)/state.assetTotal):null;
  }else if(state.stage==='finding-file') {title='Looking for your existing model';detail='Checking the selected location.';ratio=null;}
  else if(state.stage==='connecting'){title='Connecting to the download';detail='Waiting for the model server. No model bytes have arrived yet.';ratio=null;}
  else {title=state.operation==='import'?'Copying your model':'Downloading your model';detail=count+`${size(state.completed)} of ${size(state.total)} (${Math.floor((ratio??0)*100)}%).`;
   if(bytesPerSecond>0&&state.operation!=='import'){
    const remaining=Math.max(0,state.total-state.completed)/bytesPerSecond;detail+=` ${(bytesPerSecond/1e6).toFixed(1)} MB/s${remaining>5?` · about ${Math.ceil(remaining/60)} min remaining`:''}.`;
   }
  }
  if(file)detail+=' '+file;
  if(state.operation==='download'&&state.updatedAt&&now-state.updatedAt>=30000&&['connecting','transferring'].includes(state.stage??''))detail+=` No new data for ${Math.floor((now-state.updatedAt)/1000)} seconds. You can cancel and retry; setup stops a stalled transfer after 90 seconds.`;
 }else if(state.phase==='partial'){title='Model copied · voice files still needed';detail=`The verified model is saved. Download the remaining ${size(state.remainingBytes??0)}, or import a complete model and voice folder.`;}
 else if(state.phase==='installed'){title='Files verified · ready to start';detail='No download is running. Choose Start local AI to load the model and voice.';ratio=1;}
 else if(state.phase==='preparing'){title='Starting your local companion';detail=state.runtime?.phase==='probing'?'Checking available graphics acceleration…':'Loading the model and voice, then checking a real AI response. Large models can take a few minutes.';ratio=null;}
 else if(state.phase==='ready'){
  title='Your local companion is ready';const runtime=state.runtime;
  detail=runtime?.backend==='cpu'?'Chat uses the CPU.':runtime?.backend==='unverified'?'Graphics acceleration has not been confirmed.':'Chat uses the GPU'+(runtime?.deviceName?' · '+runtime.deviceName:'')+'.';
  if(runtime?.fallbackReason&&runtime.backend==='cpu')detail+=' GPU acceleration was unavailable for this start. Verified model files are kept.';ratio=1;
 }else if(state.phase==='cancelled'){title='Setup cancelled';detail=state.error||'No download is running. Retry to reuse verified files.';}
 else {title='Setup needs attention';detail=state.error||'Setup could not finish. Check your connection or model files, then retry.';}
 return {title,detail,ratio};
}
