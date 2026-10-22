// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,existsSync,chmodSync,renameSync,rmSync,openSync,closeSync,fsyncSync } from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {BackupSchema,ImportSchema,MAX_BACKUP_BYTES,MAX_PROFILE_BYTES,checkedSize,type ProfileBackup,type ProfileImport} from '../profiles/schema';
import {exportPreferences,mergePreferences,preferenceGroup} from '../profiles/preferences';
import {cleanDialogueText,visibleDialogueText} from '../ai/dialogue';
import {migrateStoredSettings,validateSettings,profileMetadata,type Settings} from '../settings';
import {SettingsFileSchema,type SettingsFile} from '../settings/transfer';
type Turn={role:'user'|'assistant';content:string;interruption?:string|null};
export type MemoryFact={id:number;key:string;value:string;sourceTurnId:number|null;created:string;supersedes:number|null};
export type MemoryEpisode={id:number;role:Turn['role'];content:string;created:string;interruption:string|null};
export type MemorySource={kind:'turn'|'fact';id:number;content:string};
export type MemoryVector=Omit<MemorySource,'content'>&{hash:string;vector:Uint8Array};
export const memoryHash=(text:string)=>createHash('sha256').update(text).digest('hex');
function zPresets(value:unknown):SettingsFile[]{if(!Array.isArray(value))return [];return value.map(file=>SettingsFileSchema.parse(file)).slice(0,50);}
export class Store {
 db:DatabaseSync;
 private memoryListeners=new Set<(change:'write'|'forget'|'clear')=>void>();
 onMemoryChange(listener:(change:'write'|'forget'|'clear')=>void){this.memoryListeners.add(listener);return ()=>this.memoryListeners.delete(listener);}
 private changed(change:'write'|'forget'|'clear'='write'){for(const listener of this.memoryListeners)listener(change);}
 constructor(path='data/bambi.sqlite',readonly profileId='default'){
  const existing=path!==':memory:'&&existsSync(path);
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);
  const revision=Number((this.db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version);
  if(revision>1){this.db.close();throw Error('This database needs a newer Bambi Local version. It has not been changed.');}
  // VACUUM INTO includes committed WAL pages. Never copy an open SQLite file.
  if(existing&&revision<1){
   const directory=join(dirname(path),'backups');mkdirSync(directory,{recursive:true,mode:0o700});
   const target=join(directory,'before-storage-v1-'+randomUUID()+'.sqlite'),staged=target+'.partial';
   try{
    this.db.prepare('VACUUM INTO ?').run(staged);if(process.platform!=='win32')chmodSync(staged,0o600);
    const snapshot=openSync(staged,'r+');try{fsyncSync(snapshot);}finally{closeSync(snapshot);}renameSync(staged,target);
    if(process.platform!=='win32'){const directoryHandle=openSync(directory,'r');try{fsyncSync(directoryHandle);}finally{closeSync(directoryHandle);}}
   }catch(error){rmSync(staged,{force:true});this.db.close();throw error;}
  }
  if(path!==':memory:'&&process.platform!=='win32')chmodSync(path,0o600);
  this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS turns(id INTEGER PRIMARY KEY,role TEXT,content TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,data TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS metrics(id INTEGER PRIMARY KEY,event TEXT,data TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE IF NOT EXISTS profile_recovery(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,created TEXT NOT NULL,label TEXT NOT NULL,data TEXT NOT NULL);`);
  const columns=(this.db.prepare('PRAGMA table_info(turns)').all() as {name:string}[]).map(column=>column.name);
  if(!columns.includes('interruption'))this.db.exec('ALTER TABLE turns ADD COLUMN interruption TEXT');
  if(!columns.includes('profile_id'))this.db.exec("ALTER TABLE turns ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default'");
  if(!columns.includes('conversation_id'))this.db.exec("ALTER TABLE turns ADD COLUMN conversation_id TEXT NOT NULL DEFAULT 'legacy'");
  this.db.exec(`CREATE INDEX IF NOT EXISTS turns_scope ON turns(profile_id,conversation_id,id);
   CREATE TABLE IF NOT EXISTS memory_facts(id INTEGER PRIMARY KEY,profile_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source_turn_id INTEGER,created TEXT DEFAULT CURRENT_TIMESTAMP,supersedes INTEGER,current INTEGER NOT NULL DEFAULT 1);
   CREATE UNIQUE INDEX IF NOT EXISTS current_memory_fact ON memory_facts(profile_id,key) WHERE current=1;
   CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(content,content='turns',content_rowid='id');
   CREATE TRIGGER IF NOT EXISTS turns_fts_insert AFTER INSERT ON turns BEGIN INSERT INTO turns_fts(rowid,content) VALUES(new.id,new.content); END;
   CREATE TRIGGER IF NOT EXISTS turns_fts_delete AFTER DELETE ON turns BEGIN INSERT INTO turns_fts(turns_fts,rowid,content) VALUES('delete',old.id,old.content); END;
   CREATE TABLE IF NOT EXISTS memory_vectors(profile_id TEXT NOT NULL,kind TEXT NOT NULL,target_id INTEGER NOT NULL,model_id TEXT NOT NULL,content_hash TEXT NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(profile_id,kind,target_id,model_id));
   CREATE TABLE IF NOT EXISTS forgotten_memory_sources(profile_id TEXT NOT NULL,turn_id INTEGER NOT NULL,PRIMARY KEY(profile_id,turn_id));
   CREATE TRIGGER IF NOT EXISTS memory_turn_delete AFTER DELETE ON turns BEGIN DELETE FROM memory_vectors WHERE kind='turn' AND target_id=old.id;DELETE FROM forgotten_memory_sources WHERE turn_id=old.id;END;
   CREATE TRIGGER IF NOT EXISTS memory_turn_update AFTER UPDATE OF content ON turns BEGIN DELETE FROM memory_vectors WHERE kind='turn' AND target_id=old.id;END;
   CREATE TRIGGER IF NOT EXISTS memory_fact_delete AFTER DELETE ON memory_facts BEGIN DELETE FROM memory_vectors WHERE kind='fact' AND target_id=old.id;END;
   CREATE TRIGGER IF NOT EXISTS memory_fact_update AFTER UPDATE OF key,value ON memory_facts BEGIN DELETE FROM memory_vectors WHERE kind='fact' AND target_id=old.id;END;`);
  if(!this.get('memoryIndexVersion',0)){this.db.exec("INSERT INTO turns_fts(turns_fts) VALUES('rebuild')");this.set('memoryIndexVersion',1);}
  this.db.exec('PRAGMA user_version=1');
 }
 private preferenceKey(key:string){return this.profileId==='default'?key:`${this.profileId}:${key}`;}
 get(key:string,fallback:unknown=null){const r=this.db.prepare('SELECT value FROM preferences WHERE key=?').get(this.preferenceKey(key)) as {value:string}|undefined;return r?JSON.parse(r.value):fallback;}
 set(key:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO preferences VALUES(?,?)').run(this.preferenceKey(key),JSON.stringify(value));}
 /** Preference revision and restore point commit with the profile, never separately. */
 settingsSnapshot(){
  const settings=migrateStoredSettings(this.get('profile',{}) as Record<string,unknown>);
  let profile=String(this.get('settings-profile-id',''));
  if(!profile){profile=crypto.randomUUID();this.set('settings-profile-id',profile);}
  const revision=Number(this.get('settings-revision',0));
  const undo=this.get('settings-undo',null) as {revision:number}|null;
  return {revision,profile,settings,undoRevision:undo?.revision===revision?revision:null};
 }
 saveSettings(expected:number,settings:Settings,restorePoint=false,operation?:{id:string;fingerprint:string}){
  const validated=validateSettings(settings);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const current=this.settingsSnapshot();
   if(operation){
    const last=this.get('settings-last-import',null) as {id:string;fingerprint:string;revision:number}|null;
    if(last?.id===operation.id){this.db.exec('ROLLBACK');return {conflict:last.fingerprint!==operation.fingerprint||last.revision!==current.revision,...current};}
   }
   if(current.revision!==expected){this.db.exec('ROLLBACK');return {conflict:true as const,...current};}
   if(restorePoint&&Object.keys(validated).length===Object.keys(current.settings).length&&Object.entries(validated).every(([id,value])=>current.settings[id]===value)){
    if(operation)this.set('settings-last-import',{...operation,revision:current.revision});
    this.db.exec('COMMIT');return {conflict:false as const,...current};
   }
   const revision=current.revision+1;
   if(restorePoint)this.set('settings-undo',{revision,settings:current.settings});
   this.set('profile',{...validated,...profileMetadata});this.set('settings-revision',revision);
   if(operation)this.set('settings-last-import',{...operation,revision});
   this.db.exec('COMMIT');return {conflict:false as const,...this.settingsSnapshot()};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 undoSettings(expected:number){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const current=this.settingsSnapshot();
   const undo=this.get('settings-undo',null) as {revision:number;settings:Settings}|null;
   if(current.revision!==expected||undo?.revision!==expected){this.db.exec('ROLLBACK');return {conflict:true as const,...current};}
   this.set('profile',{...validateSettings(undo.settings),...profileMetadata});this.set('settings-revision',expected+1);this.set('settings-undo',null);
   this.db.exec('COMMIT');return {conflict:false as const,...this.settingsSnapshot()};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 settingsPresets(){return zPresets(this.get('settings-presets',[]));}
 saveSettingsPreset(input:SettingsFile){
  const file=SettingsFileSchema.parse(input);if(file.kind!=='preset')throw Error('Choose a preset');
  this.db.exec('BEGIN IMMEDIATE');
  try{const presets=this.settingsPresets();const index=presets.findIndex(preset=>preset.name===file.name);
   if(index<0&&presets.length>=50)throw Error('Keep at most 50 named presets');
   if(index<0)presets.push(file);else presets[index]=file;
   this.set('settings-presets',presets);this.db.exec('COMMIT');return presets;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 deleteSettingsPreset(name:string){const presets=this.settingsPresets().filter(file=>file.name!==name);this.set('settings-presets',presets);return presets;}
 addTurn(role:string,content:string,interruption:string|null=null){const id=Number(this.db.prepare('INSERT INTO turns(role,content,interruption,profile_id,conversation_id) VALUES(?,?,?,?,?)').run(role,content,interruption,this.profileId,String(this.get('conversationId','legacy'))).lastInsertRowid);this.changed();return id;}
 private clean(turn:Turn):Turn{const interruption=turn.interruption||(turn.content.startsWith('[Response interrupted')?'interrupted':null);return {role:turn.role,content:cleanDialogueText(turn.content),...(interruption?{interruption}:{})};}
 recent(limit=8){return (this.db.prepare('SELECT role,content,interruption FROM turns WHERE profile_id=? ORDER BY id DESC LIMIT ?').all(this.profileId,limit) as Turn[]).reverse().map(turn=>this.clean(turn)).map(turn=>({...turn,content:turn.role==='assistant'?visibleDialogueText(turn.content):turn.content})).filter(turn=>turn.content.trim()).map(({role,content})=>({role,content}));}
 conversation(limit=128){const since=Number(this.get('conversationStart',0));return (this.db.prepare('SELECT role,content,interruption FROM turns WHERE id>? AND profile_id=? AND conversation_id=? ORDER BY id DESC LIMIT ?').all(since,this.profileId,String(this.get('conversationId','legacy')),Math.max(1,Math.min(256,limit))) as Turn[]).reverse().map(turn=>this.clean(turn));}
 conversationSummary(){return visibleDialogueText(String(this.get('conversationSummary',this.get('conversationStart',null)===null?this.get('summary',''):'')));}
 /** Extractive memory of older turns, updated once per ID, never an invented model summary. */
 refreshConversationSummary(keep=8){
  const since=Number(this.get('conversationStart',0)),cursor=Math.max(since,Number(this.get('conversationSummaryCursor',since)));
  const boundary=this.db.prepare('SELECT id FROM turns WHERE id>? AND profile_id=? AND conversation_id=? ORDER BY id DESC LIMIT 1 OFFSET ?').get(since,this.profileId,String(this.get('conversationId','legacy')),keep) as {id:number}|undefined;
  if(!boundary||boundary.id<=cursor)return;
  const rows=this.db.prepare('SELECT id,role,content,interruption FROM turns WHERE id>? AND id<=? AND profile_id=? ORDER BY id').all(cursor,boundary.id,this.profileId) as (Turn&{id:number})[];
  const excerpts=rows.map(row=>{
   const content=visibleDialogueText(this.clean(row).content).trim();
   return content?`${row.role}${row.interruption?' (played excerpt, unfinished)':''}: ${JSON.stringify(row.role==='assistant'?content.slice(-350):content.slice(0,700))}`:'';
  }).filter(Boolean);
  const lines=[...this.conversationSummary().split('\n').filter(Boolean),...excerpts];
  while(lines.join('\n').length>3000&&lines.length>1)lines.shift();
  this.set('conversationSummary',lines.join('\n'));this.set('conversationSummaryCursor',boundary.id);
 }
 beginConversation(){const row=this.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM turns').get() as {id:number};this.set('conversationId',crypto.randomUUID());this.set('conversationStart',row.id);this.set('conversationSummary','');this.set('conversationSummaryCursor',row.id);this.set('replyIntent','conversation');}
 memoryFacts(){return this.db.prepare('SELECT id,key,value,source_turn_id AS sourceTurnId,created,supersedes FROM memory_facts WHERE profile_id=? AND current=1 ORDER BY id DESC').all(this.profileId) as MemoryFact[];}
 saveMemory(key:string,value:string,sourceTurnId:number|null=null){
  key=key.trim().toLowerCase();value=value.trim();if(!key||key.length>80||!value||value.length>1000)throw Error('Invalid memory');
  if(sourceTurnId!==null&&!this.db.prepare("SELECT id FROM turns WHERE id=? AND profile_id=? AND role='user'").get(sourceTurnId,this.profileId))throw Error('Memory must refer to a user turn in this profile');
  const previous=this.db.prepare('SELECT id FROM memory_facts WHERE profile_id=? AND key=? AND current=1').get(this.profileId,key) as {id:number}|undefined;
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE memory_facts SET current=0 WHERE profile_id=? AND key=?').run(this.profileId,key);const result=this.db.prepare('INSERT INTO memory_facts(profile_id,key,value,source_turn_id,supersedes) VALUES(?,?,?,?,?)').run(this.profileId,key,value,sourceTurnId,previous?.id??null);this.db.exec('COMMIT');this.changed();return Number(result.lastInsertRowid);}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 forgetFact(id:number){
  const row=this.db.prepare('SELECT key FROM memory_facts WHERE id=? AND profile_id=?').get(id,this.profileId) as {key:string}|undefined;if(!row)return false;
  this.db.exec('BEGIN IMMEDIATE');try{
   // Forgotten preference revisions must not reappear through their source episodes.
   this.db.prepare('INSERT OR IGNORE INTO forgotten_memory_sources SELECT profile_id,source_turn_id FROM memory_facts WHERE profile_id=? AND key=? AND source_turn_id IS NOT NULL').run(this.profileId,row.key);
   this.db.prepare("DELETE FROM memory_vectors WHERE profile_id=? AND kind='turn' AND target_id IN (SELECT turn_id FROM forgotten_memory_sources WHERE profile_id=?)").run(this.profileId,this.profileId);
   this.db.prepare('DELETE FROM profile_recovery WHERE profile_id=?').run(this.profileId);
   this.db.prepare('DELETE FROM memory_facts WHERE profile_id=? AND key=?').run(this.profileId,row.key);this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  this.changed('forget');return true;
 }
 private episodeCutoff(){const boundary=this.db.prepare('SELECT id FROM turns WHERE profile_id=? ORDER BY id DESC LIMIT 1 OFFSET 31').get(this.profileId) as {id:number}|undefined;return Math.max(Number(this.get('conversationStart',0)),boundary?.id??0);}
 memorySource(kind:MemorySource['kind'],id:number):MemorySource|null{
  if(kind==='fact'){const fact=this.db.prepare('SELECT key,value FROM memory_facts WHERE id=? AND profile_id=? AND current=1').get(id,this.profileId) as {key:string;value:string}|undefined;return fact?{kind,id,content:fact.key+': '+fact.value}:null;}
  const row=this.db.prepare('SELECT role,content,interruption FROM turns WHERE id=? AND profile_id=? AND NOT EXISTS(SELECT 1 FROM forgotten_memory_sources f WHERE f.profile_id=turns.profile_id AND f.turn_id=turns.id)').get(id,this.profileId) as Turn|undefined;
  return row?{kind,id,content:visibleDialogueText(this.clean(row).content).slice(0,1200)}:null;
 }
 pendingMemorySources(model:string,limit=8):MemorySource[]{
  const rows=this.db.prepare(`SELECT 'fact' AS kind,f.id FROM memory_facts f WHERE f.profile_id=? AND f.current=1 AND NOT EXISTS(SELECT 1 FROM memory_vectors v WHERE v.profile_id=f.profile_id AND v.kind='fact' AND v.target_id=f.id AND v.model_id=?)
   UNION ALL SELECT 'turn' AS kind,t.id FROM turns t WHERE t.profile_id=? AND trim(t.content)!='' AND NOT EXISTS(SELECT 1 FROM forgotten_memory_sources f WHERE f.profile_id=t.profile_id AND f.turn_id=t.id) AND NOT EXISTS(SELECT 1 FROM memory_vectors v WHERE v.profile_id=t.profile_id AND v.kind='turn' AND v.target_id=t.id AND v.model_id=?)
   ORDER BY kind,id DESC LIMIT ?`).all(this.profileId,model,this.profileId,model,limit) as {kind:MemorySource['kind'];id:number}[];
  return rows.map(row=>this.memorySource(row.kind,row.id)).filter((s):s is MemorySource=>!!s);
 }
 saveMemoryVector(source:MemorySource,model:string,vector:Float32Array){
  const current=this.memorySource(source.kind,source.id);if(!current||current.content!==source.content)return false;
  if(!vector.length||vector.length>4096||Array.from(vector).some(n=>!Number.isFinite(n)))throw Error('Invalid memory vector');
  const bytes=Buffer.alloc(vector.length*4);vector.forEach((n,i)=>bytes.writeFloatLE(n,i*4));
  this.db.prepare('INSERT OR REPLACE INTO memory_vectors VALUES(?,?,?,?,?,?)').run(this.profileId,source.kind,source.id,model,memoryHash(source.content),bytes);return true;
 }
 memoryVectors(model:string,limit=10000):MemoryVector[]{
  const rows=this.db.prepare(`SELECT v.kind,v.target_id AS id,v.content_hash AS hash,v.vector FROM memory_vectors v WHERE v.profile_id=? AND v.model_id=? AND (
   v.kind='fact' AND EXISTS(SELECT 1 FROM memory_facts f WHERE f.id=v.target_id AND f.profile_id=v.profile_id AND f.current=1) OR
   v.kind='turn' AND v.target_id<=? AND EXISTS(SELECT 1 FROM turns t WHERE t.id=v.target_id AND t.profile_id=v.profile_id) AND NOT EXISTS(SELECT 1 FROM forgotten_memory_sources f WHERE f.profile_id=v.profile_id AND f.turn_id=v.target_id)) ORDER BY v.kind,v.target_id DESC LIMIT ?`).all(this.profileId,model,this.episodeCutoff(),Math.max(1,Math.min(10000,limit))) as MemoryVector[];
  return rows;
 }
 episodesById(ids:number[]):MemoryEpisode[]{
  if(!ids.length)return [];const rows=this.db.prepare(`SELECT id,role,content,created,interruption FROM turns WHERE profile_id=? AND id<=? AND id IN (${ids.map(()=>'?').join(',')}) AND NOT EXISTS(SELECT 1 FROM forgotten_memory_sources f WHERE f.profile_id=turns.profile_id AND f.turn_id=turns.id)`).all(this.profileId,this.episodeCutoff(),...ids) as MemoryEpisode[];
  return ids.flatMap(id=>{const row=rows.find(row=>row.id===id);return row?[{...row,content:visibleDialogueText(this.clean(row).content).slice(0,1200)}]:[];});
 }
 searchEpisodes(query:string,limit=6):MemoryEpisode[]{
  const stop=new Set('the and that this with from have what which when where why how please remember about your you are is was were can could would should tell me my for favorite favourite prefer like enjoy'.split(' '));
  const words=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[])].filter(word=>!stop.has(word)).slice(0,16);
  if(!words.length)return [];
  const match=words.map(word=>'"'+word+'"').join(' OR ');
  const cutoff=this.episodeCutoff();
  const rows=this.db.prepare(`SELECT t.id,t.role,t.content,t.created,t.interruption FROM turns_fts JOIN turns t ON t.id=turns_fts.rowid
   WHERE turns_fts MATCH ? AND t.profile_id=? AND t.id<=? AND NOT EXISTS(SELECT 1 FROM forgotten_memory_sources f WHERE f.profile_id=t.profile_id AND f.turn_id=t.id) ORDER BY bm25(turns_fts),t.id DESC LIMIT ?`).all(match,this.profileId,cutoff,Math.max(1,Math.min(12,limit))) as MemoryEpisode[];
  return rows.map(row=>({...row,content:visibleDialogueText(row.content).slice(0,1200)}));
 }
 exportMemory(){return {version:1,profileId:this.profileId,facts:this.memoryFacts(),turns:this.db.prepare('SELECT id,role,content,created,interruption,conversation_id AS conversationId FROM turns WHERE profile_id=? ORDER BY id').all(this.profileId)};}
 exportProfileBackup(includeMemory=true,includeLibrary=true):ProfileBackup{
  const backup:ProfileBackup={format:'bambi-backup',version:1,created:new Date().toISOString(),settings:exportPreferences(this.get('profile',{}) as Record<string,unknown>)};
  // Reject oversized histories before materializing their contents in JavaScript.
  let bytes=new TextEncoder().encode(JSON.stringify(backup)).length;
  const capacity=(row:Record<string,unknown>,countLimit:number)=>{bytes+=Number(row.bytes??0);if(Number(row.count)>countLimit||bytes>MAX_BACKUP_BYTES)throw Error('This profile exceeds the supported size. Export a smaller selection.');};
  if(includeMemory){
   capacity(this.db.prepare('SELECT count(*) AS count,coalesce(sum(length(CAST(content AS BLOB))),0) AS bytes FROM turns WHERE profile_id=?').get(this.profileId)!,50000);
   capacity(this.db.prepare('SELECT count(*) AS count,coalesce(sum(length(CAST(key AS BLOB))+length(CAST(value AS BLOB))),0) AS bytes FROM memory_facts WHERE profile_id=?').get(this.profileId)!,20000);
   capacity(this.db.prepare('SELECT count(*) AS count FROM forgotten_memory_sources WHERE profile_id=?').get(this.profileId)!,50000);
  }
  if(includeLibrary)capacity(this.db.prepare('SELECT count(*) AS count,coalesce(sum(length(CAST(data AS BLOB))),0) AS bytes FROM media').get()!,10000);
  if(includeMemory)backup.memory={
   turns:this.db.prepare('SELECT id,role,content,created,interruption,conversation_id AS conversationId FROM turns WHERE profile_id=? ORDER BY id').all(this.profileId) as NonNullable<ProfileBackup['memory']>['turns'],
   facts:this.db.prepare('SELECT id,key,value,source_turn_id AS sourceTurnId,created,supersedes,current FROM memory_facts WHERE profile_id=? ORDER BY id').all(this.profileId) as NonNullable<ProfileBackup['memory']>['facts'],
   forgotten:(this.db.prepare('SELECT turn_id AS id FROM forgotten_memory_sources WHERE profile_id=? ORDER BY turn_id').all(this.profileId) as {id:number}[]).map(row=>row.id),
   conversation:{id:String(this.get('conversationId','legacy')),start:Number(this.get('conversationStart',0)),summary:String(this.get('conversationSummary','')),cursor:Number(this.get('conversationSummaryCursor',0))},
  };
  if(includeLibrary)backup.library=this.db.prepare('SELECT data FROM media ORDER BY id').all().map(row=>JSON.parse(String(row.data)));
  checkedSize(backup,MAX_BACKUP_BYTES);return BackupSchema.parse(backup);
 }
 /** Called inside the restore transaction as well as before preference upgrades. */
 checkpointProfile(label:string,includeMemory=true,includeLibrary=true){
  const id=randomUUID(),backup=this.exportProfileBackup(includeMemory,includeLibrary);
  this.db.prepare('INSERT INTO profile_recovery VALUES(?,?,?,?,?)').run(id,this.profileId,backup.created,label,JSON.stringify(backup));
  this.db.prepare('DELETE FROM profile_recovery WHERE profile_id=? AND id NOT IN (SELECT id FROM profile_recovery WHERE profile_id=? ORDER BY rowid DESC LIMIT 5)').run(this.profileId,this.profileId);
  return id;
 }
 recoveryPoints(){return this.db.prepare('SELECT id,created,label FROM profile_recovery WHERE profile_id=? ORDER BY rowid DESC LIMIT 5').all(this.profileId);}
 recoveryPoint(id:string):ProfileBackup|null{
  const row=this.db.prepare('SELECT data FROM profile_recovery WHERE profile_id=? AND id=?').get(this.profileId,id);
  return row?BackupSchema.parse(JSON.parse(String(row.data))):null;
 }
 importProfile(raw:ProfileImport){
  const request=ImportSchema.parse(raw);checkedSize(request.document,request.document.format==='bambi-backup'?MAX_BACKUP_BYTES:MAX_PROFILE_BYTES);
  const selected=Object.fromEntries(Object.entries(request.document.settings).filter(([key])=>request.groups.includes(preferenceGroup(key) as ProfileImport['groups'][number])));
  const memory=request.document.format==='bambi-backup'&&request.memory?request.document.memory:undefined;
  const library=request.document.format==='bambi-backup'&&request.library?request.document.library:undefined;
  const previous=this.get('profile',{}) as Record<string,unknown>;
  const base=request.mode==='replace'?Object.fromEntries(Object.entries(previous).filter(([key])=>!request.groups.includes(preferenceGroup(key) as ProfileImport['groups'][number]))):previous;
  const settings=mergePreferences(base,selected);
  // Reconnection and arming always require a fresh user action, including restore.
  settings['device-auto-connect']=false;
  this.db.exec('BEGIN IMMEDIATE');let recoveryId:string;
  try{
   recoveryId=this.checkpointProfile('Before profile import',!!memory,!!library);this.set('profile',settings);this.set('settings-revision',this.settingsSnapshot().revision+1);this.set('settings-undo',null);
   if(memory){
    this.db.prepare('DELETE FROM memory_facts WHERE profile_id=?').run(this.profileId);
    this.db.prepare('DELETE FROM turns WHERE profile_id=?').run(this.profileId);
    this.db.prepare('DELETE FROM memory_vectors WHERE profile_id=?').run(this.profileId);
    this.db.prepare('DELETE FROM forgotten_memory_sources WHERE profile_id=?').run(this.profileId);
    const turns=new Map<number,number>(),facts=new Map<number,number>();
    const insertTurn=this.db.prepare('INSERT INTO turns(role,content,created,interruption,profile_id,conversation_id) VALUES(?,?,?,?,?,?)');
    // IDs belong to this database, never to the source profile. Preserve order.
    for(const turn of [...memory.turns].sort((a,b)=>a.id-b.id))turns.set(turn.id,Number(insertTurn.run(turn.role,turn.content,turn.created,turn.interruption,this.profileId,turn.conversationId).lastInsertRowid));
    const insertFact=this.db.prepare('INSERT INTO memory_facts(profile_id,key,value,source_turn_id,created,supersedes,current) VALUES(?,?,?,?,?,?,?)');
    for(const fact of [...memory.facts].sort((a,b)=>a.id-b.id))facts.set(fact.id,Number(insertFact.run(this.profileId,fact.key,fact.value,fact.sourceTurnId===null?null:turns.get(fact.sourceTurnId)!,fact.created,fact.supersedes===null?null:facts.get(fact.supersedes)!,fact.current).lastInsertRowid));
    const forget=this.db.prepare('INSERT INTO forgotten_memory_sources VALUES(?,?)');for(const old of memory.forgotten)forget.run(this.profileId,turns.get(old)!);
    const boundary=(old:number)=>{let result=0;for(const [source,target] of turns)if(source<=old)result=Math.max(result,target);return result;};
    this.set('conversationId',memory.conversation.id);this.set('conversationStart',boundary(memory.conversation.start));this.set('conversationSummary',memory.conversation.summary);this.set('conversationSummaryCursor',boundary(memory.conversation.cursor));this.set('summary','');this.set('replyIntent','conversation');
   }
   if(library){this.db.exec('DELETE FROM media');const insert=this.db.prepare('INSERT INTO media VALUES(?,?)');for(const item of library)insert.run(item.id,JSON.stringify(item));}
   this.set('profileImportRevision',Number(this.get('profileImportRevision',0))+1);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  if(memory)this.changed('clear');
  return {settings,recoveryId};
 }
 metric(event:string,data:unknown){this.db.prepare('INSERT INTO metrics(event,data) VALUES(?,?)').run(event,JSON.stringify(data));}
 saveSession(id:string,data:unknown){this.db.prepare('INSERT OR REPLACE INTO sessions(id,data) VALUES(?,?)').run(id,JSON.stringify(data));}
 sessions(){return this.db.prepare('SELECT * FROM sessions ORDER BY created DESC LIMIT 40').all();}
 clearMemory(){this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('DELETE FROM profile_recovery WHERE profile_id=?').run(this.profileId);this.db.prepare('DELETE FROM memory_facts WHERE profile_id=?').run(this.profileId);this.db.prepare('DELETE FROM turns WHERE profile_id=?').run(this.profileId);this.db.prepare('DELETE FROM memory_vectors WHERE profile_id=?').run(this.profileId);this.db.prepare('DELETE FROM forgotten_memory_sources WHERE profile_id=?').run(this.profileId);this.set('summary','');this.set('conversationStart',0);this.set('conversationId',crypto.randomUUID());this.set('conversationSummary','');this.set('conversationSummaryCursor',0);this.set('replyIntent','conversation');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}this.changed('clear');}
}
