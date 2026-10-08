// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,mkdirSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {downloadPinned,hashFile,copy,copyTree,llamaEntries,assertNativeTree,assertWindowsX64} from './desktop-windows-support.mjs';

/** Both the small native slice and the final installer use this exact builder. */
export async function buildWindowsNative({root,backend,notices,cache,pins}){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Native Windows x64 is required.');
 const run=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',windowsHide:true,...options});
 const acquire=async asset=>{const path=join(cache,asset.file);await downloadPinned(asset,path);return path;};
 const buildEnv=resolve(root,'.runtime/alpha-windows-build');
 rmSync(buildEnv,{recursive:true,force:true});mkdirSync(buildEnv,{recursive:true});
 run('tar',['-xf',await acquire(pins.uv),'-C',buildEnv]);
 const uv=join(buildEnv,'uv.exe');assertWindowsX64(uv);
 const pythonVenv=join(buildEnv,'venv'),python=join(pythonVenv,'Scripts/python.exe');
 const environment={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',UV_PYTHON_INSTALL_DIR:join(buildEnv,'python'),UV_CACHE_DIR:join(buildEnv,'cache')};
 if(pins.pythonDistribution.version!==pins.python)throw Error('Native CPython archive/version mismatch.');
 const pythonTarget=join(buildEnv,'python-target');mkdirSync(pythonTarget);
 run('tar',['-xf',await acquire(pins.pythonDistribution),'-C',pythonTarget]);
 const nativePython=join(pythonTarget,'python/python.exe');assertWindowsX64(nativePython);
 run(uv,['venv',pythonVenv,'--python',nativePython,'--no-python-downloads','--no-project'],{env:environment});
 run(uv,['pip','install','--python',python,'--require-hashes','--only-binary',':all:','-r',resolve(root,'packages/speech/desktop-windows.lock')],{env:environment});
 run(uv,['pip','check','--python',python],{env:environment});
 const actualPython=execFileSync(python,['-c','import platform; print(platform.python_version())'],{encoding:'utf8',env:environment}).trim();
 if(actualPython!==pins.python)throw Error('Native Python differs from the pinned version.');
 const pythonBase=execFileSync(python,['-c','import sys; print(sys.base_prefix)'],{encoding:'utf8',env:environment}).trim();
 const pythonLicenses=[];
 for(const [index,base] of [pythonBase,dirname(pythonBase)].entries()){
  for(const entry of readdirSync(base,{withFileTypes:true})){
   if(!/^(?:licenses?|copying|notice)(?:[._-].*)?$/i.test(entry.name))continue;
   const destination=join(notices,'python-runtime',String(index),entry.name);
   if(entry.isDirectory())copyTree(join(base,entry.name),destination);
   else if(entry.isFile())copy(join(base,entry.name),destination);
   else throw Error('Unexpected link in native Python license material.');
   pythonLicenses.push(String(index)+'/'+entry.name);
  }
 }
 if(!pythonLicenses.length)throw Error('The managed native Python distribution has no retained license material.');
 const licenseRoot=join(root,'docs/licenses/windows-python-3.12.13');
 const provenance=JSON.parse(readFileSync(join(licenseRoot,'PROVENANCE.json'),'utf8'));
 if(provenance.runtimeArchive.sha256!==pins.pythonDistribution.sha256)throw Error('CPython notices do not match the pinned native distribution.');
 for(const notice of provenance.notices){
  const path=join(licenseRoot,notice.file);
  if(readFileSync(path).length!==notice.bytes||await hashFile(path)!==notice.sha256)throw Error('CPython distribution notice differs: '+notice.file);
  copy(path,join(notices,'python-runtime/standalone',notice.file));
 }
 copy(join(licenseRoot,'PROVENANCE.json'),join(notices,'python-runtime/standalone/PROVENANCE.json'));
 const speechDist=resolve(root,'.runtime/alpha-speech-windows'),speechWork=resolve(root,'.runtime/alpha-speech-windows-build');
 rmSync(speechDist,{recursive:true,force:true});rmSync(speechWork,{recursive:true,force:true});
 run(python,[resolve(root,'scripts/freeze-desktop-speech.py')],{cwd:root,env:{...environment,BAMBI_SPEECH_DISTPATH:speechDist,BAMBI_SPEECH_WORKPATH:speechWork}});
 copyTree(join(speechDist,'bambi-speech'),join(backend,'native/speech'));assertNativeTree(join(backend,'native/speech'));
 for(const [name,expected] of Object.entries(provenance.matchedFrozenCPythonLibraries)){
  if(await hashFile(join(backend,'native/speech/_internal',name))!==expected)throw Error('Frozen CPython library differs from its reviewed native archive: '+name);
 }
 for(const folder of readdirSync(join(pythonVenv,'Lib/site-packages')).filter(name=>name.endsWith('.dist-info')))copyTree(join(pythonVenv,'Lib/site-packages',folder),join(notices,'speech-metadata',folder));
 for(const asset of JSON.parse(readFileSync(join(root,'config/desktop-speech-sources.json'),'utf8'))){
  const path=join(cache,'speech-source',asset.file);await downloadPinned(asset,path);copy(path,join(notices,'speech-source',asset.file));
 }
 copy(join(root,'config/desktop-speech-sources.json'),join(notices,'speech-source/SOURCE-MANIFEST.json'));
 const llamaZip=await acquire(pins.llama);
 const listing=execFileSync('tar',['-tf',llamaZip],{encoding:'utf8',maxBuffer:4*1024**2}).trim().split(/\r?\n/);
 const approved=llamaEntries(listing),llamaExtract=join(buildEnv,'llama');mkdirSync(llamaExtract);
 run('tar',['-xf',llamaZip,'-C',llamaExtract,...approved]);
 copyTree(join(llamaExtract,'lib/ollama'),join(backend,'native/llama'));assertNativeTree(join(backend,'native/llama'));
 writeFileSync(join(notices,'LLAMA-SELECTION.json'),JSON.stringify({archive:pins.llama,entries:approved},null,2)+'\n');
 return {python:actualPython,pythonDistribution:pins.pythonDistribution,pythonLicenses,distributionNotices:provenance.notices.length,matchedCPythonLibraries:Object.keys(provenance.matchedFrozenCPythonLibraries).length,pyinstaller:'6.22.3',buildLockSha256:await hashFile(join(root,'packages/speech/desktop-windows.lock')),environment:'Fresh checksum-pinned native Windows x64 CPython; hash-verified wheels; frozen in this build'};
}
