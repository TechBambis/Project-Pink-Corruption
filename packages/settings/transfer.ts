// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import {z} from 'zod';
import {settingsRegistry,validateSettings,migrateStoredSettings,type Settings,type SettingsSection,sectionLabels,settingLabel} from './index';
export const settingsFileLimit=96*1024;
const sectionNames=Object.keys(sectionLabels) as [SettingsSection,...SettingsSection[]];
const sectionsSchema=z.object(Object.fromEntries(sectionNames.map(section=>[section,z.object(Object.fromEntries(Object.entries(settingsRegistry).filter(([,field])=>field.section===section&&field.transfer).map(([id,field])=>[id,field.schema.optional()]))).strict().optional()]))).strict();
export const SettingsFileSchema=z.object({
 format:z.literal('bambi-settings'),version:z.literal(1),kind:z.enum(['settings','preset']),
 name:z.string().trim().min(1).max(80),description:z.string().max(500).default(''),appVersion:z.string().max(80).optional(),
 sections:sectionsSchema,
 requirements:z.object({model:z.string().max(160).optional(),voices:z.array(z.string().max(80)).max(2).optional(),audioPreset:z.string().max(80).optional()}).strict().default({}),
}).strict().superRefine((file,ctx)=>{
 if(file.kind==='preset'&&file.sections.machine!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,path:['sections','machine'],message:'Presets cannot contain machine settings'});
});
export type SettingsFile=z.infer<typeof SettingsFileSchema>;
export function parseSettingsFile(input:string|unknown):SettingsFile {
 let value:unknown=input;
 if(typeof input==='string'){if(new TextEncoder().encode(input).length>settingsFileLimit)throw Error('Settings file exceeds 96 KiB');value=JSON.parse(input);}
 else if(new TextEncoder().encode(JSON.stringify(input)).length>settingsFileLimit)throw Error('Settings file exceeds 96 KiB');
 // Version 0 was a flat preference envelope. Only this documented older shape is migrated.
 if(value&&typeof value==='object'&&'version' in value&&value.version===0){
  const old=z.object({format:z.literal('bambi-settings'),version:z.literal(0),kind:z.enum(['settings','preset']),name:z.string().min(1).max(80),preferences:z.record(z.union([z.string().max(16000),z.number().finite(),z.boolean()]))}).strict().parse(value);
  const unknown=Object.keys(old.preferences).filter(key=>!settingsRegistry[key]&&!['duration-version','dialogue-version','visuals-version','sampling-version'].includes(key));
  if(unknown.length)throw Error('Unknown legacy settings: '+unknown.join(', '));
  const migrated=migrateStoredSettings(old.preferences);
  // Legacy range migrations are bounded; all remaining invalid fields reject the file.
  for(const id of Object.keys(old.preferences).filter(id=>settingsRegistry[id]))if(!(id in migrated))throw Error('Invalid legacy setting: '+id);
  value=createSettingsFile(migrated,old.kind,old.name,sectionNames.filter(section=>old.kind==='settings'||section!=='machine'));
 }
const parsed=SettingsFileSchema.safeParse(value);
 if(!parsed.success){
  const version=value&&typeof value==='object'&&'version' in value?value.version:undefined;
  if(version!==1)throw Error('Unsupported settings file version: '+String(version));
  const issue=parsed.error.issues[0],id=String(issue.path.at(-1)??'file');
  throw Error(issue.code==='unrecognized_keys'?'This file contains unknown settings or fields':(settingsRegistry[id]?settingLabel(id)+': invalid value':'Invalid settings file: '+issue.message));
 }
 return parsed.data;
}
export function createSettingsFile(settings:Settings,kind:SettingsFile['kind'],name:string,sections:SettingsSection[],description=''):SettingsFile {
 const validated=validateSettings(settings),selected:Record<string,Settings>={};
 for(const section of sections){
  if(kind==='preset'&&section==='machine')continue;
  selected[section]=Object.fromEntries(Object.entries(validated).filter(([id])=>settingsRegistry[id].section===section&&settingsRegistry[id].transfer));
 }
 const all=Object.assign({},...Object.values(selected)) as Settings;
 return SettingsFileSchema.parse({format:'bambi-settings',version:1,kind,name,description,sections:selected,
  requirements:{...(all.model?{model:all.model}:{}),...([all.voice,all.voice2].filter(Boolean).length?{voices:[all.voice,all.voice2].filter(Boolean)}:{}),...(all['audio-preset']?{audioPreset:all['audio-preset']}: {})}});
}
export function selectedFileSettings(file:SettingsFile,sections:SettingsSection[]):Settings {
 return validateSettings(Object.assign({},...sections.map(section=>file.sections[section]??{})));
}
export const ImportSettingsSchema=z.object({revision:z.number().int().nonnegative(),requestId:z.string().uuid(),file:SettingsFileSchema,sections:z.array(z.enum(sectionNames)).min(1).max(sectionNames.length)}).strict();
