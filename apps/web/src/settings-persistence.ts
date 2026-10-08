// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import {z} from 'zod';
import {validateSettings,type Settings} from '../../../packages/settings';
export type SettingsSnapshot={revision:number;profile:string;settings:Settings;undoRevision:number|null};
const snapshotSchema=z.object({revision:z.number().int().nonnegative(),profile:z.string().min(1),settings:z.unknown(),undoRevision:z.number().int().nonnegative().nullable()});
export function parseSnapshot(value:unknown):SettingsSnapshot{const parsed=snapshotSchema.parse(value);return {...parsed,settings:validateSettings(parsed.settings)};}
export function mergeSettingsDraft(base:Settings,local:Settings,remote:Settings){
 const settings={...remote},conflicts:string[]=[];
 for(const id of Object.keys(local))if(local[id]!==base[id]){
  if(remote[id]!==base[id]&&remote[id]!==local[id])conflicts.push(id);
  settings[id]=local[id];
 }
 return {settings,conflicts};
}
export type SaveState='loading'|'saved'|'pending'|'saving'|'error'|'conflict';
export class SettingsPersistence {
 private base:SettingsSnapshot|null=null;
 private current:Settings={};
 private initial:Settings={};
 private timer:ReturnType<typeof setTimeout>|undefined;
 private flight:Promise<void>|null=null;
 private blocked=false;
 private conflicts:string[]=[];
 private ready=false;
 private generation=0;
 private draftFailure=false;
 state:SaveState='loading';
 constructor(private options:{storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;draftKey?:string;recoverDrafts?:()=>string[];fetch:typeof fetch;apply:(settings:Settings)=>void;status:(state:SaveState,message:string)=>void}){}
 private get draftKey(){return this.options.draftKey??'bambi-settings-draft';}
 private drafts(){
  try{const own=this.options.storage.getItem(this.draftKey);return own?[own]:[...(this.options.recoverDrafts?.()??[]),this.options.storage.getItem('bambi-settings-draft')].filter((value):value is string=>!!value);}
  catch{this.draftFailure=true;return [];}
 }
 get snapshot(){return this.base;}
 get settings(){return {...this.current};}
 private status(state:SaveState,message:string){if(this.draftFailure&&['pending','error'].includes(state)){state='error';message='Browser draft could not be retained. Keep this window open and retry saving.';}this.state=state;this.options.status(state,message);}
 private stash(){
  try{
   if(this.same())this.options.storage.removeItem(this.draftKey);
   else this.options.storage.setItem(this.draftKey,JSON.stringify({updatedAt:Date.now(),profile:this.base?.profile,revision:this.base?.revision,base:this.base?.settings??this.initial,settings:this.current}));
   this.draftFailure=false;
  }catch{this.draftFailure=true;}
  // This compatibility snapshot is not authoritative and cannot erase another window's draft.
  try{this.options.storage.setItem('bambi-profile',JSON.stringify(this.current));}catch{}
 }
 private async read(){const response=await this.options.fetch('/api/settings',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Could not read saved settings');return parseSnapshot(await response.json());}
 async initialize(initial:Settings,legacy:Settings={}){
  this.initial=validateSettings(initial);const hadEdits=Object.keys(this.current).length>0;if(!hadEdits)this.current={...initial};
  try{
   const snapshot=await this.read();let draft:null|{profile?:string;base:Settings;settings:Settings}=null;
   for(const text of this.drafts()){try{const raw=JSON.parse(text);if(raw&&(raw.profile===undefined||raw.profile===snapshot.profile)){draft={profile:raw.profile,base:validateSettings(raw.base),settings:validateSettings(raw.settings)};break;}}catch{}}
   const startupEdits=mergeSettingsDraft(this.initial,this.current,{}).settings;
   let local:Settings,merge;
   if(draft){local={...draft.settings,...startupEdits};merge=mergeSettingsDraft(draft.base,local,snapshot.settings);}
   else{local=Object.keys(snapshot.settings).length?snapshot.settings:{...initial,...legacy};merge={settings:{...local,...startupEdits},conflicts:[]};}
   this.base=snapshot;this.current=validateSettings({...initial,...merge.settings});this.ready=true;this.conflicts=merge.conflicts;this.blocked=!!merge.conflicts.length;
   this.options.apply(this.current);this.stash();
   if(this.blocked)this.status('conflict','Another window saved different values for: '+merge.conflicts.join(', ')+'. Your draft is retained.');
   else if(this.same())this.status('saved','All settings saved');else{this.status('pending','Changes waiting to save');this.schedule();}
  }catch(error){
   this.ready=false;
   if(!hadEdits){const startupEdits=mergeSettingsDraft(this.initial,this.current,{}).settings;let fallback=legacy;for(const text of this.drafts()){try{const raw=JSON.parse(text);if(raw){fallback=validateSettings(raw.settings);break;}}catch{}}this.current={...initial,...fallback,...startupEdits};}
   this.options.apply(this.current);
   this.status('error','Saved settings unavailable. Your local draft is retained. Retry when the server is available.');
  }
 }
 private same(){return this.base&&Object.entries(this.current).every(([id,value])=>this.base!.settings[id]===value)&&Object.keys(this.base.settings).every(id=>id in this.current);}
 edit(settings:Settings){
  try{this.current=validateSettings(settings);this.generation++;this.stash();
   if(!this.ready||this.blocked)return;
   if(this.same()){this.status('saved','All settings saved');return;}
   this.status('pending','Changes waiting to save');this.schedule();
  }catch{this.status('error','Check the setting value. Invalid values have not been saved.');}
 }
 private schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(()=>{}),700);}
 async flush():Promise<void>{
  clearTimeout(this.timer);
  if(this.flight){await this.flight;if(!this.same()&&!this.blocked)return this.flush();return;}
  if(!this.ready||!this.base)throw Error('Read saved settings before saving');
  if(this.blocked)throw Error('Resolve the settings conflict before saving');
  if(this.same())return;
  const run=async()=>{
   this.status('saving','Saving settings…');
   let conflicts=0;
   for(let attempt=0;attempt<10;attempt++){
    const settings={...this.current},generation=this.generation;
    try{
     const response=await this.options.fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),body:JSON.stringify({revision:this.base!.revision,settings})});
     if(!response.ok&&response.status!==409)throw Error('Save returned HTTP '+response.status);
     const snapshot=parseSnapshot(await response.json());
     if(snapshot.profile!==this.base!.profile)throw Error('The server profile changed; reload and review your draft');
     if(response.status===409){
      if(++conflicts>2)throw Error('Settings changed repeatedly in another window; retry saving');
      const merged=mergeSettingsDraft(this.base!.settings,this.current,snapshot.settings);
      this.base=snapshot;this.current=merged.settings;this.conflicts=merged.conflicts;this.blocked=!!merged.conflicts.length;
      this.options.apply(this.current);this.stash();
      if(this.blocked){this.status('conflict','Another window changed: '+this.conflicts.join(', ')+'. Choose which values to keep.');throw Error('Settings conflict');}
      if(this.same()){this.status('saved','All settings saved');return;}
      continue;
     }
     this.base=snapshot;
     // An acknowledgement only clears the values that actually reached SQLite.
     if(generation===this.generation)this.current=snapshot.settings;
     this.stash();
     if(this.same()){this.status('saved','All settings saved');return;}
    }catch(error){if(!this.blocked)this.status('error','Settings were not saved. Your draft is retained. Retry saving.');this.stash();throw error;}
   }
   this.status('pending','More changes waiting to save');this.schedule();throw Error('Settings are still changing; retry after editing');
  };
  this.flight=run();try{await this.flight;}finally{this.flight=null;}
 }
 async retry(){if(!this.ready){await this.initialize(this.initial);if(!this.ready)throw Error('Saved settings unavailable');}await this.flush();}
 async resolve(keepDraft:boolean){
  const snapshot=await this.read();if(this.base&&snapshot.profile!==this.base.profile)throw Error('The server profile changed; reload first');
  if(!keepDraft)this.current=snapshot.settings;
  else this.current=mergeSettingsDraft(this.base?.settings??{},this.current,snapshot.settings).settings;
  this.base=snapshot;this.blocked=false;this.conflicts=[];this.options.apply(this.current);this.stash();await this.flush();this.status('saved','All settings saved');
 }
 accept(snapshot:SettingsSnapshot){this.base=snapshot;this.current=snapshot.settings;this.ready=true;this.blocked=false;this.generation++;this.options.apply(this.current);this.stash();this.status('saved','All settings saved');}
}
