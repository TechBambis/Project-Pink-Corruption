// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import {sectionLabels,settingsRegistry,settingLabel,type Settings,type SettingsSection} from '../../../packages/settings';
import {createSettingsFile,parseSettingsFile,settingsFileLimit,selectedFileSettings,type SettingsFile} from '../../../packages/settings/transfer';
import {SettingsPersistence,parseSnapshot,type SaveState} from './settings-persistence';
import './settings-transfer.css';
const node=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export function showSettingsSaveStatus(state:SaveState,message:string){
 const status=node('settings-save-status');status.textContent=message;status.dataset.state=state;const summary=node('settings-save-summary');summary.textContent=state==='saved'?'Settings saved':state==='saving'?'Saving settings…':state==='pending'?'Settings waiting to save':state==='loading'?'Loading saved settings…':state==='conflict'?'Settings conflict · review your draft':'Settings not saved · retry';summary.dataset.state=state;
 node('settings-retry').hidden=state!=='error';node('settings-keep-draft').hidden=state!=='conflict';node('settings-use-saved').hidden=state!=='conflict';
}
export function initSettingsTransfer(options:{persistence:SettingsPersistence;current:()=>Settings;stop:()=>void;apply:(settings:Settings)=>void;available:(id:string,value:string)=>boolean}){
 const {persistence}=options,dialog=node<HTMLDialogElement>('settings-transfer-dialog');
 let mode:'settings'|'preset'|'save'|'import'='settings',incoming:SettingsFile|null=null,captured:Settings={},busy=false;
 let importRequestId='',presets:SettingsFile[]=[],previewRevision:number|null=null,previewGeneration='';
 const message=(text:string)=>{node('settings-transfer-status').textContent=text;};
 const error=(error:unknown)=>{node('settings-review-error').textContent=error instanceof Error?error.message:String(error);};
 const sections=()=>[...node('settings-section-choices').querySelectorAll<HTMLInputElement>('input:checked')].map(input=>input.value as SettingsSection);
 const printable=(value:unknown)=>value===undefined?'Not set':String(value);
 const unavailable=(settings:Settings)=>Object.entries(settings).filter(([id,value])=>['model','voice','voice2','audio-preset','brainwave-preset'].includes(id)&&typeof value==='string'&&value!==''&&!options.available(id,value));
 function fileForReview(){
  return incoming??createSettingsFile(captured,mode==='settings'?'settings':'preset',node<HTMLInputElement>('settings-file-name').value,sections(),node<HTMLTextAreaElement>('settings-file-description').value);
 }
 function render(){
  node('settings-review-error').textContent='';
  for(const id of ['settings-transfer-close','settings-transfer-cancel'])node<HTMLButtonElement>(id).disabled=busy;
  for(const control of dialog.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea'))control.disabled=busy;
  try{
   const file=fileForReview(),values=selectedFileSettings(file,sections()),missing=new Set(unavailable(values).map(([id])=>id));
   node('settings-requirements').textContent=missing.size?'Unavailable choices will stay unchanged: '+[...missing].map(id=>settingLabel(id)+' = '+values[id]).join('; ')+'. Install or choose resources separately.':'Resource choices are reviewed locally. No downloads or preparation will start.';
   const table=document.createElement('table'),caption=document.createElement('caption');caption.textContent=mode==='import'?file.name+' · review changes':'File contents · '+Object.keys(values).length+' settings';table.append(caption);
   const head=document.createElement('tr');for(const text of mode==='import'?['Setting','Saved value','Incoming value']:['Setting','Value']){const th=document.createElement('th');th.textContent=text;th.scope='col';head.append(th);}table.append(head);
   for(const [id,value] of Object.entries(values)){
    if(mode==='import'&&value===persistence.settings[id])continue;
    const row=document.createElement('tr');const cells=mode==='import'?[settingLabel(id),printable(persistence.settings[id]),printable(value)+(missing.has(id)?' · unavailable; keep saved value':'')]:[settingLabel(id),printable(value)];
    for(const text of cells){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}table.append(row);
   }
   node('settings-transfer-preview').replaceChildren(table);
   node<HTMLButtonElement>('settings-transfer-confirm').disabled=busy||!sections().length||!Object.keys(values).length;
  }catch(caught){error(caught);node<HTMLButtonElement>('settings-transfer-confirm').disabled=true;}
 }
 function choices(file?:SettingsFile){
  const container=node('settings-section-choices');container.replaceChildren();
  for(const [section,labelText] of Object.entries(sectionLabels)){
   if(file&&!file.sections[section])continue;if(!file&&mode!=='settings'&&section==='machine')continue;
   const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=section;input.id='settings-section-'+section;
   input.checked=file?true:section==='personal'?mode==='settings':section!=='machine';
   label.append(input,labelText);container.append(label);input.onchange=render;
  }
 }
 async function openExport(nextMode:typeof mode){
  try{
   persistence.edit(options.current());await persistence.flush();
   captured=persistence.settings;incoming=null;mode=nextMode;
   node('settings-transfer-title').textContent=mode==='settings'?'Export personal settings':mode==='save'?'Save named preset':'Share preset';
   node('settings-transfer-note').textContent=mode==='settings'?'Review exactly what your file includes. Machine settings are optional; reconnect behavior and permissions stay outside this file.':'Portable audio, visuals, trigger timing and session settings. Personal text is off by default. Saving an existing name replaces that preset.';
   node('settings-file-metadata').hidden=false;node<HTMLInputElement>('settings-file-name').value=mode==='settings'?'My settings':'My preset';node<HTMLTextAreaElement>('settings-file-description').value='';
   node('settings-transfer-confirm').textContent=mode==='save'?'Save preset':'Download file';choices();render();dialog.showModal();
  }catch(caught){message('Save settings before exporting: '+String(caught));}
 }
 async function openImport(file:SettingsFile){
  persistence.edit(options.current());await persistence.flush();
  mode='import';incoming=file;importRequestId=crypto.randomUUID();previewRevision=persistence.snapshot!.revision;previewGeneration=JSON.stringify(persistence.settings);
  node('settings-transfer-title').textContent='Import '+(file.kind==='preset'?'preset':'settings');
  node('settings-transfer-note').textContent=file.name+(file.description?' — '+file.description:'')+'. Applying stops the active session. Only selected settings change; microphone, devices and AI preparation stay inactive. Importing machine settings turns automatic device reconnect off.';
  node('settings-file-metadata').hidden=true;node('settings-transfer-confirm').textContent='Stop session & apply selected';choices(file);render();dialog.showModal();
 }
 async function refreshPresets(){
  const response=await fetch('/api/settings/presets');if(!response.ok)throw Error('Saved presets unavailable');
  const data:unknown=await response.json();if(!Array.isArray(data))throw Error('Invalid preset list');presets=data.map(parseSettingsFile);
  const select=node<HTMLSelectElement>('settings-presets'),previous=select.value;
  select.replaceChildren(new Option(presets.length?'Choose a preset':'No saved presets',''),...presets.map(file=>new Option(file.name,file.name)));select.value=presets.some(file=>file.name===previous)?previous:'';
  sync();
 }
 function sync(){
  node<HTMLButtonElement>('settings-undo').disabled=persistence.snapshot?.undoRevision===null||!persistence.snapshot||persistence.state!=='saved';
  const chosen=!!node<HTMLSelectElement>('settings-presets').value;for(const id of ['preset-apply','preset-delete'])node<HTMLButtonElement>(id).disabled=!chosen;
 }
 node('settings-export').onclick=()=>void openExport('settings');node('preset-share').onclick=()=>void openExport('preset');node('preset-save').onclick=()=>void openExport('save');
 node('settings-import').onclick=()=>node<HTMLInputElement>('settings-import-file').click();
 node<HTMLInputElement>('settings-import-file').onchange=async()=>{
  const input=node<HTMLInputElement>('settings-import-file'),file=input.files?.[0];if(!file)return;
  try{if(file.size>settingsFileLimit)throw Error('Choose a settings file under 96 KiB');await openImport(parseSettingsFile(await file.text()));}catch(caught){message('Import rejected: '+String(caught));}finally{input.value='';}
 };
 for(const id of ['settings-transfer-close','settings-transfer-cancel'])node(id).onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 for(const id of ['settings-file-name','settings-file-description'])node(id).oninput=render;
 node('settings-transfer-confirm').onclick=async()=>{
  if(busy)return;busy=true;render();
  try{
   const file=fileForReview();
   if(mode==='import'){
    persistence.edit(options.current());await persistence.flush();
    if(persistence.snapshot!.revision!==previewRevision||JSON.stringify(persistence.settings)!==previewGeneration)throw Error('Settings changed while reviewing. Close and import again to review current values.');
    const clean=structuredClone(file);
    for(const [id] of unavailable(selectedFileSettings(clean,sections())))delete clean.sections[settingsRegistry[id].section]![id];
    options.stop();
    const response=await fetch('/api/settings/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:previewRevision,requestId:importRequestId,file:clean,sections:sections()}),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error(response.status===409?'Another window saved settings. Import again to review changes.':'Import was not acknowledged. Retry only after reading saved settings.');
    const snapshot=parseSnapshot(await response.json());persistence.accept(snapshot);options.apply(persistence.settings);message(snapshot.revision===previewRevision?'Selected settings already match. No values changed.':'Selected settings imported. Undo is available until the next settings change.');
   }else if(mode==='save'){
    const response=await fetch('/api/settings/presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(file)});if(!response.ok)throw Error('Could not save named preset');await refreshPresets();message('Preset saved: '+file.name);
   }else{
    const blob=new Blob([JSON.stringify(file,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=file.name.replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,60)+(file.kind==='preset'?'.bambi-preset.json':'.bambi-settings.json');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Exported '+file.name);
   }
   dialog.close();sync();
  }catch(caught){error(caught);}finally{busy=false;render();}
 };
 node('settings-presets').onchange=sync;
 node('preset-apply').onclick=()=>{const file=presets.find(file=>file.name===node<HTMLSelectElement>('settings-presets').value);if(file)void openImport(file).catch(caught=>message(String(caught)));};
 node('preset-delete').onclick=async()=>{try{const response=await fetch('/api/settings/presets',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:node<HTMLSelectElement>('settings-presets').value})});if(!response.ok)throw Error('Could not delete preset');await refreshPresets();message('Preset deleted');}catch(caught){message(String(caught));}};
 node('settings-undo').onclick=async()=>{
  try{await persistence.flush();options.stop();const response=await fetch('/api/settings/undo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:persistence.snapshot!.revision})});
   if(!response.ok)throw Error('Undo unavailable because settings changed.');persistence.accept(parseSnapshot(await response.json()));options.apply(persistence.settings);message('Settings restored to before the import');sync();
  }catch(caught){message(String(caught));}
 };
 node('settings-retry').onclick=()=>void persistence.retry().then(sync).catch(caught=>message(String(caught)));
 node('settings-keep-draft').onclick=()=>void persistence.resolve(true).then(sync).catch(caught=>message(String(caught)));
 node('settings-use-saved').onclick=()=>void persistence.resolve(false).then(sync).catch(caught=>message(String(caught)));
 void refreshPresets().catch(caught=>message(String(caught)));
 return {sync};
}
