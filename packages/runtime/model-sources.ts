// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import {lstat,realpath,readdir,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {basename,dirname,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {localModelCatalog} from '../ai/model-catalog';

type Source={id:string;path:string;kind:'file'|'folder'};
/** Paths originate in the native chooser, never in renderer-provided import requests. */
export class ModelSources {
 private entries:Source[]=[];
 constructor(private directory:string){
  try{const saved=JSON.parse(readFileSync(resolve(directory,'model-sources.json'),'utf8'));if(Array.isArray(saved))this.entries=saved.filter(value=>typeof value?.path==='string'&&value.path===resolve(value.path)&&/^[a-f0-9-]{36}$/.test(value.id)&&['file','folder'].includes(value.kind)).slice(0,20);}catch{}
 }
 private async save(){
  await mkdir(this.directory,{recursive:true,mode:0o700});const file=resolve(await realpath(this.directory),'model-sources.json'),temporary=file+'.'+randomUUID()+'.partial';
  try{await writeFile(temporary,JSON.stringify(this.entries)+'\n',{flag:'wx',mode:0o600});await rename(temporary,file);}finally{await rm(temporary,{force:true});}
 }
 async add(path:string,kind:'file'|'folder'){
  const actual=await realpath(path),info=await lstat(actual);
  if(kind==='file'&&(!info.isFile()||!actual.toLowerCase().endsWith('.gguf'))||kind==='folder'&&!info.isDirectory())throw Error('Choose a GGUF file or a model folder.');
  let entry=this.entries.find(value=>value.path===actual&&value.kind===kind);
  if(!entry){if(this.entries.length>=20)throw Error('Remove a saved location before adding another (maximum 20).');entry={id:randomUUID(),path:actual,kind};this.entries.push(entry);try{await this.save();}catch(error){this.entries.pop();throw error;}}
  return entry.id;
 }
 async remove(id:string){const previous=this.entries;this.entries=this.entries.filter(value=>value.id!==id);try{await this.save();}catch(error){this.entries=previous;throw error;}}
 private async scan(source:Source){
  const matches:{model:string;file:string}[]=[],root=await realpath(source.path),pending=[{path:root,depth:0}];let examined=0,limited=false;
  const inspect=async(file:string)=>{const info=await lstat(file);if(!info.isFile()||!file.toLowerCase().endsWith('.gguf'))return;for(const model of localModelCatalog.filter(value=>value.desktopSupported&&value.license==='apache-2.0'))if(info.size===model.bytes)matches.push({model:model.alias,file});};
  if(source.kind==='file')await inspect(root);
  else while(pending.length&&examined<5000){
   const next=pending.shift()!;for(const item of await readdir(next.path,{withFileTypes:true})){if(++examined>5000){limited=true;break;}if(item.isSymbolicLink())continue;const file=resolve(next.path,item.name);if(item.isFile())await inspect(file);else if(item.isDirectory()&&!['.git','node_modules','.venv','venv'].includes(item.name)){if(next.depth<3)pending.push({path:file,depth:next.depth+1});else limited=true;}}
  }
  return {root,matches,limited:source.kind==='folder'&&(limited||pending.length>0)};
 }
 async list(){
  return Promise.all(this.entries.map(async source=>{try{const scan=await this.scan(source);return {...source,label:basename(source.path),models:[...new Set(scan.matches.map(value=>value.model))],limited:scan.limited};}catch{return {...source,label:basename(source.path),models:[] as string[],limited:false,error:'This location is unavailable. Reconnect the drive or choose another location.'};}}));
 }
 async find(id:string,model:string){
  const entry=this.entries.find(value=>value.id===id);if(!entry)throw Error('Choose a saved model location.');
  const scan=await this.scan(entry),match=scan.matches.find(value=>value.model===model);
  if(!match)throw Error('No matching catalog file was found. Choose the exact GGUF or a more specific folder. Different models and quantizations need their own runtime profile.');
  const file=await realpath(match.file),root=entry.kind==='file'?dirname(scan.root):scan.root;
  if(file!==scan.root&&!file.startsWith(root+sep))throw Error('The selected file is outside its chosen folder.');
  return {root,modelFile:file};
 }
}
