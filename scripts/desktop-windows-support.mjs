// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {desktopVersion} from './desktop-release-version.mjs';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,readdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {rename,rm} from 'node:fs/promises';
import {dirname,join,relative,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
export {llamaEntries} from './desktop-llama-selection.mjs';

// Git Bash may put GNU tar first, which treats C: paths as remote hosts and
// cannot extract the ZIP runtimes. Select Windows' native libarchive tool.
export const archiveTool=process.platform==='win32'?join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'):'tar';
export const logicalPath=path=>path.replaceAll('\\','/');
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function hashFile(path){
 const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');
}
export function buildOptions(args,environment={}){
 const [phase='smoke',requested,...extra]=args;
 if(!['smoke','alpha'].includes(phase)||extra.length)throw Error('Use desktop-windows-build.mjs smoke|alpha [0.1.0-smoke.N|0.1.0-alpha.N]');
 const version=requested||environment.BAMBI_WINDOWS_VERSION||`0.1.0-${phase}.2`;
 if(!desktopVersion(version,phase))throw Error('Version must match the selected phase: 0.1.0-'+phase+'.N');
 return {phase,version,alpha:phase==='alpha'};
}
export async function downloadPinned(asset,path){
 if(existsSync(path)){
  if(!lstatSync(path).isFile()||lstatSync(path).size!==asset.bytes||await hashFile(path)!==asset.sha256)throw Error('Pinned download checksum mismatch: '+path);
  return;
 }
 mkdirSync(dirname(path),{recursive:true});
 const partial=path+'.partial-'+randomUUID();let length=0;const hash=createHash('sha256');
 try{
  const response=await fetch(asset.url,{signal:AbortSignal.timeout(30*60*1000)});
  if(!response.ok||!response.body)throw Error('Download failed: '+asset.url);
  const check=new Transform({transform(bytes,encoding,callback){
   length+=bytes.length;
   if(length>asset.bytes){callback(Error('Download exceeded reviewed size: '+asset.url));return;}
   hash.update(bytes);callback(null,bytes);
  }});
  await pipeline(Readable.fromWeb(response.body),check,createWriteStream(partial,{flags:'wx'}));
  if(length!==asset.bytes||hash.digest('hex')!==asset.sha256)throw Error('Pinned download checksum mismatch: '+path);
  await rename(partial,path);
 }catch(error){await rm(partial,{force:true});throw error;}
}
export function files(path){
 return readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>{
  const full=join(path,entry.name);if(entry.isSymbolicLink())throw Error('Symlink in reviewed input: '+full);
  return entry.isDirectory()?files(full):entry.isFile()?[full]:[];
 });
}
export function copy(from,to){
 if(!lstatSync(from).isFile())throw Error('Expected regular reviewed file: '+from);
 mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);
}
export function copyTree(from,to,accept=()=>true){
 for(const file of files(from)){const path=logicalPath(relative(from,file));if(accept(path))copy(file,join(to,path));}
}
/** Keep every license byte while avoiding deeply nested NSIS/MAX_PATH entries. */
export async function copyCompactLicenses(origin,destination){
 const inputs=files(origin),entries=[],names=new Set();mkdirSync(destination,{recursive:true});
 for(const file of inputs){
  const originalPath=logicalPath(relative(origin,file));
  const name=digest(Buffer.from(originalPath)).slice(0,16)+'-'+basename(file).slice(0,40);
  const target=join(destination,name);
  if(names.has(name)||existsSync(target))throw Error('Colliding compact license path: '+originalPath);
  names.add(name);const sha256=await hashFile(file);copy(file,target);
  if(await hashFile(target)!==sha256)throw Error('Copied license differs: '+originalPath);
  entries.push({originalPath,file:name,bytes:lstatSync(file).size,sha256});
 }
 writeFileSync(join(destination,'INDEX.json'),JSON.stringify({schema:1,sourceRoot:'docs/licenses',files:entries},null,2)+'\n');
 return entries;
}
export async function inventory(root){
 const result=[];
 for(const path of files(root))result.push({path:logicalPath(relative(root,path)),bytes:lstatSync(path).size,sha256:await hashFile(path)});
 return result;
}
/** Only application owners used by the local runtime enter distributed source. */
export function localSourceArea(path){
 path=logicalPath(path);
 if(path.startsWith('apps/'))return /^apps\/(?:desktop|server|web|extension)\//.test(path);
 if(path.startsWith('packages/runtime/'))return !path.slice('packages/runtime/'.length).includes('/');
 return true;
}
export function sourcePathAllowed(path){
 path=logicalPath(path);
 return localSourceArea(path)&&!/(?:^|\/)(?:\.git|\.runtime|node_modules|internal|reports|models|recordings|imported-sounds|__pycache__)(?:\/|$)/.test(path)
  &&!path.startsWith('apps/web/public/vad/')
  &&/\.(?:ts|tsx|mts|mjs|cjs|json|py|lock|md|html|css|js|svg|wav|spec|cs|txt|cmd|ps1|yml|manifest|plist)$/.test(path);
}
export function assertWindowsX64(path){
 const bytes=readFileSync(path);
 if(bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')throw Error('Expected native Windows PE x64: '+path);
 const offset=bytes.readUInt32LE(0x3c);
 if(offset>bytes.length-26||bytes.toString('ascii',offset,offset+4)!=='PE\0\0'||bytes.readUInt16LE(offset+4)!==0x8664||bytes.readUInt16LE(offset+24)!==0x20b)throw Error('Expected native Windows PE x64: '+path);
}
export function assertNativeTree(root){
 for(const path of files(root)){
  if(/\.(?:so(?:\.[0-9.]+)?|dylib)$/.test(path))throw Error('Foreign native library in Windows package: '+path);
  if(/\.(?:exe|dll|pyd)$/i.test(path))assertWindowsX64(path);
 }
}
export function peImports(path){
 assertWindowsX64(path);const bytes=readFileSync(path),pe=bytes.readUInt32LE(0x3c),optional=pe+24;
 const sections=pe+24+bytes.readUInt16LE(pe+20),count=bytes.readUInt16LE(pe+6);
 if(sections+count*40>bytes.length||optional+112>bytes.length)throw Error('Truncated PE import table: '+path);
 function offset(rva){
  if(rva<bytes.readUInt32LE(optional+60))return rva;
  for(let i=0;i<count;i++){
   const section=sections+i*40,virtual=bytes.readUInt32LE(section+12),size=Math.max(bytes.readUInt32LE(section+8),bytes.readUInt32LE(section+16));
   if(rva>=virtual&&rva<virtual+size)return bytes.readUInt32LE(section+20)+rva-virtual;
  }
  throw Error('Unmapped PE import RVA: '+path);
 }
 function dll(rva){
  const start=offset(rva),end=bytes.indexOf(0,start);
  if(start>=bytes.length||end<start||end-start>260)throw Error('Invalid PE import name: '+path);
  const name=bytes.toString('ascii',start,end).toLowerCase();
  if(!/^[a-z0-9_+.-]+\.dll$/.test(name))throw Error('Invalid PE dependency name: '+path);
  return name;
 }
 const result=new Set(),directories=bytes.readUInt32LE(optional+108);
 for(const [directory,stride,nameAt] of [[1,20,12],[13,32,4]]){
  if(directory>=directories)continue;
  const entry=optional+112+directory*8;if(entry+8>sections)throw Error('Truncated PE data directory: '+path);
  const rva=bytes.readUInt32LE(entry);if(!rva)continue;let cursor=offset(rva);
  for(let limit=0;limit<4096;limit++,cursor+=stride){
   if(cursor+stride>bytes.length)throw Error('Truncated PE import descriptor: '+path);
   if(bytes.subarray(cursor,cursor+stride).every(value=>value===0))break;
   let name=bytes.readUInt32LE(cursor+nameAt);
   if(directory===13&&(bytes.readUInt32LE(cursor)&1)===0)name-=Number(bytes.readBigUInt64LE(optional+24));
   result.add(dll(name));if(limit===4095)throw Error('PE import descriptor limit exceeded: '+path);
  }
 }
 return [...result].sort();
}
export function windowsDependencyReport(root){
 const native=files(root).filter(path=>/\.(?:exe|dll|pyd)$/i.test(path)),bundled=new Set(native.map(path=>logicalPath(path).split('/').at(-1).toLowerCase()));
 const byFolder=new Map();
 for(const path of native){const folder=logicalPath(dirname(path)).toLowerCase();if(!byFolder.has(folder))byFolder.set(folder,new Set());byFolder.get(folder).add(logicalPath(path).split('/').at(-1).toLowerCase());}
 const system=new Set(('kernel32 kernelbase ntdll advapi32 bcrypt bcryptprimitives user32 userenv gdi32 gdi32full ucrtbase msvcrt mscoree winmm ole32 oleaut32 shell32 shlwapi ws2_32 wldap32 crypt32 cryptbase secur32 sspicli iphlpapi psapi version normaliz dbghelp imagehlp rpcrt4 setupapi powrprof cfgmgr32 ntmarta wintrust combase comctl32 mswsock netapi32 srvcli wkscli winhttp wininet win32u dwmapi uxtheme d3d11 dxgi dxcore d3d12 d3dcompiler_47 gdiplus msacm32 avrt imm32 nsi winspool propsys wtsapi32 shcore winrnr dnsapi dhcpcsvc dhcpcsvc6').split(' ').map(name=>name+'.dll'));
 const dependencies=native.map(path=>({path:logicalPath(relative(root,path)),imports:peImports(path)}));
 const unresolved=[],optionalDriver=[];
 for(const file of dependencies)for(const dll of file.imports){
  const folder=logicalPath(dirname(join(root,file.path))).toLowerCase(),plugin=/(?:^|\/)(?:cuda_v12|cuda_v13|vulkan)$/.test(folder);
  const available=plugin?(byFolder.get(folder)?.has(dll)||byFolder.get(logicalPath(dirname(folder)))?.has(dll)):/\/llama$/.test(folder)?byFolder.get(folder)?.has(dll):bundled.has(dll);
  if(available||system.has(dll)||/^(?:api-ms-win-|ext-ms-win-)/.test(dll))continue;
  const entry={path:file.path,dll};
  if(/(?:^|\/)vulkan\//.test(file.path)&&dll==='vulkan-1.dll'||/(?:^|\/)cuda_v(?:12|13)\//.test(file.path)&&dll==='nvcuda.dll')optionalDriver.push(entry);else unresolved.push(entry);
 }
 return {dependencies,unresolved,optionalDriver,method:'Static normal/delay PE imports; isolated llama root/selected backend lookup plus Windows 11 inbox/API-set DLLs. Other services use global bundle lookup. Dynamic imports and native loader/service acceptance remain required.'};
}
export async function stageWindowsSource(root,destination,version){
 const {stageDesktopSource}=await import('./desktop-source.mjs');
 return stageDesktopSource(root,destination,version);
}
