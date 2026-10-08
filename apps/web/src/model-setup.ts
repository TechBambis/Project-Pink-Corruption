// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import type {ModelRecommendation} from '../../../packages/ai/recommendation';
import {modelProgress,setupBusy,size,type SetupState} from './model-progress';
import './model-setup.css';
import {accessAllowed,requireAccess} from './privacy-state';

type Catalog=ModelRecommendation&{desktop:boolean;downloadsAvailable:boolean;buildMode?:string;selectedModel?:string;setup:SetupState|null;speechBytes:number};
type Source={id:string;label:string;path:string;kind:'file'|'folder';models:string[];limited:boolean;error?:string};
const gib=(bytes:number|null)=>bytes===null?'Unknown':`${(bytes/2**30).toFixed(1)} GiB`;
async function json(url:string,body?:unknown,timeout=15000,method=body===undefined?'GET':'POST'){
 const response=await fetch(url,{method,cache:'no-store',signal:AbortSignal.timeout(timeout),...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'The request could not be completed.');return value;
}
export async function initModelSetup(root:HTMLElement,options:{finish?:()=>void;selected?:(id:string)=>void;prepared?:()=>void}={}){
 root.classList.add('model-setup');
 root.innerHTML=`<p class="model-loading" role="status">Reading your computer and model information…</p><p class="model-unavailable" role="note" hidden>This is the playback smoke build. It cannot download or run local AI. No model download has started. Use an AI-enabled alpha build for model setup; the player and Studio are available here.</p>
 <nav class="model-steps" aria-label="Local AI setup"><button type="button" data-step="0">1. Your computer</button><button type="button" data-step="1">2. Choose a model</button><button type="button" data-step="2">3. Install and start</button></nav>
 <p class="model-running" hidden></p>
 <section data-pane="0"><h2>What fits your computer?</h2><p class="model-intro">Check your hardware, choose a local model, then download only what you need. Your conversations stay on this computer.</p><dl class="model-hardware"></dl><p class="model-estimate"></p><button type="button" data-recheck>Check hardware again</button></section>
 <section data-pane="1" hidden><h2>Choose your local AI</h2><p class="model-summary"></p><div class="model-list" role="radiogroup" aria-label="Local AI models"></div><p class="model-note">Memory estimates include context and leave room for voice and the app. They do not predict response speed. Models requiring another setup remain listed for comparison.</p></section>
 <section data-pane="2" hidden><h2>Install and start</h2><p class="model-download-note"></p><label class="model-experimental" hidden><input type="checkbox"> I want to try this experimental model. It has not passed the reference model’s app tests.</label>
 <div class="model-status"><strong class="model-progress" role="status" aria-live="polite"></strong><progress max="1" value="0" aria-label="Model setup progress"></progress><p class="model-progress-detail"></p></div>
 <p class="model-connection" role="status" hidden></p><button type="button" data-status-retry hidden>Check status now</button>
 <div class="model-actions"><button type="button" data-download>Download and verify</button><button type="button" data-prepare hidden>Start local AI</button><button type="button" data-cancel disabled>Cancel setup</button><button type="button" data-use hidden>Use installed model</button><button type="button" data-access>Privacy &amp; access</button></div>
 <section class="model-local" hidden><h3>Already have a model?</h3><p class="model-note">Choose a GGUF file or add a model folder, including one from another repository. Matching catalog files are copied into the app and checked before use. Your originals stay untouched. Saved folders can be checked again later.</p><div class="model-actions"><button type="button" data-file>Choose a model file</button><button type="button" data-folder>Add a model folder</button><button type="button" data-copy>Import complete model and voice folder</button></div><div class="model-sources"></div><p class="model-source-error" role="status" hidden></p></section>
 <p class="model-note">Downloads start only when you choose them. Verified files are kept for retry. You can leave setup and keep using the player; an active download continues.</p></section>
 <p class="model-error" role="alert" hidden></p><div class="model-wizard-actions"><button type="button" data-back disabled>Back</button><button type="button" data-next>Choose a model</button><button type="button" data-finish>Set up later</button></div>`;
 for(const button of root.querySelectorAll<HTMLButtonElement>('button'))button.disabled=true;
 const el=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 for(const [selector,id] of [['[data-download]','setup-install'],['[data-copy]','setup-copy'],['[data-prepare]','setup-prepare'],['[data-cancel]','setup-cancel'],['progress','setup-bar'],['.model-progress','setup-progress']])el(selector).id=id;
 let data!:Catalog,selected='',step=0,state:SetupState|null=null,requesting=false,initializing=true,requestLabel='',stopped=false,polling=false,statusLost=false;
 let sources:Source[]=[],speed=0,lastSample:{bytes:number;at:number;model:string;operation?:string;asset?:string;stage?:string}|undefined;
 const bridge=(window as any).bambiDesktop;
 function error(value:unknown){el('.model-error').textContent=String(value);el('.model-error').hidden=false;}
 function pane(index:number){
  step=index;for(const section of root.querySelectorAll<HTMLElement>('[data-pane]'))section.hidden=Number(section.dataset.pane)!==index;
  for(const button of root.querySelectorAll<HTMLElement>('[data-step]'))button.setAttribute('aria-current',Number(button.dataset.step)===index?'step':'false');
  el<HTMLButtonElement>('[data-back]').disabled=index===0;el('[data-next]').hidden=index===2;el('[data-next]').textContent=index===0?'Choose a model':'Review download';el('[data-finish]').textContent=index===2?'Return to companion':'Set up later';showState();
 }
 function chosen(){return data?.alternatives.find(model=>model.id===selected);}
 function showState(){
  if(!data||stopped)return;
  el('.model-loading').hidden=!initializing;
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-step],[data-next],[data-access]'))button.disabled=false;el<HTMLButtonElement>('[data-back]').disabled=step===0;
  const model=chosen(),busy=initializing||requesting||setupBusy(state),experimental=model?.qualification==='experimental',confirmed=!experimental||el<HTMLInputElement>('.model-experimental input').checked;
  const possible=!!model?.canDownload&&model.promptCompatible!==false&&model.memoryFit==='fits'&&model.runtime!=='platform-pending'&&data.downloadsAvailable;
  const current=state?.model===selected?state:null;
  const installedPossible=!!model?.installed&&model.promptCompatible!==false&&model.memoryFit==='fits'&&model.runtime!=='platform-pending';
  el('.model-unavailable').hidden=data.buildMode!=='smoke';el('.model-experimental').hidden=!experimental;
  const total=(model?.downloadBytes??model?.weightsBytes??0)+(data.speechBytes??0);
  el('.model-download-note').textContent=model?`${model.label}. Model ${size(model.weightsBytes??0)}${data.speechBytes?` + voice and English recognition ${size(data.speechBytes)}`:''}. Total ${size(total)}. ${model.memoryFit==='fits'?'Setup checks available disk space.':'This model does not fit the conservative memory estimate.'} ${!model.canDownload?'This model requires another setup.':''} ${model.promptCompatible===false?'Its context cannot hold the full companion prompt.':''}`:'No model selected. Choose a model or continue with the player.';
  const download=el<HTMLButtonElement>('[data-download]');download.disabled=busy||statusLost||!possible||!confirmed||!accessAllowed('modelDownloads')||!!current?.verified;
  download.textContent=current?.phase==='partial'?`Download remaining ${size(current.remainingBytes??0)}`:current&&['failed','cancelled'].includes(current.phase)?'Retry download':'Download and verify';
  const prepare=el<HTMLButtonElement>('[data-prepare]');prepare.hidden=!data.desktop||!data.downloadsAvailable;prepare.disabled=busy||statusLost||!current?.verified||!confirmed||!possible||current.phase==='ready';
  const use=el<HTMLButtonElement>('[data-use]');use.hidden=data.desktop||!model?.installed;use.disabled=busy||!installedPossible||!confirmed;
  el<HTMLButtonElement>('[data-cancel]').disabled=!setupBusy(state);
  el<HTMLButtonElement>('[data-recheck]').disabled=busy;
  el<HTMLButtonElement>('[data-finish]').disabled=initializing||requesting;
  el('.model-local').hidden=!data.desktop||!data.downloadsAvailable||!(bridge?.chooseModelSource||bridge?.copyModelData);
  el('[data-file]').hidden=el('[data-folder]').hidden=!bridge?.chooseModelSource;
  el('[data-copy]').hidden=!bridge?.copyModelData;
  for(const button of root.querySelectorAll<HTMLButtonElement>('.model-local button'))button.disabled=busy||statusLost;
  el<HTMLButtonElement>('[data-copy]').disabled=busy||statusLost||!possible||!confirmed;
  const progress=modelProgress(current,selected,model?.label??'',Date.now(),speed);
  if(requesting&&!setupBusy(state)&&!current?.verified){progress.title=requestLabel;progress.detail='Please wait. Setup status is checked every second.';progress.ratio=null;}
  if(data.buildMode==='smoke'){progress.title='Local AI is unavailable in this build';progress.detail='No download has started. This build tests offline playback and installation.';progress.ratio=0;}
  else if(current?.phase==='not-installed'&&!accessAllowed('modelDownloads'))progress.detail='Model downloads are off. Open Privacy & access to allow them, or import an existing model.';
  el('.model-progress').textContent=progress.title;el('.model-progress').dataset.phase=current?.phase??'not-installed';
  el('.model-progress-detail').textContent=progress.detail;
  const bar=el<HTMLProgressElement>('progress');if(progress.ratio===null)bar.removeAttribute('value');else bar.value=progress.ratio;
  el('.model-status').dataset.phase=current?.phase??'not-installed';
  el('.model-connection').hidden=!statusLost;el('.model-connection').textContent='Live status is temporarily unavailable. The last confirmed progress is shown; a download may still be running. Reconnecting automatically…';el('[data-status-retry]').hidden=!statusLost;
  el('.model-running').hidden=!setupBusy(state)||step===2;el('.model-running').textContent=progress.title+'. Open Install and start to see progress.';
  for(const input of root.querySelectorAll<HTMLInputElement>('.model-list input'))input.disabled=busy;
  el('.model-experimental input').toggleAttribute('disabled',busy);
 }
 function renderSources(){
  const host=el('.model-sources');host.replaceChildren();
  for(const source of sources){
   const row=document.createElement('div');row.className='model-source';const info=document.createElement('div'),title=document.createElement('strong'),path=document.createElement('span'),description=document.createElement('p');title.textContent=source.label;path.textContent=source.path;
   description.textContent=source.error??(source.models.length?'Matching catalog files found. Files are verified when imported.':'No supported catalog file found. Select the exact file or a more specific folder. Other models and quantizations need their own runtime profile.');if(source.limited)description.textContent+=' Search is limited to three nested levels and 5,000 entries.';
   info.append(title,path,description);const actions=document.createElement('div');actions.className='model-source-actions';
   for(const id of source.models){const candidate=data.alternatives.find(model=>model.id===id);if(!candidate)continue;const button=document.createElement('button');button.type='button';button.textContent='Import '+candidate.label;button.dataset.sourceModel=id;
    button.onclick=()=>{const confirmed=selected===id&&el<HTMLInputElement>('.model-experimental input').checked;if(selected!==id){selected=id;el<HTMLInputElement>('.model-experimental input').checked=false;render();}pane(2);
     if(candidate.qualification==='experimental'&&!confirmed){error('Confirm this experimental model, then choose Import again.');return;}
     void importSource(source.id,id);
    };actions.append(button);
   }
   const forget=document.createElement('button');forget.type='button';forget.textContent='Forget location';forget.onclick=()=>void action('Updating your saved locations',async()=>{await json('/api/desktop/setup/sources/'+source.id,undefined,15000,'DELETE');await loadSources();});actions.append(forget);row.append(info,actions);host.append(row);
  }
  showState();
 }
 async function loadSources(){if(!data.desktop||!data.downloadsAvailable)return;try{sources=(await json('/api/desktop/setup/sources')).sources;el('.model-source-error').hidden=true;renderSources();}catch{el('.model-source-error').textContent='Saved model locations could not be checked. Reopen setup to retry.';el('.model-source-error').hidden=false;}}
 async function importSource(source:string,id:string){
  if(id!==selected)return;
  if(chosen()?.qualification==='experimental'&&!el<HTMLInputElement>('.model-experimental input').checked){error('Confirm the experimental model before importing it.');return;}
  await action('Starting your model import',async()=>{el('.model-status').scrollIntoView({block:'nearest'});await select();await json('/api/desktop/setup/import',{source});await readState();});
 }
 function render(){
  const hardware=data.hardware,description=el('.model-hardware');description.replaceChildren();
  for(const [label,value] of [['System',`${hardware.platform} ${hardware.architecture}`],['Processor',`${hardware.cpu} (${hardware.cpuThreads} threads)`],['Memory',`${gib(hardware.ramTotal)} total · ${gib(hardware.ramAvailable)} available`],['Graphics',hardware.gpus.map(gpu=>`${gpu.name}${gpu.memoryTotal?' ('+gib(gpu.memoryTotal)+')':' (memory unknown)'}`).join(', ')||'Graphics information unavailable; this does not mean you have no GPU'],['Reserved for other work',gib(data.reserveBytes)]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;description.append(dt,dd);}
  el('.model-estimate').textContent=data.warnings.join(' ');
  el('.model-summary').textContent=data.recommended?`Recommended for this computer: ${data.recommended.label}.`:'No supported model fits the conservative estimate. You can continue with the player and Studio.';
  const list=el('.model-list');list.replaceChildren();
  const rows=[...data.alternatives].sort((a,b)=>Number(b.id===data.recommended?.id)-Number(a.id===data.recommended?.id)||b.priority-a.priority);
  for(const model of rows){
   const label=document.createElement('label');label.className='model-choice';label.dataset.recommended=String(model.id===data.recommended?.id);
   const radio=document.createElement('input');radio.type='radio';radio.name='model-choice';radio.value=model.id;radio.checked=model.id===selected;radio.onchange=()=>{selected=model.id;speed=0;lastSample=undefined;el<HTMLInputElement>('.model-experimental input').checked=false;el('.model-error').hidden=true;renderSources();};
   const body=document.createElement('span'),title=document.createElement('strong'),status=document.createElement('span'),details=document.createElement('span'),note=document.createElement('span');title.textContent=model.label;
   status.className='model-badge';status.textContent=[model.id===data.recommended?.id?'Recommended':'',model.installed?'Installed':'',model.qualification==='experimental'?'Experimental':model.qualification==='development-only'?'Other setup required':model.qualification==='reference-tested'?'Reference-tested model':'Local backend model'].filter(Boolean).join(' · ');
   details.textContent=`Download ${model.weightsBytes===null?'unknown':size(model.weightsBytes)} · estimated working memory ${gib(model.estimatedWorkingBytes)} · ${model.memoryFit==='fits'?'Fits estimate':model.memoryFit==='too-large'?'Too large':model.memoryFit==='tight'?'Memory is tight':'Size unknown'}${model.execution==='unified-memory'?' · shared Apple memory':model.execution==='gpu'?' · possible GPU fit':' · CPU or partial GPU'}`;
   note.textContent=`${model.description??'An installed local model.'} ${model.reasons.join(' ')}`;body.append(title,status,details,note);label.append(radio,body);list.append(label);
  }
  renderSources();showState();
 }
 async function reload(refresh=false){const result:Catalog=await json('/api/models/catalog'+(refresh?'?refresh=1':''),undefined,20000);if(stopped)return;data=result;state=data.setup;selected=selected||((data.desktop||setupBusy(state)||state?.verified)?state?.model:undefined)||data.recommended?.id||data.selectedModel||state?.model||'';render();}
 async function action(label:string,callback:()=>Promise<void>){if(requesting)return;requesting=true;requestLabel=label;el('.model-error').hidden=true;showState();try{await callback();}catch(failure){error(failure);}finally{requesting=false;showState();}}
 async function select(){await json('/api/models/select',{model:selected,experimental:el<HTMLInputElement>('.model-experimental input').checked},180000);options.selected?.(selected);}
 async function readState(){
  const next:SetupState|null=await json('/api/models/setup');if(stopped)return;
  const now=Date.now();if(next?.phase==='downloading'&&next.stage==='transferring'&&lastSample?.model===next.model&&lastSample.operation===next.operation&&lastSample.asset===next.asset&&lastSample.stage==='transferring'&&(next.assetCompleted??next.completed)>=lastSample.bytes){const measured=((next.assetCompleted??next.completed)-lastSample.bytes)/Math.max(.001,(now-lastSample.at)/1000);speed=speed?speed*.7+measured*.3:measured;}else speed=0;
  lastSample=next?{bytes:next.assetCompleted??next.completed,at:now,model:next.model,operation:next.operation,asset:next.asset,stage:next.stage}:undefined;
  const previous=state?.phase;state=next;statusLost=false;
  showState();if(next&&next.phase!==previous&&['installed','partial','ready'].includes(next.phase))await reload();
 }
 el('[data-access]').onclick=()=>window.dispatchEvent(new Event('bambi-open-privacy'));
 el('[data-download]').onclick=()=>void action('Starting your download',async()=>{el('.model-status').scrollIntoView({block:'nearest'});await requireAccess('modelDownloads');await select();await json('/api/models/setup/install',{});await readState();});
 el('[data-use]').onclick=()=>void action('Selecting your installed model',async()=>{await select();await reload();});
 el('[data-copy]').onclick=()=>void action('Checking your model folder',async()=>{await select();const result=await bridge.copyModelData();if(result.error)throw Error(result.error);await readState();});
 for(const [button,kind] of [['[data-file]','file'],['[data-folder]','folder']])el(button).onclick=()=>void action('Choose an existing model location',async()=>{const result=await bridge.chooseModelSource(kind);if(result.cancelled)return;if(result.error)throw Error(result.error);sources=result.sources;renderSources();});
 el('[data-prepare]').onclick=()=>void action('Starting local AI',async()=>{await json('/api/desktop/setup/prepare',{},180000);await json('/api/models/onboarding',{});await reload();options.prepared?.();});
 el('[data-cancel]').onclick=()=>{el<HTMLButtonElement>('[data-cancel]').disabled=true;void json('/api/models/setup/cancel',{}).then(readState).catch(error);};
 el('[data-status-retry]').onclick=()=>void readState().catch(()=>{statusLost=true;showState();});
 el('.model-experimental input').addEventListener('change',showState);
 const accessChanged=()=>showState();window.addEventListener('bambi-access-changed',accessChanged);
 el('[data-recheck]').onclick=()=>void action('Checking your computer',async()=>{await reload(true);await loadSources();});
 el('[data-back]').onclick=()=>pane(Math.max(0,step-1));el('[data-next]').onclick=()=>pane(Math.min(2,step+1));
 for(const button of root.querySelectorAll<HTMLElement>('[data-step]'))button.onclick=()=>pane(Number(button.dataset.step));
 el('[data-finish]').onclick=()=>void action('Saving your setup choice',async()=>{await json('/api/models/onboarding',{});options.finish?.();});
 await reload();await loadSources();initializing=false;const initial=data.setup;pane(setupBusy(initial)||initial?.verified||initial?.phase==='partial'?2:0);
 const poll=async()=>{if(stopped||polling)return;polling=true;try{await readState();}catch{if(!stopped){statusLost=true;speed=0;showState();}}finally{polling=false;}};
 const timer=setInterval(poll,1000),visible=()=>{if(!document.hidden)void poll();};document.addEventListener('visibilitychange',visible);
 return ()=>{stopped=true;clearInterval(timer);window.removeEventListener('bambi-access-changed',accessChanged);document.removeEventListener('visibilitychange',visible);};
}

export async function initModelOnboarding(options:{selected:(id:string)=>void;prepared:()=>void}){
 const dialog=document.createElement('dialog');dialog.id='model-onboarding';dialog.setAttribute('aria-labelledby','model-onboarding-title');
 const heading=document.createElement('h2');heading.id='model-onboarding-title';heading.textContent='Set up your local companion';
 const host=document.createElement('div');dialog.append(heading,host);document.body.append(dialog);
 let cleanup:(()=>void)|undefined,opening=false;
 const dismiss=async()=>{try{await json('/api/models/onboarding',{});dialog.close();cleanup?.();cleanup=undefined;}catch(error){const message=document.createElement('p');message.textContent=String(error);host.append(message);}};
 const open=async()=>{if(dialog.open||opening)return;opening=true;dialog.showModal();host.textContent='Checking your computer…';try{cleanup=await initModelSetup(host,{...options,finish:()=>void dismiss()});}catch(error){host.textContent=String(error);const close=document.createElement('button');close.textContent='Set up later';close.onclick=()=>void dismiss();host.append(close);}finally{opening=false;}};
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(!opening)void dismiss();});
 document.getElementById('local-models-open')?.addEventListener('click',()=>void open());
 const state=await json('/api/models/onboarding');
 const capabilities=await fetch('/api/desktop/capabilities',{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(response=>response.ok?response.json():null).catch(()=>null);
 if(capabilities?.alpha&&!state.done)await open();
}
