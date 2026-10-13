// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage';
import {settingsDefaults,settingsRegistry,validateSettings,migrateStoredSettings,runtimeSettingsInventory,type Settings} from '../packages/settings';
import {createSettingsFile,parseSettingsFile,selectedFileSettings,settingsFileLimit,ImportSettingsSchema} from '../packages/settings/transfer';
import {SettingsPersistence,mergeSettingsDraft,type SettingsSnapshot} from '../apps/web/src/settings-persistence';
const sectionNames=['audio','visuals','triggers','session','personal','machine'] as const;
const defaults=settingsDefaults();
const storage=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const snapshot=(settings:Settings,revision=0):SettingsSnapshot=>({settings,revision,profile:'test-profile',undoRevision:null});

test('registry covers the original preference controls and classifies transient/derived controls',()=>{
 assert.ok(Object.keys(settingsRegistry).length>=138,'Retain the published settings and register new controls');
 assert.deepEqual(validateSettings(defaults),defaults);
 const html=readFileSync('apps/web/index.html','utf8');
 for(const match of html.matchAll(/<(?:input|select|textarea)\s+[^>]*id="([^"]+)"/g)){
  const id=match[1];if(/^(settings-|preset-)/.test(id))continue;
  assert.ok(settingsRegistry[id]||id in runtimeSettingsInventory,'Unclassified user control '+id);
 }
 assert.equal(settingsRegistry['mic-smart-turns'].default,false,'Checkboxes are stored as booleans');
 for(const [id,field] of Object.entries(settingsRegistry)){assert.ok(field.schema.safeParse(field.default).success,id);assert.ok(sectionNames.includes(field.section));}
});

test('settings validation rejects ranges, unknown fields, invalid structured settings and external resources',()=>{
 for(const value of [{master:'2'},{master:'.365'},{speed:NaN},{'spiral-complexity':'2'},{'mic-smart-turns':'on'},{'trigger-timing-config':'{}'},{'trigger-selection':'[{}]'},{model:'C:\\models\\test.gguf'},{model:'https://evil.test/model'},{cloudAPIKey:'secret'},{'device-enabled':true},{approximateLocation:true}])assert.throws(()=>validateSettings(value),JSON.stringify(value));
 assert.deepEqual(validateSettings({master:.5}),{master:'0.5'});assert.equal(validateSettings({model:'hf.co/example/model:q4'}).model,'hf.co/example/model:q4');
 const migrated=migrateStoredSettings({duration:'1200',persona:'Prior text','spiral-complexity':'2.2',master:'0.4','device-enabled':true});
 assert.equal(migrated.duration,'unlimited');assert.equal(migrated['guided-style'],'Prior text');assert.equal(migrated['spiral-complexity'],'1.5');assert.ok(!('device-enabled' in migrated));
});

test('personal settings roundtrip every supported setting; presets exclude machine fields and personal text by default',()=>{
 const settings:Settings={...defaults,'bambi-name':'Test user',persona:'Private custom text','collar-name':'Private collar','guided-style':'Private direction','device-address':'AA:BB:CC:DD:EE:FF'};
 const file=createSettingsFile(settings,'settings','My settings',[...sectionNames]);
 const roundtrip=selectedFileSettings(parseSettingsFile(JSON.stringify(file)),[...sectionNames]);
 for(const [id,value] of Object.entries(settings))if(settingsRegistry[id].transfer)assert.equal(roundtrip[id],value,id);
 assert.ok(!('device-auto-connect' in roundtrip));
 const preset=createSettingsFile(settings,'preset','Quiet',['audio','visuals','triggers','session']);
 const text=JSON.stringify(preset);for(const privateValue of ['Test user','Private custom text','Private collar','Private direction','AA:BB:CC:DD:EE:FF','device-','privacy-access','location','token','model-sources'])assert.ok(!text.includes(privateValue),privateValue);
 assert.equal(preset.requirements.model,settings.model);
 const explicit=createSettingsFile(settings,'preset','Personal recipe',['session','personal']);assert.equal(explicit.sections.personal?.persona,settings.persona);
 assert.throws(()=>parseSettingsFile({...preset,sections:{...preset.sections,machine:{'device-vib-max':'.8'}}}));
 assert.throws(()=>parseSettingsFile({...preset,sections:{session:{'bambi-name':'Unexpected personal text'}}}));
 assert.throws(()=>parseSettingsFile({...preset,sections:{personal:{cloudAPIKey:'secret'}}}));
});

test('known version migration, future versions, malicious fields, size bounds and selected sections',()=>{
 const old={format:'bambi-settings',version:0,kind:'settings',name:'Legacy',preferences:{duration:'1200',persona:'Prior text',master:'.4'}};
 const migrated=parseSettingsFile(old);assert.equal(migrated.version,1);assert.equal(migrated.sections.session?.duration,'unlimited');assert.equal(migrated.sections.personal?.['guided-style'],'Prior text');
 assert.throws(()=>parseSettingsFile({...old,preferences:{master:'5'}}));
 assert.throws(()=>parseSettingsFile({...old,preferences:{'privacy-access':true}}));
 assert.throws(()=>parseSettingsFile({...migrated,version:2}));assert.throws(()=>parseSettingsFile('x'.repeat(settingsFileLimit+1)));
 assert.throws(()=>parseSettingsFile({...migrated,command:'curl evil'}));
 assert.throws(()=>parseSettingsFile({...migrated,sections:JSON.parse('{"session":{"__proto__":{}}}')}));
 assert.deepEqual(selectedFileSettings(migrated,['audio']),{master:'0.4'});
 assert.ok(!ImportSettingsSchema.safeParse({revision:0,file:migrated,sections:[]}).success);
});

test('SQLite revisions, atomic imports, undo, profile isolation and same-profile restart retention',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bambi-settings-store-')),path=join(directory,'profile.sqlite');
 let store=new Store(path);
 try{
  // An older executable's profile layout, plus histories and model-source references.
  store.set('profile',{...defaults,'duration-version':1,'dialogue-version':1,'visuals-version':2});store.addTurn('user','Isolated retained history');store.set('model-sources',{modelRoot:'C:\\Bambi\\models',installed:['fixture.gguf']});store.set('privacy-access',{microphone:true});
  const initial=store.settingsSnapshot();assert.equal(initial.revision,0);
  const ordinary=store.saveSettings(0,{...defaults,master:'.3'});assert.equal(ordinary.conflict,false);assert.equal(ordinary.revision,1);
  assert.equal(store.saveSettings(0,{...defaults,master:'.9'}).conflict,true);assert.equal(store.settingsSnapshot().settings.master,'0.3');
  const imported=store.saveSettings(1,{...ordinary.settings,master:'.2',persona:'Imported'},true);assert.equal(imported.undoRevision,2);
  store.db.close();store=new Store(path);assert.equal(store.settingsSnapshot().settings.persona,'Imported');assert.equal(store.settingsSnapshot().undoRevision,2);
  const undo=store.undoSettings(2);assert.equal(undo.conflict,false);assert.equal(undo.settings.master,'0.3');assert.equal(undo.settings.persona,defaults.persona);assert.equal(undo.undoRevision,null);
  assert.equal(store.recent()[0].content,'Isolated retained history');assert.deepEqual(store.get('model-sources'),{modelRoot:'C:\\Bambi\\models',installed:['fixture.gguf']});assert.deepEqual(store.get('privacy-access'),{microphone:true});
  const another=new Store(path,'other');assert.equal(another.settingsSnapshot().revision,0);assert.deepEqual(another.settingsSnapshot().settings,{});another.db.close();
  const rev=store.settingsSnapshot().revision;store.saveSettings(rev,{master:'.4'},true);store.saveSettings(rev+1,{master:'.5'});assert.equal(store.undoSettings(rev+2).conflict,true,'Undo cannot overwrite later edits');
  const before=store.settingsSnapshot();const set=store.set.bind(store);store.set=(key,value)=>{if(key==='settings-revision')throw Error('simulated storage failure');set(key,value);};
  assert.throws(()=>store.saveSettings(before.revision,{master:'.8'},true));assert.deepEqual(store.settingsSnapshot(),before,'Transaction rolls back restore point and preferences together');
 }finally{store.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('named presets persist without changing live settings, and duplicate names replace one snapshot',()=>{
 const store=new Store(':memory:');try{
  const before=store.settingsSnapshot();const file=createSettingsFile(defaults,'preset','Quiet',['audio']);store.saveSettingsPreset(file);store.saveSettingsPreset({...file,description:'Updated'});
  assert.equal(store.settingsPresets().length,1);assert.equal(store.settingsPresets()[0].description,'Updated');assert.deepEqual(store.settingsSnapshot(),before);
  assert.equal(store.deleteSettingsPreset('Quiet').length,0);
 }finally{store.db.close();}
});

test('failed PUT followed by reopening preserves newer unsaved draft over older durable settings',async()=>{
 const local=storage(),states:string[]=[];let remote=snapshot(defaults,3),fail=true,applied:Settings={};
 const request:typeof fetch=async(_url,init)=>{
  if(!init?.method)return json(remote);if(fail)return json({error:'Disk unavailable'},503);
  const write=JSON.parse(String(init.body));remote=snapshot(write.settings,remote.revision+1);return json(remote);
 };
 const create=()=>new SettingsPersistence({storage:local,fetch:request,apply:settings=>{applied=settings;},status:state=>states.push(state)});
 const first=create();await first.initialize(defaults);first.edit({...defaults,master:'.2'});await assert.rejects(()=>first.flush());assert.equal(first.state,'error');
 const reopened=create();await reopened.initialize(defaults);assert.equal(applied.master,'0.2');assert.equal(remote.settings.master,defaults.master);
 fail=false;await reopened.flush();assert.equal(remote.settings.master,'0.2');assert.equal(local.getItem('bambi-settings-draft'),null);assert.ok(states.includes('error'));
});

test('acknowledged serialized saves never clear edits made during a save; lost acknowledgement recovers',async()=>{
 const local=storage();let remote=snapshot(defaults,1),release:()=>void=()=>{},entered:()=>void=()=>{},calls=0;
 const ready=new Promise<void>(done=>entered=done);
 const p=new SettingsPersistence({storage:local,apply:()=>{},status:()=>{},fetch:async(_url,init)=>{
  if(!init?.method)return json(remote);calls++;const write=JSON.parse(String(init.body));
  if(calls===1){entered();await new Promise<void>(done=>release=done);}
  if(write.revision!==remote.revision)return json(remote,409);
  remote=snapshot(write.settings,remote.revision+1);return json(remote);
 }});
 await p.initialize(defaults);p.edit({...defaults,master:'.2'});const flight=p.flush();await ready;p.edit({...defaults,master:'.7'});release();await flight;
 assert.equal(calls,2);assert.equal(remote.settings.master,'0.7');assert.equal(p.state,'saved');
 let lost=true;const lostClient=new SettingsPersistence({storage:local,apply:()=>{},status:()=>{},fetch:async(_url,init)=>{
  if(!init?.method)return json(remote);const write=JSON.parse(String(init.body));if(write.revision!==remote.revision)return json(remote,409);remote=snapshot(write.settings,remote.revision+1);if(lost){lost=false;throw Error('Connection closed after commit');}return json(remote);
 }});
 await lostClient.initialize(defaults);lostClient.edit({...remote.settings,master:'.1'});await assert.rejects(()=>lostClient.flush());await lostClient.retry();assert.equal(lostClient.state,'saved');assert.equal(remote.settings.master,'0.1');
});

test('two-window conflicts preserve drafts, merge disjoint changes, and require explicit resolution for overlaps',async()=>{
 assert.deepEqual(mergeSettingsDraft({master:'.1',speed:'1'},{master:'.2',speed:'1'},{master:'.1',speed:'.8'}),{settings:{master:'.2',speed:'.8'},conflicts:[]});
 let remote=snapshot(defaults,1);
 const make=()=>new SettingsPersistence({storage:storage(),apply:()=>{},status:()=>{},fetch:async(_url,init)=>{if(!init?.method)return json(remote);const write=JSON.parse(String(init.body));if(write.revision!==remote.revision)return json(remote,409);remote=snapshot(write.settings,remote.revision+1);return json(remote);}});
 const a=make(),b=make();await a.initialize(defaults);await b.initialize(defaults);a.edit({...defaults,master:'.4'});await a.flush();b.edit({...defaults,speed:'.9'});await b.flush();assert.equal(remote.settings.master,'0.4');assert.equal(remote.settings.speed,'0.9');
 const c=make(),d=make();await c.initialize(defaults);await d.initialize(defaults);c.edit({...remote.settings,master:'.5'});await c.flush();d.edit({...d.settings,master:'.6'});await assert.rejects(()=>d.flush());assert.equal(d.state,'conflict');assert.equal(remote.settings.master,'0.5');await d.resolve(true);assert.equal(remote.settings.master,'0.6');
});

test('unavailable startup read cannot replace an existing retained draft',async()=>{
 const local=storage(),draft=JSON.stringify({profile:'test-profile',revision:1,base:defaults,settings:{...defaults,persona:'Offline draft'}});local.setItem('bambi-settings-draft',draft);
 let applied:Settings={};const p=new SettingsPersistence({storage:local,fetch:async()=>{throw Error('offline');},apply:settings=>{applied=settings;},status:()=>{}});
 await p.initialize(defaults);assert.equal(applied.persona,'Offline draft');assert.equal(local.getItem('bambi-settings-draft'),draft);assert.equal(p.state,'error');await assert.rejects(()=>p.flush());
});

test('each window retains its own draft; another successful save cannot erase an unsaved window',async()=>{
 const local=storage();let remote=snapshot(defaults,1);
 const create=(id:string)=>new SettingsPersistence({storage:local,draftKey:'draft:'+id,apply:()=>{},status:()=>{},fetch:async(_url,init)=>{
  if(!init?.method)return json(remote);const write=JSON.parse(String(init.body));if(write.revision!==remote.revision)return json(remote,409);remote=snapshot(write.settings,remote.revision+1);return json(remote);
 }});
 const a=create('a'),b=create('b');await a.initialize(defaults);await b.initialize(defaults);a.edit({...defaults,master:'.2'});b.edit({...defaults,speed:'.9'});await b.flush();assert.ok(local.getItem('draft:a'));assert.equal(local.getItem('draft:b'),null);
 const reopened=create('a');await reopened.initialize(defaults);assert.equal(reopened.settings.master,'0.2');assert.equal(reopened.settings.speed,'0.9');await reopened.flush();await a.flush();assert.equal(remote.settings.master,'0.2');
});

test('edits made while the initial server read is in flight survive startup',async()=>{
 let release:()=>void=()=>{},remote=snapshot(defaults,4),first=true;
 const p=new SettingsPersistence({storage:storage(),apply:()=>{},status:()=>{},fetch:async(_url,init)=>{
  if(!init?.method){if(first){first=false;await new Promise<void>(done=>release=done);}return json(remote);}
  remote=snapshot(JSON.parse(String(init.body)).settings,5);return json(remote);
 }});
 const initializing=p.initialize(defaults);p.edit({...defaults,persona:'Typed during startup'});release();await initializing;assert.equal(p.settings.persona,'Typed during startup');await p.flush();assert.equal(remote.settings.persona,'Typed during startup');
});

test('browser draft storage failure stays visible until a durable save is acknowledged',async()=>{
 const p=new SettingsPersistence({storage:{getItem:()=>null,setItem:()=>{throw Error('quota full');},removeItem:()=>{}},apply:()=>{},status:()=>{},fetch:async(_url,init)=>init?.method?json(snapshot(JSON.parse(String(init.body)).settings,1)):json(snapshot(defaults))});
 await p.initialize(defaults);p.edit({...defaults,master:'.2'});assert.equal(p.state,'error');await p.flush();assert.equal(p.state,'saved');
});

test('a failed initial read preserves edits typed while waiting, including when browser storage is unavailable',async()=>{
 let failRead=true,release:()=>void=()=>{};
 const p=new SettingsPersistence({storage:{getItem:()=>{throw Error('storage unavailable');},setItem:()=>{throw Error('storage unavailable');},removeItem:()=>{throw Error('storage unavailable');}},apply:()=>{},status:()=>{},fetch:async(_url,init)=>{
  if(init?.method)return json(snapshot(JSON.parse(String(init.body)).settings,1));
  if(failRead){await new Promise<void>(done=>release=done);throw Error('offline');}return json(snapshot(defaults));
 }});
 const initializing=p.initialize(defaults);p.edit({...defaults,persona:'Typed before read failed'});release();await initializing;assert.equal(p.settings.persona,'Typed before read failed');assert.equal(p.state,'error');
 failRead=false;await p.retry();assert.equal(p.settings.persona,'Typed before read failed');assert.equal(p.state,'saved');
});

test('Windows and Linux personal files retain portable values and omit external local directories',()=>{
 const windows:Settings={...defaults,persona:'Windows user – café','device-address':'AA:BB:CC:DD:EE:FF','device-write-char':'0000fff1-0000-1000-8000-00805f9b34fb'};
 const windowsFile=createSettingsFile(windows,'settings','Windows settings',[...sectionNames]);
 const onLinux=selectedFileSettings(parseSettingsFile(JSON.stringify(windowsFile,null,2).replaceAll('\n','\r\n')),[...sectionNames]);
 assert.equal(onLinux.persona,windows.persona);assert.equal(onLinux.model,windows.model);
 const linuxFile=createSettingsFile({...onLinux,persona:'Linux user – café'},'settings','Linux settings',[...sectionNames]);assert.equal(selectedFileSettings(parseSettingsFile(JSON.stringify(linuxFile)),['personal']).persona,'Linux user – café');
 for(const model of ['C:\\Bambi\\models\\model.gguf','/home/fixture/models/model.gguf','file:///C:/Bambi/model.gguf'])assert.throws(()=>parseSettingsFile({...windowsFile,sections:{session:{model}}}));
 const fresh=new Store(':memory:');try{const initial=fresh.settingsSnapshot();const restored=fresh.saveSettings(initial.revision,{...defaults,...onLinux},true);for(const [id,value] of Object.entries(onLinux))assert.equal(restored.settings[id],value,id);}finally{fresh.db.close();}
});
