// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';
import {PreferencesSchema} from './preferences';
import {BambiCloudTrackSchema,bambiCloudTrackId} from '../media/bambicloud';

export const MAX_PROFILE_BYTES=96*1024;
export const MAX_BACKUP_BYTES=16*1024*1024;
const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text=z.string().max(1000000);
const turn=z.object({id,role:z.enum(['user','assistant']),content:text,created:z.string().max(100),interruption:z.string().max(1000).nullable(),conversationId:z.string().min(1).max(100)}).strict();
const fact=z.object({id,key:z.string().trim().min(1).max(80),value:z.string().trim().min(1).max(1000),sourceTurnId:id.nullable(),created:z.string().max(100),supersedes:id.nullable(),current:z.union([z.literal(0),z.literal(1)])}).strict();
export const MemoryBackupSchema=z.object({
 turns:z.array(turn).max(50000),facts:z.array(fact).max(20000),forgotten:z.array(id).max(50000),
 conversation:z.object({id:z.string().min(1).max(100),start:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),summary:z.string().max(10000),cursor:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict(),
}).strict().superRefine((memory,ctx)=>{
 const turns=new Map(memory.turns.map(t=>[t.id,t])),facts=new Map(memory.facts.map(f=>[f.id,f])),current=new Set<string>();
 const invalid=(message:string)=>ctx.addIssue({code:'custom',message});
 if(turns.size!==memory.turns.length||facts.size!==memory.facts.length||new Set(memory.forgotten).size!==memory.forgotten.length)invalid('Duplicate memory identifiers');
 for(const f of memory.facts){
  if(f.sourceTurnId!==null&&turns.get(f.sourceTurnId)?.role!=='user')invalid('Memory source must be a user message');
  if(f.supersedes!==null&&(f.supersedes>=f.id||facts.get(f.supersedes)?.key!==f.key))invalid('Invalid memory revision');
  if(f.current){if(current.has(f.key))invalid('Duplicate current preference');current.add(f.key);}
 }
 for(const source of memory.forgotten)if(!turns.has(source))invalid('Missing forgotten source');
});
export type MemoryBackup=z.infer<typeof MemoryBackupSchema>;
export const LibrarySchema=z.array(z.object({id:z.string().min(1).max(1000),favorite:z.boolean(),notes:z.string().max(10000),tags:z.string().max(1000),plays:z.number().int().nonnegative().optional(),lastPlayed:z.string().max(100).optional(),remote:BambiCloudTrackSchema.optional()}).strict().refine(item=>!item.remote||item.id===bambiCloudTrackId(item.remote))).max(10000).refine(items=>new Set(items.map(i=>i.id)).size===items.length,'Duplicate library entries');
export const ProfileDocumentSchema=z.object({format:z.literal('bambi-profile'),version:z.literal(1),kind:z.enum(['preset','personal']),name:z.string().trim().min(1).max(120),created:z.string().datetime(),settings:PreferencesSchema}).strict();
export type ProfileDocument=z.infer<typeof ProfileDocumentSchema>;
export const BackupSchema=z.object({format:z.literal('bambi-backup'),version:z.literal(1),created:z.string().datetime(),settings:PreferencesSchema,memory:MemoryBackupSchema.optional(),library:LibrarySchema.optional()}).strict();
export type ProfileBackup=z.infer<typeof BackupSchema>;
export const ImportSchema=z.object({document:z.union([ProfileDocumentSchema,BackupSchema]),groups:z.array(z.enum(['Personal text','Visuals','Triggers','Voice & sound','Session & conversation'])).max(5).refine(groups=>new Set(groups).size===groups.length,'Duplicate setting groups'),mode:z.enum(['merge','replace']).default('merge'),memory:z.boolean().default(false),library:z.boolean().default(false)}).strict().refine(v=>!v.memory||v.document.format==='bambi-backup'&&v.document.memory!==undefined,'This file contains no memories').refine(v=>!v.library||v.document.format==='bambi-backup'&&v.document.library!==undefined,'This file contains no library');
export type ProfileImport=z.infer<typeof ImportSchema>;
export function checkedSize(value:unknown,limit:number){if(new TextEncoder().encode(JSON.stringify(value)).length>limit)throw Error('This profile exceeds the supported size. Export a smaller selection.');}
