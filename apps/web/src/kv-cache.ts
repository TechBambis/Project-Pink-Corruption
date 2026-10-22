// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

interface CacheContext {supported?:boolean;model:string;target:string;enabled?:boolean;busy:boolean}
interface RuntimeOption {endpoint:string;preparing:string;missing:string;unsupported:string;target:string;busy:string;on:string;off:string;failure:string}
const cacheOption:RuntimeOption={endpoint:'/api/runtime/kv-cache',preparing:'Preparing local AI with the selected cache…',missing:'The server has not reported Q8 support. Restart Bambi Local after updating, then reload this page.',unsupported:'Q8 cache testing is available on Linux.',target:'Select Hauhau 9B to test this option.',busy:'Stop the session, mute the microphone and finish replies before changing the cache.',on:'On · Q8 cache. Switch off to return to the standard cache.',off:'Off · standard cache. Switch on to compare Q8.',failure:'The cache setting could not be applied.'};
export const dflashOption:RuntimeOption={endpoint:'/api/runtime/dflash',preparing:'Preparing Hauhau 4B with the selected DFlash setting…',missing:'The server has not reported DFlash support. Restart Bambi Local after updating, then reload this page.',unsupported:'DFlash testing is available in the Linux local app.',target:'Select Hauhau 4B to test this option.',busy:'Stop the session, mute the microphone and finish replies before changing DFlash.',on:'On · DFlash with three draft tokens. Switch off to compare the same 4B model.',off:'Off · standard 4B generation. Switch on to compare DFlash.',failure:'The DFlash setting could not be applied.'};
/** The server saves the preference only after its owned runtime is prepared. */
export class KvCacheControl {
 pending=false;
 private enabled=false;
 private reported:boolean|undefined;
 private controller:AbortController|null=null;
 constructor(private input:HTMLInputElement,private note:HTMLElement,private context:()=>CacheContext,
  private beforeChange:()=>void,private changed:()=>void,private failure:(message:string)=>void,private option:RuntimeOption=cacheOption){
  input.addEventListener('change',()=>void this.apply());
 }
 cancel(){this.controller?.abort();}
 sync(){
  const s=this.context();
  if(!this.pending&&typeof s.enabled==='boolean'&&s.enabled!==this.reported){this.reported=s.enabled;this.enabled=s.enabled;this.input.checked=s.enabled;}
  const disabled=this.pending||s.busy||!s.supported||s.model!==s.target;
  if(this.input.disabled!==disabled)this.input.disabled=disabled;
  const o=this.option,message=this.pending?o.preparing:s.supported===undefined?o.missing:!s.supported?o.unsupported:s.model!==s.target?o.target:s.busy?o.busy:this.enabled?o.on:o.off;
  if(this.note.textContent!==message)this.note.textContent=message;
 }
 private async apply(){
  if(this.pending)return;
  const s=this.context(),wanted=this.input.checked,previous=this.enabled;
  if(s.busy||!s.supported||s.model!==s.target){this.input.checked=previous;this.sync();return;}
  const controller=new AbortController();this.controller=controller;
  this.pending=true;this.beforeChange();this.sync();
  try{
   const response=await fetch(this.option.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({enabled:wanted,model:s.model})});
   const data=await response.json();
   if(!response.ok||data.ok!==true||data.enabled!==wanted)throw Error(data.error||this.option.failure);
   this.enabled=wanted;
   this.failure('');
  }catch(error){this.enabled=previous;if(!controller.signal.aborted)this.failure(error instanceof Error?error.message:this.option.failure);}
  finally{this.controller=null;this.input.checked=this.enabled;this.pending=false;this.sync();this.changed();}
 }
}
