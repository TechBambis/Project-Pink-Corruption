// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {profileFile,readProfileFile,shareCode,readShareCode,encryptBackup,decryptBackup} from '../../../packages/profiles/codec';
import {portablePreferences,exportPreferences,preferenceGroup,machinePreference,type Preferences} from '../../../packages/profiles/preferences';
import {BackupSchema,MAX_BACKUP_BYTES,MAX_PROFILE_BYTES,type ProfileDocument,type ProfileBackup,type ProfileImport} from '../../../packages/profiles/schema';
import './profiles.css';

const field=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const input=(id:string)=>field<HTMLInputElement>(id);
const groups:ProfileImport['groups']=['Voice & sound','Visuals','Triggers','Session & conversation','Personal text'];
function download(text:string,name:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function request(path:string,options?:RequestInit){const response=await fetch(path,options);const data=await response.json();if(!response.ok)throw Error(data.error||'The local profile could not be read.');return data;}
function label(key:string){
 const control=document.getElementById(key),owner=control?.closest('label');
 if(!owner)return key.replaceAll('-',' ');
 const copy=owner.cloneNode(true) as HTMLElement;copy.querySelectorAll('input,select,textarea,button,.hint').forEach(n=>n.remove());return copy.textContent?.trim()||key.replaceAll('-',' ');
}
export function initProfiles(hooks:{settings:()=>Record<string,unknown>;ready:()=>Promise<void>;stop:()=>void}){
 const dialog=field<HTMLDialogElement>('profiles-dialog'),status=field('profiles-status'),preview=field('profiles-preview');
 let pending:ProfileDocument|ProfileBackup|null=null,busy=false,epoch=0;
 const message=(text:string)=>{status.textContent=text;};
 const reset=()=>{pending=null;preview.hidden=true;field<HTMLButtonElement>('profiles-apply').disabled=true;};
 const run=(task:(generation:number)=>Promise<void>)=>{if(busy)return;busy=true;const generation=++epoch;
  dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  dialog.setAttribute('aria-busy','true');
  void task(generation).catch(error=>{if(generation===epoch)message(error instanceof Error?error.message:'The profile could not be processed.');}).finally(()=>{
   busy=false;dialog.removeAttribute('aria-busy');dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);field<HTMLButtonElement>('profiles-apply').disabled=!pending;
  });
 };
 const draft=(personal=false):ProfileDocument=>({format:'bambi-profile',version:1,kind:personal?'personal':'preset',name:input('profiles-name').value.trim()||'Shared settings',created:new Date().toISOString(),settings:personal?exportPreferences(hooks.settings()):portablePreferences(hooks.settings(),input('profiles-personal-text').checked)});
 const showPreview=(profile:ProfileDocument|ProfileBackup)=>{
  pending=profile;const settings=profile.settings as Preferences,current=hooks.settings();
  field('profiles-preview-title').textContent=profile.format==='bambi-backup'?'Personal backup':profile.name;
  field('profiles-preview-date').textContent='Saved '+new Date(profile.created).toLocaleString();
  const list=field('profiles-groups');list.replaceChildren();
  for(const group of groups){
   const keys=[...new Set([...Object.keys(portablePreferences(current,true)),...Object.keys(settings)])].filter(key=>preferenceGroup(key)===group&&!machinePreference(key));const entries=keys.map(key=>[key,settings[key]] as const);if(!entries.length&&profile.format!=='bambi-backup')continue;
   const row=document.createElement('section'),check=document.createElement('input'),title=document.createElement('label'),details=document.createElement('details'),summary=document.createElement('summary'),table=document.createElement('table');
   check.type='checkbox';check.checked=profile.format==='bambi-backup'||entries.some(([,value])=>value!==undefined);check.dataset.profileGroup=group;title.className='check';title.append(check,document.createTextNode(`${group} · ${entries.length} settings`));
   summary.textContent='Review changes';const body=document.createElement('tbody');
   for(const [key,value] of entries){const tr=document.createElement('tr');for(const text of [label(key),current[key]===undefined?'Default':String(current[key]),value===undefined?'Default when replacing':String(value)]){const td=document.createElement('td');td.textContent=text;tr.append(td);}body.append(tr);}
   const head=document.createElement('thead'),tr=document.createElement('tr');for(const text of ['Setting','Current','Imported']){const th=document.createElement('th');th.scope='col';th.textContent=text;tr.append(th);}head.append(tr);table.append(head,body);details.append(summary,table);row.append(title,details);list.append(row);
  }
  const isBackup=profile.format==='bambi-backup';
  field('profiles-private-selection').hidden=!isBackup;
  input('profiles-restore-memory').checked=false;input('profiles-restore-library').checked=false;
  input('profiles-restore-memory').disabled=!isBackup||!profile.memory;
  input('profiles-restore-library').disabled=!isBackup||!profile.library;
  field('profiles-memory-count').textContent=isBackup&&profile.memory?`${profile.memory.turns.length} chat messages and ${profile.memory.facts.filter(f=>f.current).length} current memories`:'No chat memories in this file';
  field('profiles-library-count').textContent=isBackup&&profile.library?`${profile.library.length} library entries; reselect local media files after restoring`:'No library data in this file';
  input('profiles-replace').checked=isBackup;
  preview.hidden=false;field<HTMLButtonElement>('profiles-apply').disabled=false;
  const retained=Object.keys(settings).filter(machinePreference).length;
  message(`Ready to review. Nothing has been changed.${retained?' Computer and device settings stay on this computer.':''}`);
  preview.scrollIntoView({block:'start'});field('profiles-preview-title').focus({preventScroll:true});
 };
 async function recovery(){
  const points=await request('/api/profiles/recovery'),list=field('profiles-recovery-list');list.replaceChildren();
  if(!points.length){list.textContent='A recovery point is saved before importing settings or restoring a backup.';return;}
  for(const point of points){const row=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='quiet';button.textContent=`${point.label} · ${new Date(point.created).toLocaleString()}`;
   button.onclick=()=>run(async generation=>{const document=BackupSchema.parse(await request('/api/profiles/recovery/'+encodeURIComponent(point.id)));if(generation===epoch)showPreview(document);});row.append(button);list.append(row);}
 }
 field('profiles-open').onclick=()=>{reset();input('profiles-code-input').value='';input('profiles-password').value='';input('profiles-password-confirm').value='';input('profiles-restore-password').value='';message('Everything here stays offline. Choose what you want to share or keep.');dialog.showModal();run(async()=>recovery());};
 field('profiles-close').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('close',()=>{epoch++;reset();for(const id of ['profiles-code-output','profiles-code-input','profiles-password','profiles-password-confirm','profiles-restore-password'])input(id).value='';input('profiles-file').value='';});
 field('profiles-generate').onclick=()=>run(async generation=>{const code=await shareCode(draft());if(generation!==epoch)return;input('profiles-code-output').value=code;message(`Offline code ready (${code.length.toLocaleString()} characters). Copy it or save a settings file.`);});
 field('profiles-copy').onclick=()=>run(async()=>{const code=input('profiles-code-output').value;if(!code)throw Error('Create a code first.');try{await navigator.clipboard.writeText(code);message('Setting code copied.');}catch{input('profiles-code-output').focus();input('profiles-code-output').select();message('Select Copy in your browser, or press Ctrl/Cmd+C.');}});
 field('profiles-export').onclick=()=>run(async()=>{download(await profileFile(draft()),'shared-settings.bambi-profile.json');message('Shared settings file saved.');});
 field('profiles-export-personal').onclick=()=>run(async()=>{download(await profileFile(draft(true)),'my-settings.bambi-profile.json');message('Personal settings saved. This file contains your personal text and is not encrypted. Use an encrypted backup for private storage.');});
 const invalidateCode=()=>{epoch++;input('profiles-code-output').value='';};input('profiles-personal-text').onchange=invalidateCode;input('profiles-name').oninput=invalidateCode;
 input('profiles-code-input').oninput=()=>{epoch++;reset();};
 field('profiles-read-code').onclick=()=>run(async generation=>{reset();const document=await readShareCode(input('profiles-code-input').value);if(document.kind!=='preset')throw Error('Use a shared setting code. Personal settings belong in a profile file.');if(generation===epoch)showPreview(document);});
 input('profiles-file').onchange=()=>{epoch++;reset();run(async generation=>{
  reset();const file=input('profiles-file').files?.[0];if(!file)return;
  if(file.size>MAX_BACKUP_BYTES*1.4)throw Error('This backup file is too large.');
  const text=await file.text(),format=JSON.parse(text)?.format;
  const document=format==='bambi-encrypted-backup'?await decryptBackup(text,input('profiles-restore-password').value):await readProfileFile(text);
  if(generation===epoch)showPreview(document);
 });};
 field('profiles-read-file').onclick=()=>{input('profiles-file').dispatchEvent(new Event('change'));};
 field('profiles-backup').onclick=()=>run(async()=>{
  const password=input('profiles-password').value;if(password!==input('profiles-password-confirm').value)throw Error('The backup passwords do not match.');if(password.length<8)throw Error('Use a backup password of at least 8 characters.');
  await hooks.ready();const backup=BackupSchema.parse(await request(`/api/profiles/backup?memory=${input('profiles-backup-memory').checked}&library=${input('profiles-backup-library').checked}`));
  download(await encryptBackup(backup,password),'my-profile.bambi-backup.json');input('profiles-password').value='';input('profiles-password-confirm').value='';message('Encrypted backup saved. Keep its password separately; it cannot be recovered by the app.');
 });
 field('profiles-apply').onclick=()=>run(async()=>{
  if(!pending)throw Error('Review a setting code or file first.');
  const selection=[...field('profiles-groups').querySelectorAll<HTMLInputElement>('input:checked')].map(i=>i.dataset.profileGroup) as ProfileImport['groups'];
  const memory=input('profiles-restore-memory').checked,library=input('profiles-restore-library').checked;
  if(!selection.length&&!memory&&!library)throw Error('Select at least one group to import.');
  await hooks.ready();hooks.stop();
  const result=await request('/api/profiles/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document:pending,groups:selection,mode:input('profiles-replace').checked?'replace':'merge',memory,library})});
  if(result.ok){localStorage.removeItem('bambi-profile');localStorage.removeItem('bambi-library');location.reload();}
 });
 // File validation also applies before parsing or decoding, independent of its suffix.
 input('profiles-code-input').maxLength=MAX_PROFILE_BYTES*3;
}
