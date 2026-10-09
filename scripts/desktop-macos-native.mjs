// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {downloadPinned,hashFile,copy,copyTree,inventory} from './desktop-windows-support.mjs';
import {assertMachArm64,macNativeReport,copyResolvedNativeTree} from './desktop-macos-support.mjs';

export async function buildMacNative({root,backend,notices,cache,pins}){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Native Apple Silicon is required.');
 const run=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',...options});
 const acquire=async asset=>{const path=join(cache,asset.file);await downloadPinned(asset,path);return path;};
 const build=resolve(root,'.runtime/alpha-macos-build');rmSync(build,{recursive:true,force:true});mkdirSync(build,{recursive:true});
 const extracted=join(build,'python');mkdirSync(extracted);
 run('/usr/bin/tar',['-xzf',await acquire(pins.pythonDistribution),'-C',extracted]);
 const python=join(extracted,'python/bin/python3.12');assertMachArm64(python);
 const version=execFileSync(python,['-c','import platform; print(platform.python_version())'],{encoding:'utf8'}).trim();
 if(version!==pins.python)throw Error('Pinned macOS CPython version differs.');
 const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PIP_CONFIG_FILE:'/dev/null',PIP_DISABLE_PIP_VERSION_CHECK:'1',PYTHONNOUSERSITE:'1'};
 delete env.PYTHONHOME;delete env.PYTHONPATH;delete env.VIRTUAL_ENV;
 const venv=join(build,'venv');run(python,['-m','venv',venv],{env});const freezePython=join(venv,'bin/python');
 const wheels=join(build,'wheels');mkdirSync(wheels);
 for(const asset of pins.speechWheels)copy(await acquire(asset),join(wheels,asset.file));
 run(freezePython,['-m','pip','install','--no-index','--find-links',wheels,'--require-hashes','--only-binary',':all:','-r',join(root,'packages/speech/desktop-macos.lock')],{env});
 run(freezePython,['-m','pip','check'],{env});
 const dist=join(build,'dist'),work=join(build,'work');
 run(freezePython,[join(root,'scripts/freeze-desktop-speech.py')],{cwd:root,env:{...env,BAMBI_SPEECH_DISTPATH:dist,BAMBI_SPEECH_WORKPATH:work}});
 const speech=join(dist,'bambi-speech'),speechReport=macNativeReport(speech);
 if(speechReport.unresolved.length)throw Error('Frozen speech has external native dependencies: '+JSON.stringify(speechReport.unresolved));
 // PyInstaller may create internal links. Audit first, then copy their resolved
 // bytes into the self-contained resource tree used by the shared inventory.
 copyResolvedNativeTree(speech,join(backend,'native/speech'));
 assertMachArm64(join(backend,'native/speech/bambi-speech'));
 const site=join(venv,'lib/python3.12/site-packages');
 for(const folder of readdirSync(site).filter(name=>name.endsWith('.dist-info')))copyTree(join(site,folder),join(notices,'speech-metadata',folder));
 const provenanceRoot=join(root,'docs/licenses/macos-python-3.12.13'),provenance=JSON.parse(readFileSync(join(provenanceRoot,'PROVENANCE.json'),'utf8'));
 if(provenance.runtimeArchive.sha256!==pins.pythonDistribution.sha256)throw Error('Mac CPython notice provenance differs.');
 for(const notice of provenance.notices){const path=join(provenanceRoot,notice.file);if(readFileSync(path).length!==notice.bytes||await hashFile(path)!==notice.sha256)throw Error('Mac CPython notice changed: '+notice.file);copy(path,join(notices,'python-runtime/standalone',notice.file));}
 copy(join(provenanceRoot,'PROVENANCE.json'),join(notices,'python-runtime/standalone/PROVENANCE.json'));
 for(const asset of JSON.parse(readFileSync(join(root,'config/desktop-speech-sources.json'),'utf8'))){const path=join(cache,'speech-source',asset.file);await downloadPinned(asset,path);copy(path,join(notices,'speech-source',asset.file));}
 copy(join(root,'config/desktop-speech-sources.json'),join(notices,'speech-source/SOURCE-MANIFEST.json'));
 const llamaArchive=await acquire(pins.llama),llamaExtract=join(build,'llama');mkdirSync(llamaExtract);
 const listing=execFileSync('/usr/bin/tar',['-tzf',llamaArchive],{encoding:'utf8'}).trim().split('\n');
 const entries=listing.filter(name=>name==='llama-server'||/^[A-Z0-9_]+_(?:LICENSE|NOTICE)$/.test(name));
 if(!entries.includes('llama-server')||!entries.includes('LLAMA_CPP_LICENSE'))throw Error('Pinned Mac llama archive selection differs.');
 run('/usr/bin/tar',['-xzf',llamaArchive,'-C',llamaExtract,...entries]);
 const llama=join(backend,'native/llama/llama-server');mkdirSync(join(backend,'native/llama'),{recursive:true});
 run('/usr/bin/lipo',[join(llamaExtract,'llama-server'),'-thin','arm64','-output',llama]);chmodSync(llama,0o755);assertMachArm64(llama);
 run('/usr/bin/codesign',['--force','--sign','-',llama]);
 for(const entry of entries.filter(name=>name!=='llama-server'))copy(join(llamaExtract,entry),join(notices,'llama',entry));
 const native=macNativeReport(join(backend,'native'));
 if(native.unresolved.length)throw Error('Packaged Mac native dependency closure is incomplete: '+JSON.stringify(native.unresolved));
 for(const entry of native.entries)run('/usr/bin/codesign',['--verify','--strict',entry.path]);
 writeFileSync(join(notices,'MACOS-NATIVE-IMPORTS.json'),JSON.stringify(native,null,2)+'\n');
 writeFileSync(join(notices,'LLAMA-SELECTION.json'),JSON.stringify({archive:pins.llama,entries,transformation:'lipo thin arm64; ad-hoc codesign; only system dependencies'},null,2)+'\n');
 writeFileSync(join(notices,'MACOS-NATIVE-INVENTORY.json'),JSON.stringify(await inventory(join(backend,'native')),null,2)+'\n');
 return {python:version,pythonDistribution:pins.pythonDistribution,pyinstaller:'6.22.3',buildLockSha256:await hashFile(join(root,'packages/speech/desktop-macos.lock')),nativeLibraries:native.entries.length,environment:'Fresh pinned native CPython, exact verified wheels, arm64 freeze and native dependency/signature audit; execution qualification pending'};
}
