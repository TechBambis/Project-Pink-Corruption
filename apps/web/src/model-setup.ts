// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import type {ModelRecommendation} from '../../../packages/ai/recommendation';
import './model-setup.css';
import {accessAllowed,requireAccess} from './privacy-state';

type SetupState={phase:string;completed:number;total:number;verified:boolean;model:string;error?:string;asset?:string;runtime?:{phase:string;ready:boolean;backend:string|null;deviceName?:string;fallbackReason?:string}};
type Catalog=ModelRecommendation&{desktop:boolean;downloadsAvailable:boolean;selectedModel?:string;setup:SetupState|null;speechBytes:number};
const gb=(bytes:number)=>`${(bytes/1e9).toFixed(2)} GB`;
const gib=(bytes:number|null)=>bytes===null?'Unknown':`${(bytes/2**30).toFixed(1)} GiB`;
const phaseLabel:Record<string,string>={'not-installed':'Not installed',downloading:'Downloading',verifying:'Verifying files',installed:'Installed · ready to prepare',preparing:'Preparing local AI',ready:'Ready',cancelled:'Setup cancelled',failed:'Setup needs attention'};
async function json(url:string,body?:unknown){
 const response=await fetch(url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'The request could not be completed.');return value;
}
export async function initModelSetup(root:HTMLElement,options:{finish?:()=>void;selected?:(id:string)=>void;prepared?:()=>void}={}){
 root.classList.add('model-setup');
 root.innerHTML=`<nav class="model-steps" aria-label="Local AI setup"><button type="button" data-step="0">1. Your computer</button><button type="button" data-step="1">2. Choose a model</button><button type="button" data-step="2">3. Install and start</button></nav>
 <section data-pane="0"><h2>What fits your computer?</h2><p class="model-intro">Check your hardware, choose a local model, then download only what you need. Your conversations stay on this computer.</p><dl class="model-hardware"></dl><p class="model-estimate"></p><button type="button" data-recheck>Check hardware again</button></section>
 <section data-pane="1" hidden><h2>Choose your local AI</h2><p class="model-summary"></p><div class="model-list" role="radiogroup" aria-label="Local AI models"></div><p class="model-note">Memory estimates include context and leave room for voice and the app. They do not predict response speed. Models requiring another setup remain listed for comparison.</p></section>
 <section data-pane="2" hidden><h2>Install and start</h2><p class="model-download-note"></p><label class="model-experimental" hidden><input type="checkbox"> I want to try this experimental model. It has not passed the reference model’s app tests.</label><div class="model-actions"><button type="button" data-download>Download and verify</button><button type="button" data-access>Privacy &amp; access</button><button type="button" data-use>Use installed model</button><button type="button" data-copy hidden>Choose verified data folder</button><button type="button" data-prepare hidden>Prepare local AI</button><button type="button" data-cancel disabled>Cancel setup</button></div><progress max="1" value="0" aria-label="Model setup progress"></progress><p class="model-progress" role="status" aria-live="polite"></p><p class="model-note">Downloads start only when you choose them. Verified files are retained for retry. You can keep using the player without AI.</p></section>
 <p class="model-error" role="alert" hidden></p><div class="model-wizard-actions"><button type="button" data-back disabled>Back</button><button type="button" data-next>Choose a model</button><button type="button" data-finish>Set up later</button></div>`;
 const el=<T extends HTMLElement=HTMLElement>(selector:string)=>root.querySelector<T>(selector)!;
 for(const [selector,id] of [['[data-download]','setup-install'],['[data-copy]','setup-copy'],['[data-prepare]','setup-prepare'],['[data-cancel]','setup-cancel'],['progress','setup-bar'],['.model-progress','setup-progress']])el(selector).id=id;
 let data:Catalog,selected='',step=0,state:SetupState|null=null,requesting=false,stopped=false,polling=false;
 const buttons=['data-download','data-use','data-copy','data-prepare','data-cancel'];
 function error(value:unknown){el('.model-error').textContent=String(value);el('.model-error').hidden=false;}
 function pane(index:number){step=index;for(const section of root.querySelectorAll<HTMLElement>('[data-pane]'))section.hidden=Number(section.dataset.pane)!==index;for(const button of root.querySelectorAll<HTMLElement>('[data-step]')){button.setAttribute('aria-current',Number(button.dataset.step)===index?'step':'false');}el<HTMLButtonElement>('[data-back]').disabled=index===0;el('[data-next]').hidden=index===2;el('[data-next]').textContent=index===0?'Choose a model':'Review download';el('[data-finish]').textContent=index===2?'Return to companion':'Set up later';}
 function chosen(){return data?.alternatives.find(model=>model.id===selected);}
 function showState(){
  const model=chosen(),busy=requesting||!!state&&['downloading','verifying','preparing'].includes(state.phase),experimental=model?.qualification==='experimental',confirmed=!experimental||el<HTMLInputElement>('.model-experimental input').checked;
  const possible=!!model?.canDownload&&model.promptCompatible!==false&&model.memoryFit==='fits'&&model.runtime!=='platform-pending'&&data.downloadsAvailable;
  const installedPossible=!!model?.installed&&model.promptCompatible!==false&&model.memoryFit==='fits'&&model.runtime!=='platform-pending'&&(!data.desktop||!!model.canDownload);
  el('.model-experimental').hidden=!experimental;
  const total=(model?.downloadBytes??model?.weightsBytes??0)+(data?.speechBytes??0);
  el('.model-download-note').textContent=model?`${model.label}. Chat model: ${gb(model.weightsBytes??0)}${data.speechBytes?`; voice and English recognition: ${gb(data.speechBytes)}`:''}. Total data: ${gb(total)}. ${!accessAllowed('modelDownloads')?'To download, enable model downloads in Privacy & access.':''} ${model.memoryFit==='fits'?'Setup checks free disk space, including a staged replacement file.':'This model does not fit the current conservative memory estimate.'} ${!model.canDownload?'This model needs another setup; verified download is not available here.':''} ${model.promptCompatible===false?'Its configured context cannot hold the complete default companion prompt.':''}`:'No model selected. You can use the player without AI.';
  for(const name of buttons)el<HTMLButtonElement>('['+name+']').disabled=busy;
  el<HTMLButtonElement>('[data-download]').disabled=busy||!possible||!confirmed||!accessAllowed('modelDownloads');
  el<HTMLButtonElement>('[data-use]').disabled=busy||!installedPossible||!confirmed;
  el<HTMLButtonElement>('[data-copy]').disabled=busy||!possible||!confirmed;
  el<HTMLButtonElement>('[data-prepare]').disabled=busy||!state?.verified||state.model!==selected;
  el<HTMLButtonElement>('[data-cancel]').disabled=!busy;
  el('[data-copy]').hidden=!data.desktop||!(window as any).bambiDesktop?.copyModelData;
  el('[data-prepare]').hidden=!data.desktop;
  const bar=el<HTMLProgressElement>('progress');bar.value=state?.total?Math.min(1,state.completed/state.total):0;
  el('.model-progress').textContent=state?`${phaseLabel[state.phase]??state.phase}${state.asset?' · '+state.asset:''}${state.total?' · '+gb(state.completed)+' / '+gb(state.total):''}${state.error?' · '+state.error:''}`:'Choose a model to begin.';
  const runtime=state?.runtime;
  if(runtime?.ready&&state?.phase==='ready'){
   const acceleration=runtime.backend==='cpu'?'Chat uses the CPU':runtime.backend==='unverified'?'Chat is ready; graphics acceleration is not confirmed':'Chat uses the GPU'+(runtime.deviceName?' · '+runtime.deviceName:'');
   const fallback=runtime.fallbackReason&&runtime.backend==='cpu'?(runtime.fallbackReason==='no-gpu-headroom'?'Graphics memory is currently limited.':'Graphics acceleration is unavailable for this start.'):' ';
   el('.model-progress').textContent+=' · '+acceleration+'. '+fallback.trim();
  }else if(state?.phase==='preparing'&&runtime?.phase==='probing')el('.model-progress').textContent+=' · Checking graphics acceleration';
  el('.model-progress').dataset.phase=state?.phase??'not-installed';
  for(const input of root.querySelectorAll<HTMLInputElement>('.model-list input'))input.disabled=busy;
 }
 function render(){
  const hardware=data.hardware,description=el('.model-hardware');description.replaceChildren();
  for(const [label,value] of [['System',`${hardware.platform} ${hardware.architecture}`],['Processor',`${hardware.cpu} (${hardware.cpuThreads} threads)`],['Memory',`${gib(hardware.ramTotal)} total · ${gib(hardware.ramAvailable)} available`],['Graphics',hardware.gpus.map(gpu=>`${gpu.name}${gpu.memoryTotal?' ('+gib(gpu.memoryTotal)+')':''}`).join(', ')||'No measured GPU'],['Reserved for other work',gib(data.reserveBytes)]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;description.append(dt,dd);}
  el('.model-estimate').textContent=data.warnings.join(' ');
  el('.model-summary').textContent=data.recommended?`Recommended for this computer: ${data.recommended.label}.`:'No supported model fits the conservative estimate. You can continue with the player and Studio.';
  const list=el('.model-list');list.replaceChildren();
  const rows=[...data.alternatives].sort((a,b)=>Number(b.id===data.recommended?.id)-Number(a.id===data.recommended?.id)||b.priority-a.priority);
  for(const model of rows){
   const label=document.createElement('label');label.className='model-choice';label.dataset.recommended=String(model.id===data.recommended?.id);
   const radio=document.createElement('input');radio.type='radio';radio.name='model-choice';radio.value=model.id;radio.checked=model.id===selected;
   radio.onchange=()=>{selected=model.id;el<HTMLInputElement>('.model-experimental input').checked=false;showState();};
   const body=document.createElement('span'),title=document.createElement('strong'),status=document.createElement('span'),details=document.createElement('span'),note=document.createElement('span');title.textContent=model.label;
   status.className='model-badge';status.textContent=[model.id===data.recommended?.id?'Recommended':'',model.installed?'Installed':'',model.qualification==='experimental'?'Experimental':model.qualification==='development-only'?'Other setup required':model.qualification==='reference-tested'?'Reference-tested model':'Local backend model'].filter(Boolean).join(' · ');
   details.textContent=`Download ${model.weightsBytes===null?'unknown':gb(model.weightsBytes)} · estimated working memory ${gib(model.estimatedWorkingBytes)} · ${model.memoryFit==='fits'?'Fits estimate':model.memoryFit==='too-large'?'Too large':model.memoryFit==='tight'?'Memory is tight':'Size unknown'}${model.execution==='unified-memory'?' · shared Apple memory':model.execution==='gpu'?' · possible GPU fit':' · CPU or partial GPU'}`;
   note.textContent=`${model.description??'An installed local model.'} ${model.reasons.join(' ')}`;body.append(title,status,details,note);label.append(radio,body);list.append(label);
  }
  showState();
 }
 async function reload(){data=await json('/api/models/catalog');state=data.setup;selected=selected||(state?.verified?data.selectedModel:undefined)||data.recommended?.id||data.selectedModel||'';render();}
 async function action(callback:()=>Promise<void>){requesting=true;el('.model-error').hidden=true;showState();try{await callback();}catch(failure){error(failure);}finally{requesting=false;showState();}}
 async function select(){
  await json('/api/models/select',{model:selected,experimental:el<HTMLInputElement>('.model-experimental input').checked});options.selected?.(selected);
 }
 el('[data-access]').onclick=()=>window.dispatchEvent(new Event('bambi-open-privacy'));
 el('[data-download]').onclick=()=>void action(async()=>{await requireAccess('modelDownloads');await select();await json('/api/models/setup/install',{});state=await json('/api/models/setup');});
 el('[data-use]').onclick=()=>void action(async()=>{await select();await reload();});
 el('[data-copy]').onclick=()=>void action(async()=>{await select();const result=await (window as any).bambiDesktop.copyModelData();if(result.error)throw Error(result.error);state=await json('/api/models/setup');});
 el('[data-prepare]').onclick=()=>void action(async()=>{await json('/api/desktop/setup/prepare',{});await json('/api/models/onboarding',{});await reload();options.prepared?.();});
 el('[data-cancel]').onclick=()=>void action(async()=>{await json('/api/models/setup/cancel',{});state=await json('/api/models/setup');});
 el('.model-experimental input').addEventListener('change',showState);
 el('[data-recheck]').onclick=()=>void action(reload);
 el('[data-back]').onclick=()=>pane(Math.max(0,step-1));el('[data-next]').onclick=()=>pane(Math.min(2,step+1));
 for(const button of root.querySelectorAll<HTMLElement>('[data-step]'))button.onclick=()=>pane(Number(button.dataset.step));
 el('[data-finish]').onclick=()=>void action(async()=>{await json('/api/models/onboarding',{});options.finish?.();});
 await reload();
 const timer=setInterval(async()=>{if(stopped||polling)return;polling=true;try{const previous=state?.phase;state=await json('/api/models/setup');if(state&&state.phase!==previous&&['installed','ready'].includes(state.phase))await reload();else showState();}catch{}finally{polling=false;}},1000);
 return ()=>{stopped=true;clearInterval(timer);};
}

export async function initModelOnboarding(options:{selected:(id:string)=>void;prepared:()=>void}){
 const dialog=document.createElement('dialog');dialog.id='model-onboarding';dialog.setAttribute('aria-labelledby','model-onboarding-title');
 const heading=document.createElement('h2');heading.id='model-onboarding-title';heading.textContent='Set up your local companion';
 const host=document.createElement('div');dialog.append(heading,host);document.body.append(dialog);
 let cleanup:(()=>void)|undefined;
 const dismiss=async()=>{try{await json('/api/models/onboarding',{});dialog.close();cleanup?.();cleanup=undefined;}catch(error){const message=document.createElement('p');message.textContent=String(error);host.append(message);}};
 const open=async()=>{if(dialog.open)return;dialog.showModal();host.textContent='Checking your computer…';try{cleanup=await initModelSetup(host,{...options,finish:()=>void dismiss()});}catch(error){host.textContent=String(error);const close=document.createElement('button');close.textContent='Set up later';close.onclick=()=>void dismiss();host.append(close);}};
 dialog.addEventListener('cancel',event=>{event.preventDefault();void dismiss();});
 document.getElementById('local-models-open')?.addEventListener('click',()=>void open());
 const state=await json('/api/models/onboarding');
 const capabilities=await fetch('/api/desktop/capabilities').then(r=>r.ok?r.json():null).catch(()=>null);
 if(capabilities?.alpha&&!state.done)await open();
}
