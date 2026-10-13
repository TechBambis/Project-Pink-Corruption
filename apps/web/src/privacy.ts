// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {AccessChoicesSchema,deniedAccess,visibleAccessKeys,type AccessKey} from '../../../packages/safety/access';
import {accessState,accessAllowed,acceptAccess} from './privacy-state';
import './privacy.css';

const labels:Record<Exclude<AccessKey,'contextToCloud'>,[string,string]>={
 microphone:['Microphone','Listen only after you press the microphone button. Audio goes to local speech recognition. Your system may ask for permission too.'],
 devices:['Device control','Scan, connect and control supported devices when you choose them. Turning this off stops device output and disconnects the bridge.'],
 modelDownloads:['Model downloads','Download the selected public AI and speech files from their pinned sources. Transfers still require a separate click.'],
 onlineMedia:['Online session audio','Import and stream public BambiCloud sessions you select. The media service sees your network connection.'],
 cloudAI:['Cloud AI','Send prompts, shared conversation history and any permitted date, time or approximate place to the configured AI provider when a remote model is selected. Local AI remains available without this.'],
 localClock:['Local date and time','Let the companion use your computer’s date, time and time zone as gentle session context. No internet lookup.'],
 approximateLocation:['Approximate place from IP','On your request, GeoJS estimates a city from your public IP. GeoJS and its network provider see that IP. No chat, microphone audio or precise coordinates are sent.'],
};
export async function initPrivacy(){
 const dialog=document.createElement('dialog');dialog.id='privacy-access';dialog.setAttribute('aria-labelledby','privacy-access-title');
 dialog.innerHTML=`<form><h2 id="privacy-access-title">Your companion, your choices</h2><p class="privacy-intro">Optional features are selected by default, except local date and time and approximate place from IP. Save to apply your choices. You can change them later in Extras → Privacy &amp; access.</p><section class="privacy-required"><h3>Required app functions</h3><p class="hint">These local functions are always enabled.</p></section><h3>Optional access</h3><div class="privacy-choices"></div>
 <section class="privacy-context"><h3>Session context preview</h3><p data-clock>No date or time will be added.</p><p data-place>No place has been saved.</p><div class="privacy-place-actions"><button type="button" data-find-place disabled>Find approximate place</button><button type="button" data-clear-place disabled>Forget place</button></div><p class="hint">IP location can point to a VPN, mobile provider or another city. It does not establish your home address. Lookup saves the approximate city and country locally until you forget them or disable this access.</p><a href="https://www.geojs.io/privacy/" target="_blank" rel="noopener noreferrer">GeoJS privacy policy</a></section>
 <p class="privacy-baseline">The app uses its own profile, model files and logs, plays audio, and reads basic hardware information to suggest a model. Imported files are chosen by you. These switches control app features; they do not replace operating-system permissions.</p><p class="hint">Saving stops any active session so your choices apply immediately. Already spoken or saved chat mentions are not removed; you can clear conversation memory separately.</p>
 <p data-privacy-error role="alert" hidden></p><p data-privacy-status role="status" aria-live="polite"></p><div class="privacy-actions"><button type="button" data-local-only>Keep optional access off</button><button type="button" data-privacy-close hidden>Cancel</button><button type="submit">Save and continue</button></div></form>`;
 document.body.append(dialog);
 const policyLink=dialog.querySelector<HTMLAnchorElement>('.privacy-context a')!;
 policyLink.onclick=event=>{const desktop=(window as any).bambiDesktop;if(desktop?.openPrivacyPolicy){event.preventDefault();void desktop.openPrivacyPolicy().catch(()=>{el('[data-privacy-error]').textContent='Open https://www.geojs.io/privacy/ in your browser to read the provider policy.';el('[data-privacy-error]').hidden=false;});}};
 const form=dialog.querySelector('form')!,list=dialog.querySelector('.privacy-choices')!;
 const el=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
 for(const [name,titleText,detailText] of [
  ['storage','Local app storage','Use the app’s own profile, model files and logs. Imported files are chosen by you.'],
  ['audio','Audio playback','Play session audio and the companion’s voice. You can mute audio separately.'],
  ['hardware','Basic hardware information','Read processor, memory and graphics information to suggest a compatible local model.'],
 ]){
  const row=document.createElement('label');row.className='privacy-choice privacy-required-choice';
  const input=document.createElement('input');input.type='checkbox';input.name='required-'+name;input.checked=true;input.disabled=true;input.setAttribute('data-required','');
  const text=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('span');title.textContent=titleText;detail.textContent=detailText;text.append(title,detail);row.append(input,text);el('.privacy-required').append(row);
 }
 for(const key of visibleAccessKeys){
  const row=document.createElement('label');row.className='privacy-choice';
  const input=document.createElement('input');input.type='checkbox';input.name=key;input.id='access-'+key;
  const text=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('span');title.textContent=labels[key][0];detail.textContent=labels[key][1];text.append(title,detail);row.append(input,text);list.append(row);
 }
 let busy=false,first=false,resolveFirst:(()=>void)|undefined;
 function choices(){return AccessChoicesSchema.parse({...Object.fromEntries(visibleAccessKeys.map(key=>[key,el<HTMLInputElement>('[name='+key+']').checked])),contextToCloud:el<HTMLInputElement>('[name=cloudAI]').checked});}
 function preview(){
  const flags=choices();
  el<HTMLButtonElement>('[data-find-place]').disabled=busy||!flags.approximateLocation;
  el<HTMLButtonElement>('[data-clear-place]').disabled=busy||!accessState.record.place;
  el('[data-clock]').textContent=flags.localClock?new Intl.DateTimeFormat('en-GB',{dateStyle:'full',timeStyle:'short'}).format(new Date())+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone:'No date or time will be added.';
  el('[data-place]').textContent=accessState.record.place?`${flags.approximateLocation?'Approximate saved place':'Saved place will be removed when you save'}: ${[accessState.record.place.city,accessState.record.place.region,accessState.record.place.country].filter(Boolean).join(', ')}. IP estimate from ${new Date(accessState.record.place.checkedAt).toLocaleDateString('en-GB')}.`:'No place has been saved.';
 }
 function fill(){for(const key of visibleAccessKeys)el<HTMLInputElement>('[name='+key+']').checked=accessState.record.choices[key];preview();}
 function stopWaiting(){dialog.close();resolveFirst?.();resolveFirst=undefined;}
 async function save(value=choices()){
  const response=await fetch('/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const record=await response.json();if(!response.ok)throw Error(record.error||'Access choices could not be saved.');acceptAccess(record);fill();
 }
 async function action(work:()=>Promise<void>){
  if(busy)return;busy=true;el('[data-privacy-error]').hidden=true;
  for(const control of form.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))control.disabled=true;
  try{await work();}catch(error){el('[data-privacy-error]').textContent=String(error);el('[data-privacy-error]').hidden=false;}
  finally{busy=false;for(const control of form.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))control.disabled=control.hasAttribute('data-required');preview();}
 }
 for(const input of list.querySelectorAll('input'))input.addEventListener('change',preview);
 form.onsubmit=event=>{event.preventDefault();void action(async()=>{await save();stopWaiting();});};
 el('[data-local-only]').onclick=()=>void action(async()=>{await save({...deniedAccess});stopWaiting();});
 el('[data-privacy-close]').onclick=stopWaiting;
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(busy)return;if(first)void action(async()=>{await save({...deniedAccess});stopWaiting();});else stopWaiting();});
 el('[data-find-place]').onclick=()=>void action(async()=>{
  await save();el('[data-privacy-status]').textContent='Requesting an approximate city from GeoJS…';
  const response=await fetch('/api/access/location',{method:'POST'}),result=await response.json();if(!response.ok)throw Error(result.error||'The IP location is unavailable.');
  const refreshed=await fetch('/api/access');if(!refreshed.ok)throw Error('The saved place could not be checked.');acceptAccess(await refreshed.json());fill();el('[data-privacy-status]').textContent='Approximate place saved. It can now be used in local sessions.';
 });
 el('[data-clear-place]').onclick=()=>void action(async()=>{const response=await fetch('/api/access/location',{method:'DELETE'});if(!response.ok)throw Error('The saved place could not be removed.');acceptAccess(await response.json());preview();el('[data-privacy-status]').textContent='Saved place removed.';});
 const open=async()=>{if(dialog.open)return;try{const response=await fetch('/api/access');if(!response.ok)throw Error('Access choices could not be loaded.');accessState.record=await response.json();first=!accessState.record.configured;fill();el('[data-privacy-close]').hidden=first;el('[data-privacy-error]').hidden=true;el('[data-privacy-status]').textContent='';dialog.showModal();dialog.scrollTop=0;}catch(error){const status=document.getElementById('privacy-access-summary');if(status)status.textContent=String(error);throw error;}};
 document.getElementById('privacy-access-open')?.addEventListener('click',()=>void open().catch(()=>{}));
 window.addEventListener('bambi-open-privacy',event=>void open().then(()=>{const key=(event as CustomEvent).detail?.feature;if(visibleAccessKeys.includes(key)){const input=el<HTMLInputElement>('[name='+key+']');input.scrollIntoView({block:'center'});input.focus();}}).catch(()=>{}));
 window.addEventListener('bambi-access-changed',()=>{const summary=document.getElementById('privacy-access-summary');if(summary)summary.textContent=visibleAccessKeys.filter(key=>accessAllowed(key)).length+' optional permissions enabled';if(dialog.open&&!busy)fill();});
 const response=await fetch('/api/access');if(!response.ok)throw Error('Privacy settings are unavailable. Optional access remains disabled.');accessState.record=await response.json();
 if(!accessState.record.configured){const waiting=new Promise<void>(resolve=>{resolveFirst=resolve;});await open();await waiting;}
 acceptAccess(accessState.record);
}
