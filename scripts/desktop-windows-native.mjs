// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,mkdirSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
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
 run(uv,['venv',pythonVenv,'--python',pins.python,'--managed-python','--no-project'],{env:environment});
 run(uv,['pip','install','--python',python,'--require-hashes','--only-binary',':all:','-r',resolve(root,'packages/speech/desktop-windows.lock')],{env:environment});
 run(uv,['pip','check','--python',python],{env:environment});
 const actualPython=execFileSync(python,['-c','import platform; print(platform.python_version())'],{encoding:'utf8',env:environment}).trim();
 if(actualPython!==pins.python)throw Error('Native Python differs from the pinned version.');
 const speechDist=resolve(root,'.runtime/alpha-speech-windows'),speechWork=resolve(root,'.runtime/alpha-speech-windows-build');
 rmSync(speechDist,{recursive:true,force:true});rmSync(speechWork,{recursive:true,force:true});
 run(python,[resolve(root,'scripts/freeze-desktop-speech.py')],{cwd:root,env:{...environment,BAMBI_SPEECH_DISTPATH:speechDist,BAMBI_SPEECH_WORKPATH:speechWork}});
 copyTree(join(speechDist,'bambi-speech'),join(backend,'native/speech'));assertNativeTree(join(backend,'native/speech'));
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
 return {python:actualPython,pyinstaller:'6.22.3',buildLockSha256:await hashFile(join(root,'packages/speech/desktop-windows.lock')),environment:'Fresh uv-managed native Windows x64 CPython; hash-verified wheels; frozen in this build'};
}
