// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import {cleanDialogueText,visibleDialogueText} from '../ai/dialogue';
type Turn={role:'user'|'assistant';content:string;interruption?:string|null};
export type MemoryFact={id:number;key:string;value:string;sourceTurnId:number|null;created:string;supersedes:number|null};
export type MemoryEpisode={id:number;role:string;content:string;created:string;interruption:string|null};
mkdirSync('data',{recursive:true});
export class Store {
 db:DatabaseSync;
 constructor(path='data/bambi.sqlite',readonly profileId='default'){
  this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS turns(id INTEGER PRIMARY KEY,role TEXT,content TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,data TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS metrics(id INTEGER PRIMARY KEY,event TEXT,data TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,data TEXT);`);
  const columns=(this.db.prepare('PRAGMA table_info(turns)').all() as {name:string}[]).map(column=>column.name);
  if(!columns.includes('interruption'))this.db.exec('ALTER TABLE turns ADD COLUMN interruption TEXT');
  if(!columns.includes('profile_id'))this.db.exec("ALTER TABLE turns ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default'");
  if(!columns.includes('conversation_id'))this.db.exec("ALTER TABLE turns ADD COLUMN conversation_id TEXT NOT NULL DEFAULT 'legacy'");
  this.db.exec(`CREATE INDEX IF NOT EXISTS turns_scope ON turns(profile_id,conversation_id,id);
   CREATE TABLE IF NOT EXISTS memory_facts(id INTEGER PRIMARY KEY,profile_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source_turn_id INTEGER,created TEXT DEFAULT CURRENT_TIMESTAMP,supersedes INTEGER,current INTEGER NOT NULL DEFAULT 1);
   CREATE UNIQUE INDEX IF NOT EXISTS current_memory_fact ON memory_facts(profile_id,key) WHERE current=1;
   CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(content,content='turns',content_rowid='id');
   CREATE TRIGGER IF NOT EXISTS turns_fts_insert AFTER INSERT ON turns BEGIN INSERT INTO turns_fts(rowid,content) VALUES(new.id,new.content); END;
   CREATE TRIGGER IF NOT EXISTS turns_fts_delete AFTER DELETE ON turns BEGIN INSERT INTO turns_fts(turns_fts,rowid,content) VALUES('delete',old.id,old.content); END;`);
  if(!this.get('memoryIndexVersion',0)){this.db.exec("INSERT INTO turns_fts(turns_fts) VALUES('rebuild')");this.set('memoryIndexVersion',1);}
 }
 private preferenceKey(key:string){return this.profileId==='default'?key:`${this.profileId}:${key}`;}
 get(key:string,fallback:unknown=null){const r=this.db.prepare('SELECT value FROM preferences WHERE key=?').get(this.preferenceKey(key)) as {value:string}|undefined;return r?JSON.parse(r.value):fallback;}
 set(key:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO preferences VALUES(?,?)').run(this.preferenceKey(key),JSON.stringify(value));}
 addTurn(role:string,content:string,interruption:string|null=null){return Number(this.db.prepare('INSERT INTO turns(role,content,interruption,profile_id,conversation_id) VALUES(?,?,?,?,?)').run(role,content,interruption,this.profileId,String(this.get('conversationId','legacy'))).lastInsertRowid);}
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
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE memory_facts SET current=0 WHERE profile_id=? AND key=?').run(this.profileId,key);const result=this.db.prepare('INSERT INTO memory_facts(profile_id,key,value,source_turn_id,supersedes) VALUES(?,?,?,?,?)').run(this.profileId,key,value,sourceTurnId,previous?.id??null);this.db.exec('COMMIT');return Number(result.lastInsertRowid);}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 forgetFact(id:number){const row=this.db.prepare('SELECT key FROM memory_facts WHERE id=? AND profile_id=?').get(id,this.profileId) as {key:string}|undefined;if(row)this.db.prepare('DELETE FROM memory_facts WHERE profile_id=? AND key=?').run(this.profileId,row.key);return !!row;}
 searchEpisodes(query:string,limit=6):MemoryEpisode[]{
  const stop=new Set('the and that this with from have what when where why how please remember about your you are was were can could would should tell me my for'.split(' '));
  const words=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[])].filter(word=>!stop.has(word)).slice(0,16);
  if(!words.length)return [];
  const match=words.map(word=>'"'+word+'"').join(' OR ');
  const boundary=this.db.prepare('SELECT id FROM turns WHERE profile_id=? ORDER BY id DESC LIMIT 1 OFFSET 31').get(this.profileId) as {id:number}|undefined;
  const cutoff=Math.max(Number(this.get('conversationStart',0)),boundary?.id??0);
  const rows=this.db.prepare(`SELECT t.id,t.role,t.content,t.created,t.interruption FROM turns_fts JOIN turns t ON t.id=turns_fts.rowid
   WHERE turns_fts MATCH ? AND t.profile_id=? AND t.id<=? ORDER BY bm25(turns_fts),t.id DESC LIMIT ?`).all(match,this.profileId,cutoff,Math.max(1,Math.min(12,limit))) as MemoryEpisode[];
  return rows.map(row=>({...row,content:visibleDialogueText(row.content).slice(0,1200)}));
 }
 exportMemory(){return {version:1,profileId:this.profileId,facts:this.memoryFacts(),turns:this.db.prepare('SELECT id,role,content,created,interruption,conversation_id AS conversationId FROM turns WHERE profile_id=? ORDER BY id').all(this.profileId)};}
 metric(event:string,data:unknown){this.db.prepare('INSERT INTO metrics(event,data) VALUES(?,?)').run(event,JSON.stringify(data));}
 saveSession(id:string,data:unknown){this.db.prepare('INSERT OR REPLACE INTO sessions(id,data) VALUES(?,?)').run(id,JSON.stringify(data));}
 sessions(){return this.db.prepare('SELECT * FROM sessions ORDER BY created DESC LIMIT 40').all();}
 clearMemory(){this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('DELETE FROM memory_facts WHERE profile_id=?').run(this.profileId);this.db.prepare('DELETE FROM turns WHERE profile_id=?').run(this.profileId);this.set('summary','');this.set('conversationStart',0);this.set('conversationId',crypto.randomUUID());this.set('conversationSummary','');this.set('conversationSummaryCursor',0);this.set('replyIntent','conversation');this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
