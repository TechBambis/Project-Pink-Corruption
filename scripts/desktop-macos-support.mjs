// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,readdirSync,realpathSync,existsSync,statSync,lstatSync,mkdirSync,copyFileSync,chmodSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

export function assertMachArm64(path){
 const bytes=readFileSync(path);
 if(bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x0100000c)
  throw Error('Expected native Mach-O arm64: '+path);
}
export function machOInfo(bytes){
 if(bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x0100000c)throw Error('Expected thin Mach-O arm64');
 const dependencies=[],rpaths=[];let offset=32;
 const commands=bytes.readUInt32LE(16),end=32+bytes.readUInt32LE(20);
 if(end>bytes.length)throw Error('Truncated Mach-O command table');
 for(let index=0;index<commands;index++){
  if(offset+8>end)throw Error('Truncated Mach-O command');
  const command=bytes.readUInt32LE(offset),length=bytes.readUInt32LE(offset+4);
  if(length<8||offset+length>end)throw Error('Invalid Mach-O command size');
  if([0xc,0x80000018,0x8000001f,0x20,0x80000023,0x8000001c].includes(command)){
   if(length<12)throw Error('Invalid Mach-O path command');
   const start=offset+bytes.readUInt32LE(offset+8),finish=bytes.indexOf(0,start);
   if(start<offset+12||start>=offset+length||finish<start||finish>=offset+length)throw Error('Invalid Mach-O path string');
   (command===0x8000001c?rpaths:dependencies).push(bytes.toString('utf8',start,finish));
  }
  offset+=length;
 }
 if(offset!==end)throw Error('Mach-O command table size mismatch');
 return {dependencies,rpaths};
}
export function macNativeReport(root){
 root=realpathSync(root);const entries=[];
 const walk=folder=>{for(const entry of readdirSync(folder,{withFileTypes:true})){
  const path=join(folder,entry.name);
  if(entry.isSymbolicLink()){if(!realpathSync(path).startsWith(root+'/'))throw Error('Native link escapes packaged runtime: '+path);continue;}
  if(entry.isDirectory()){walk(path);continue;}if(!entry.isFile())throw Error('Unexpected native filesystem entry: '+path);
  const bytes=readFileSync(path);
  if(bytes.length>=4&&bytes.readUInt32LE(0)===0xfeedfacf)entries.push({path,...machOInfo(bytes)});
  else if(/\.(so|dylib|exe|dll)$/.test(path)||bytes.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46])))throw Error('Foreign or non-native runtime binary: '+path);
 }};walk(root);
 const unresolved=[];
 const expand=(value,path)=>value==='@loader_path'?dirname(path):value.startsWith('@loader_path/')?resolve(dirname(path),value.slice(13)):value;
 for(const entry of entries)for(const dependency of entry.dependencies){
  if(dependency.startsWith('/System/Library/')||dependency.startsWith('/usr/lib/'))continue;
  const candidates=dependency.startsWith('@rpath/')?entry.rpaths.map(rpath=>join(expand(rpath,entry.path),dependency.slice(7))):[expand(dependency,entry.path)];
  if(!candidates.some(path=>existsSync(path)&&realpathSync(path).startsWith(root+'/')))unresolved.push({path:entry.path,dependency});
 }
 return {root,entries,unresolved};
}
export function copyResolvedNativeTree(source,destination){
 source=realpathSync(source);destination=resolve(destination);
 const aliases=[];
 if(destination===source||destination.startsWith(source+'/'))throw Error('Native destination overlaps source');
 const walk=(from,to,parents)=>{
  const actual=realpathSync(from);
  if(actual!==source&&!actual.startsWith(source+'/'))throw Error('Native copy link escapes source: '+from);
  const entry=statSync(actual);
  if(entry.isFile()){copyFileSync(actual,to);chmodSync(to,entry.mode&0o777);if(lstatSync(from).isSymbolicLink())aliases.push({path:to,sourceTarget:actual.slice(source.length+1)});return;}
  if(!entry.isDirectory()||parents.has(actual))throw Error('Unexpected entry or cycle in native copy: '+from);
  mkdirSync(to,{recursive:true});const next=new Set([...parents,actual]);
  for(const name of readdirSync(actual))walk(join(actual,name),join(to,name),next);
 };walk(source,destination,new Set());return aliases;
}
export function processRows(){
 return execFileSync('/bin/ps',['-axo','pid=,ppid=,stat=,command='],{encoding:'utf8'}).split('\n').flatMap(line=>{
  const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  return match?[{pid:Number(match[1]),parent:Number(match[2]),state:match[3],command:match[4]}]:[];
 });
}
export function running(pid){return processRows().some(row=>row.pid===pid&&!row.state.startsWith('Z'));}
export function ownedProcessIds(rows,owner){
 const owned=new Set([owner]);let changed=true;
 while(changed){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true;}}
 return [...owned];
}
// ElectronApplication.process() loses its dispatcher after the app closes.
// Retain the owned ChildProcess at launch and use it for bounded teardown.
export async function closeTrackedApplication(application,child,timeoutMs=4000){
 let timer;
 try{
  await Promise.race([Promise.resolve().then(()=>application.close()).catch(()=>{}),new Promise(done=>{timer=setTimeout(done,timeoutMs);})]);
 }finally{
  clearTimeout(timer);
  if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 }
}
export function appPaths(executable){
 if(!['Bambi Local Smoke','Bambi Local'].some(name=>executable.endsWith(name+'.app/Contents/MacOS/'+name)))throw Error('Select the received macOS app executable.');
 const contents=executable.slice(0,executable.lastIndexOf('/MacOS/'));
 return {contents,resources:contents+'/Resources',bundle:contents.slice(0,-'/Contents'.length)};
}
