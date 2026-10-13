// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../packages/storage';
import {PreferencesSchema,portablePreferences,preferenceKeys} from '../packages/profiles/preferences';
import {BackupSchema,ImportSchema,MAX_PROFILE_BYTES,MAX_BACKUP_BYTES,type ProfileDocument,type ProfileImport} from '../packages/profiles/schema';
import {profileFile,readProfileFile,shareCode,readShareCode,encryptBackup,decryptBackup,base64url} from '../packages/profiles/codec';
import {PreferenceSave} from '../apps/web/src/preference-save';
import {settingsRegistry} from '../packages/settings';
const groups:ProfileImport['groups']=['Voice & sound','Visuals','Triggers','Session & conversation','Personal text'];
const preset=(settings:ProfileDocument['settings']={speed:'0.8',scene:'Spiral Focus'}):ProfileDocument=>({format:'bambi-profile',version:1,kind:'preset',name:'Nächte ♡',created:'2026-10-09T12:00:00.000Z',settings});
const importing=(document:ProfileImport['document'],extra:Partial<ProfileImport>={}):ProfileImport=>({document,groups,mode:'merge',memory:false,library:false,...extra});

test('all existing controls have a portable schema; sensitive and machine fields are opt-in or excluded',()=>{
 const ids=Object.keys(settingsRegistry).filter(k=>!k.startsWith('direction-style-')&&!k.startsWith('direction-scene-'));
 assert.deepEqual(ids.filter(k=>k!=='narration-pause-'&&!preferenceKeys.includes(k)),[]);
 const sourceSettings={speed:'0.9',persona:'Personal text',model:'private-model','device-address':'private-address','device-auto-connect':true,'mic-recognizer':'whisper','q8-kv-cache':true,'event-haptics':true,'bambi-name':'Private name','privacy-access':true,apiKey:'secret',speed2:'unknown'};
 assert.deepEqual(portablePreferences(sourceSettings),{speed:'0.9'});
 assert.deepEqual(portablePreferences(sourceSettings,true),{speed:'0.9',persona:'Personal text','bambi-name':'Private name'});
 assert.deepEqual(portablePreferences({'direction-motifs':'heart','direction-theme':'ease','conversation-topic':'general','direction-intent':'Private intention'}),{'direction-motifs':'heart','direction-theme':'ease','conversation-topic':'general'});
});
test('preference import rejects unknown keys, wrong types, invalid choices, bad timing and out-of-range values',()=>{
 for(const raw of [{unknown:'a'},{'privacy-access':true},{devices:true},{speed:'Infinity'},{speed:'99'},{scene:'Not a scene'},{voice:'unknown_voice'},{'prompt-template':'not-a-prompt'},{'brainwave-preset':'Not a preset'},{'visuals-enabled':'true'},{'trigger-selection':'not json'},{'trigger-timing-config':'{}'},JSON.parse('{"__proto__":{"polluted":true}}')])assert.equal(PreferencesSchema.safeParse(raw).success,false,JSON.stringify(raw));
 assert(PreferencesSchema.safeParse({duration:'unlimited','spiral-color-a':'#ff77aa','narration-pause-anchor':''}).success);
 for(const speed of ['0x1',' 1 ','1.'])assert.equal(PreferencesSchema.safeParse({speed}).success,false);
 assert.equal(ImportSchema.safeParse(importing(preset(),{memory:true})).success,false);
 assert.equal(ImportSchema.safeParse(importing({format:'bambi-backup',version:1,created:'2026-10-09T12:00:00.000Z',settings:{}},{library:true})).success,false);
 assert.equal(ImportSchema.safeParse(importing(preset(),{groups:['Visuals','Visuals']})).success,false);
});
test('offline codes and files preserve unicode and reject damage and unsupported versions',async()=>{
 const document=preset({speed:'0.8',persona:'Äpfel ♡\nA complete custom text.'});
 const code=await shareCode(document);assert(code.startsWith('BAMBI1.'));
 assert.deepEqual(await readShareCode(code.match(/.{1,60}/g)!.join('\n')),document);
 const file=await profileFile(document);assert.deepEqual(await readProfileFile(file),document);
 const bad=JSON.parse(file);bad.document.settings.speed='0.9';await assert.rejects(readProfileFile(JSON.stringify(bad)),/checksum/);
 bad.document.version=2;await assert.rejects(readProfileFile(JSON.stringify(bad)));
 await assert.rejects(readShareCode('BAMBI2.abc'),/newer/);
 await assert.rejects(readShareCode(code.slice(0,-10)));
 await assert.rejects(profileFile(preset({model:'private'})),/computer-specific/);
});
test('decompression stops oversized payloads instead of parsing a compressed bomb',async()=>{
 const blob=new Blob(['x'.repeat(MAX_PROFILE_BYTES*3)]);
 const compressed=new Uint8Array(await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 await assert.rejects(readShareCode('BAMBI1.'+base64url(compressed)),/Expanded profile/);
});
test('encrypted backups round-trip, use fresh randomness and reject wrong passwords or modified headers/data',async()=>{
 const backup={format:'bambi-backup' as const,version:1 as const,created:'2026-10-09T12:00:00.000Z',settings:{persona:'Private text'}};
 const first=await encryptBackup(backup,'correct password'),second=await encryptBackup(backup,'correct password');
 assert(!first.includes('Private text'));assert.notEqual(first,second);
 assert.deepEqual(await decryptBackup(first,'correct password'),backup);
 await assert.rejects(decryptBackup(first,'wrong password'),/Incorrect password/);
 const damaged=JSON.parse(first);damaged.data=(damaged.data[0]==='A'?'B':'A')+damaged.data.slice(1);await assert.rejects(decryptBackup(JSON.stringify(damaged),'correct password'),/damaged/);
 damaged.iterations=1;await assert.rejects(decryptBackup(JSON.stringify(damaged),'correct password'));
 await assert.rejects(encryptBackup(backup,'short'),/8/);
});
test('selected settings merge without moving permissions, model setup, microphone or device configuration',()=>{
 const store=new Store(':memory:');try{
  store.set('profile',{speed:'0.7',scene:'Soft Pink',model:'original','device-address':'mine','device-auto-connect':true,'device-future-calibration':'retained','q8-kv-cache':true});store.set('privacy-access',{configured:true,choices:{microphone:false}});
  const result=store.importProfile(importing(preset({speed:'0.9',scene:'Spiral Focus',model:'other','device-address':'theirs'}),{groups:['Voice & sound']}));
  assert.equal(result.settings.speed,'0.9');assert.equal(result.settings.scene,'Soft Pink');assert.equal(result.settings.model,'original');assert.equal(result.settings['device-address'],'mine');assert.equal(result.settings['device-auto-connect'],false);assert.equal(result.settings['q8-kv-cache'],true);
  assert.equal(result.settings['device-future-calibration'],'retained');
  assert.deepEqual(store.get('privacy-access'),{configured:true,choices:{microphone:false}});
  const recovery=store.recoveryPoint(result.recoveryId)!;assert.equal(recovery.settings.speed,'0.7');assert.equal(store.get('profileImportRevision'),1);
  assert.equal(recovery.memory,undefined);assert.equal(recovery.library,undefined);
  store.importProfile(importing(recovery,{mode:'replace'}));assert.equal((store.get('profile') as any).speed,'0.7');
 }finally{store.db.close();}
});
test('replace restores missing preferences to defaults; merge preserves them',()=>{
 const store=new Store(':memory:');try{
  store.set('profile',{speed:'0.7',persona:'custom',scene:'Soft Pink'});
  store.importProfile(importing(preset({speed:'0.9'}),{mode:'replace',groups:['Personal text','Voice & sound']}));
  assert.equal((store.get('profile') as any).persona,undefined);assert.equal((store.get('profile') as any).scene,'Soft Pink');
 }finally{store.db.close();}
});
test('settings imports remain usable when a legacy transcript exceeds the backup limit',()=>{
 const store=new Store(':memory:');try{
  const content='x'.repeat(MAX_BACKUP_BYTES+1);store.addTurn('user',content);store.set('profile',{speed:'0.7'});
  assert.throws(()=>store.exportProfileBackup(),/supported size/);
  const result=store.importProfile(importing(preset({speed:'0.9'}),{groups:['Voice & sound']}));
  assert.equal(result.settings.speed,'0.9');assert.equal(store.recoveryPoint(result.recoveryId)!.memory,undefined);
  assert.equal(store.db.prepare('SELECT length(content) AS size FROM turns').get()!.size,content.length);
 }finally{store.db.close();}
});
test('backup restore remaps memory revisions, forgotten sources and conversation boundaries without changing another profile',()=>{
 const source=new Store(':memory:'),target=new Store(':memory:');try{
  source.beginConversation();const forgotten=source.addTurn('user','Old address: public fixture');const f=source.saveMemory('address','Old fixture',forgotten);source.forgetFact(f);
  const first=source.addTurn('user','Voice: gentle');source.saveMemory('voice','gentle',first);source.saveMemory('voice','slow',first);
  source.beginConversation();source.addTurn('user','Current conversation');source.set('conversationSummary','A saved summary');
  source.db.prepare('INSERT INTO media VALUES(?,?)').run('fixture.wav',JSON.stringify({id:'fixture.wav',favorite:true,notes:'fixture note',tags:'test'}));
  const backup=source.exportProfileBackup();assert.equal(backup.memory!.facts.length,2);
  target.db.prepare('INSERT INTO turns(role,content,profile_id,conversation_id) VALUES(?,?,?,?)').run('user','Other user','other','other');
  const old=target.addTurn('user','Old target');target.saveMemory('old','discard',old);target.saveMemoryVector(target.memorySource('turn',old)!,'model',new Float32Array([1,0]));
  let invalidated=false;target.onMemoryChange(change=>{if(change==='clear')invalidated=true;});
  target.importProfile(importing(backup,{memory:true,library:true,mode:'replace'}));
  assert(invalidated);assert.equal(target.memoryVectors('model').length,0);assert.deepEqual(target.conversation().map(t=>t.content),['Current conversation']);assert.equal(target.conversationSummary(),'A saved summary');
  assert.equal(target.memoryFacts()[0].value,'slow');assert.notEqual(target.memoryFacts()[0].sourceTurnId,first);
  const restored=target.exportProfileBackup();assert.equal(restored.memory!.forgotten.length,1);assert.equal(target.memorySource('turn',restored.memory!.forgotten[0]),null);
  assert.equal(target.db.prepare('SELECT count(*) AS n FROM turns WHERE profile_id=?').get('other')!.n,1);
  assert.equal(restored.library![0].notes,'fixture note');assert.equal(restored.memory!.facts[1].supersedes,restored.memory!.facts[0].id);
  const recovery=target.recoveryPoint(String(target.recoveryPoints()[0].id))!;target.importProfile(importing(recovery,{memory:true,library:true,mode:'replace'}));assert.deepEqual(target.conversation().map(t=>t.content),['Old target']);
 }finally{source.db.close();target.db.close();}
});
test('invalid references are rejected before changes; failed writes roll back both profile and recovery point',()=>{
 const store=new Store(':memory:');try{
  store.set('profile',{speed:'0.7'});const before=store.exportProfileBackup();
  const malformed=structuredClone(before);malformed.memory!.forgotten=[12345];assert.equal(BackupSchema.safeParse(malformed).success,false);assert.throws(()=>store.importProfile(importing(malformed,{memory:true})));
  store.db.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON preferences WHEN NEW.key='profile' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(()=>store.importProfile(importing(preset({speed:'0.9'}))),/fixture failure/);
  assert.equal((store.get('profile') as any).speed,'0.7');assert.equal(store.recoveryPoints().length,0);assert.equal(store.get('profileImportRevision',0),0);
 }finally{store.db.close();}
});
test('recovery retention is bounded and clear/forget remove private recovery copies',()=>{
 const store=new Store(':memory:');try{
  const turn=store.addTurn('user','Fixture');const fact=store.saveMemory('fixture','value',turn);
  for(let i=0;i<8;i++)store.checkpointProfile('point '+i);assert.equal(store.recoveryPoints().length,5);assert.equal(store.recoveryPoints()[0].label,'point 7');
  store.forgetFact(fact);assert.equal(store.recoveryPoints().length,0);
  store.checkpointProfile('point');store.clearMemory();assert.equal(store.recoveryPoints().length,0);
 }finally{store.db.close();}
});
test('a legacy WAL database is snapshotted before schema mutation, private and not repeatedly backed up',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bambi-profile-upgrade-')),path=join(dir,'bambi.sqlite');const legacy=new DatabaseSync(path);
 try{
  legacy.exec("PRAGMA journal_mode=WAL;CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO preferences VALUES('profile','{\"speed\":\"0.9\"}');");
  const upgraded=new Store(path);assert.equal((upgraded.get('profile') as any).speed,'0.9');upgraded.db.close();
  const files=readdirSync(join(dir,'backups'));assert.equal(files.length,1);const copy=new DatabaseSync(join(dir,'backups',files[0]),{readOnly:true});
  try{assert.equal(copy.prepare("SELECT value FROM preferences WHERE key='profile'").get()!.value,'{"speed":"0.9"}');assert.equal(copy.prepare('PRAGMA user_version').get()!.user_version,0);assert.equal(copy.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');}finally{copy.close();}
  if(process.platform!=='win32')assert.equal(statSync(join(dir,'backups',files[0])).mode&0o777,0o600);
  const again=new Store(path);again.db.close();assert.equal(readdirSync(join(dir,'backups')).length,1);
 }finally{legacy.close();rmSync(dir,{recursive:true,force:true});}
});
test('future database revisions fail closed without changing data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bambi-profile-future-')),path=join(dir,'bambi.sqlite');const db=new DatabaseSync(path);db.exec('PRAGMA user_version=2');db.close();
 try{assert.throws(()=>new Store(path),/newer Bambi/);const check=new DatabaseSync(path);assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,2);check.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('autosaves are serialized and an import conflict cannot be silently retried over restored settings',async()=>{
 const bodies:string[]=[];let release!:()=>void;const errors:string[]=[];
 const saver=new PreferenceSave(message=>errors.push(message),(async(_path,options)=>{bodies.push(String(options?.body));assert.equal((options?.headers as any)['If-Match'],'"profile-0"');if(bodies.length===1)await new Promise<void>(done=>{release=done;});return new Response('{}',{status:bodies.length===1?200:409});}) as typeof fetch);
 saver.save({speed:'.7'});saver.save({speed:'.8'});saver.save({speed:'.9'});release();await assert.rejects(saver.flush());
 assert.deepEqual(bodies.map(s=>JSON.parse(s).speed),['.7','.9']);assert.equal(errors.length,3);await assert.rejects(saver.flush());assert.equal(bodies.length,2);
});
