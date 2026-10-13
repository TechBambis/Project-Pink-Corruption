// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {desktopVersion} from './desktop-release-version.mjs';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,copyFileSync,realpathSync,statSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stageDesktopSource,releaseIdentity,writeSourceManifest} from './desktop-source.mjs';
import {llamaEntries,stageLinuxLlama} from './desktop-llama-selection.mjs';
import {hashFile} from './desktop-windows-support.mjs';
import {verifyCudaNotices} from './desktop-cuda-notices.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));process.chdir(root);
if(process.argv.includes('--help')){console.log('Smoke: node scripts/desktop-build.mjs. Alpha: node scripts/desktop-alpha-build.mjs 0.1.0-alpha.N');process.exit(0);}
if(process.platform!=='linux'||process.arch!=='x64')throw Error('This smoke builder qualifies Linux x64 only.');
const alpha=!!process.env.BAMBI_ALPHA_VERSION;
const version=process.env.BAMBI_ALPHA_VERSION||process.env.BAMBI_SMOKE_VERSION||'0.1.0-smoke.1',nodeVersion='24.18.1';
if(process.env.BAMBI_ALPHA_VERSION&&process.env.BAMBI_SMOKE_VERSION)throw Error('Select one build phase.');
if(!desktopVersion(version,alpha?'alpha':'smoke',{development:alpha}))throw Error('Invalid desktop version for the selected phase.');
const output=resolve(alpha||process.env.BAMBI_SMOKE_VERSION?'dist/desktop/'+version:'dist/desktop');
if(alpha&&existsSync(output)||!alpha&&existsSync(join(output,`bambi-local-${version}-x86_64.AppImage`)))throw Error('Immutable version output already exists. Choose a new alpha version.');
const nodeSha='d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0';
const stage=resolve(alpha?'.runtime/desktop-alpha-stage':'.runtime/desktop-stage'),backend=join(stage,'backend'),notices=join(stage,'notices');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',...options});
function files(path){return readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
 const full=join(path,entry.name);if(entry.isSymbolicLink())throw Error('Symlink in reviewed input: '+relative(root,full));
 return entry.isDirectory()?files(full):entry.isFile()?[full]:[];
});}
function copy(from,to){const stat=lstatSync(from);if(!stat.isFile())throw Error('Expected regular reviewed file: '+from);mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);}
function copyTree(from,to,accept=()=>true){for(const file of files(from)){const path=relative(from,file);if(accept(path))copy(file,join(to,path));}}
const cache=resolve('.runtime/desktop-downloads');mkdirSync(cache,{recursive:true});
const archive=join(cache,`node-v${nodeVersion}-linux-x64.tar.xz`);
if(!existsSync(archive)){const response=await fetch(`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-x64.tar.xz`);if(!response.ok)throw Error('Node download failed');writeFileSync(archive,Buffer.from(await response.arrayBuffer()));}
if(digest(readFileSync(archive))!==nodeSha)throw Error('Pinned Node archive checksum mismatch');
// Never package an old Vite output or source-tree runtime data.
run(process.execPath,['scripts/prepare-vad.mjs']);rmSync(resolve('dist/web'),{recursive:true,force:true});run(process.execPath,['node_modules/vite/bin/vite.js','build','apps/web','--outDir','../../dist/web']);
rmSync(stage,{recursive:true,force:true});mkdirSync(backend,{recursive:true});mkdirSync(notices,{recursive:true});
if(alpha){
 await verifyCudaNotices(root);
 run(resolve('.runtime/alpha-freeze-env/bin/python'),['scripts/freeze-desktop-speech.py']);
 const nativeSource=resolve('.runtime/alpha-speech/bambi-speech');
 function nativeFiles(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>{const full=join(path,e.name);if(e.isDirectory())return nativeFiles(full);const real=realpathSync(full);if(!real.startsWith(nativeSource+'/')||!statSync(real).isFile())throw Error('Escaping native runtime link');return [full];});}
 for(const file of nativeFiles(nativeSource))copy(realpathSync(file),join(backend,'native/speech',relative(nativeSource,file)));
 const llamaArchive=resolve('.runtime/ollama.tar.zst');
 const llamaSha='9fcd79ac4575b2bd31b992eee18b1000c8ad126b451627c8f8cd091714cfbb10';
 if(await hashFile(llamaArchive)!==llamaSha)throw Error('Pinned llama archive mismatch');
 const listing=execFileSync('tar',['--zstd','-tf',llamaArchive],{encoding:'utf8'}).trim().split('\n');
 const approved=llamaEntries(listing,'linux');
 const extracted=join(stage,'llama-extracted');mkdirSync(extracted);run('tar',['--zstd','-xf',llamaArchive,'-C',extracted,...approved]);
 const shipped=stageLinuxLlama(extracted,join(backend,'native/llama'),approved);
 writeFileSync(join(notices,'LLAMA-SELECTION.json'),JSON.stringify({archiveSha256:llamaSha,entries:approved,files:shipped},null,2)+'\n');
 for(const asset of JSON.parse(readFileSync(resolve('config/desktop-speech-sources.json'),'utf8'))){const path=resolve('.runtime/alpha-third-party',asset.file);if(!existsSync(path)){mkdirSync(dirname(path),{recursive:true});const response=await fetch(asset.url);if(!response.ok)throw Error('Dependency source download failed');writeFileSync(path,Buffer.from(await response.arrayBuffer()));}if(lstatSync(path).size!==asset.bytes||digest(readFileSync(path))!==asset.sha256)throw Error('Dependency source mismatch: '+asset.file);copy(path,join(notices,'speech-source',asset.file));}
 copy(resolve('config/desktop-speech-sources.json'),join(notices,'speech-source/SOURCE-MANIFEST.json'));
 const metadata=resolve('.runtime/alpha-freeze-env/lib/python3.12/site-packages');for(const folder of readdirSync(metadata).filter(p=>p.endsWith('.dist-info')))copyTree(join(metadata,folder),join(notices,'speech-metadata',folder));
}
for(const folder of ['apps/server','packages','config','presets'])copyTree(resolve(folder),join(backend,folder),path=>/\.(?:ts|mjs|json|py|lock|md|js|txt)$/.test(path));
// Speech vocabulary reads the UI's authored options by module-relative path.
copy(resolve('apps/web/index.html'),join(backend,'apps/web/index.html'));
copy(resolve('apps/desktop/supervisor.mjs'),join(backend,'apps/desktop/supervisor.mjs'));
copyTree(resolve('dist/web'),join(backend,'dist/web'));
copyTree(resolve('assets/sounds'),join(backend,'assets/sounds'),path=>['tick-clicks.json','tick_main.wav','tick_sub.wav'].includes(path));
writeFileSync(join(backend,'package.json'),JSON.stringify({name:'bambi-local-backend',version,type:'module'},null,2)+'\n');
const dependencies=new Map();
function locate(name,parent){let dir=parent;while(dir.startsWith(root)){const path=join(dir,'node_modules',name);if(existsSync(join(path,'package.json')))return path;const next=dirname(dir);if(next===dir)break;dir=next;}throw Error('Missing runtime dependency '+name);}
function dependency(name,parent=root){
 const path=locate(name,parent);if(dependencies.has(path))return;const pkg=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));dependencies.set(path,pkg);
 for(const child of Object.keys(pkg.dependencies||{}))dependency(child,path);
 // esbuild's only Linux-x64 optional executable. Other optional platforms stay out.
 if(name==='esbuild')dependency('@esbuild/linux-x64',path);
}
for(const name of ['express','ws','zod','tsx'])dependency(name);
for(const [path] of dependencies)copyTree(path,join(backend,relative(root,path)),file=>!file.split('/').includes('node_modules'));
const nodeTemp=join(stage,'node-extracted');mkdirSync(nodeTemp);run('tar',['-xf',archive,'-C',nodeTemp]);
const nodeRoot=join(nodeTemp,`node-v${nodeVersion}-linux-x64`);
copy(join(nodeRoot,'bin/node'),join(backend,'node/bin/node'));chmodSync(join(backend,'node/bin/node'),0o755);
copy(join(nodeRoot,'LICENSE'),join(notices,'NODE-LICENSE.txt'));
for(const path of ['LICENSE','LICENSING.md','docs/LICENSE.stable2','docs/STABLE_CONTENT.md','docs/LOCAL_AUDIO_LICENSES.md'])copy(resolve(path),join(notices,path));
copyTree(resolve('docs/licenses'),join(notices,'docs/licenses'));
writeFileSync(join(notices,'DEPENDENCIES.json'),JSON.stringify([...dependencies].map(([path,pkg])=>({path:relative(root,path),name:pkg.name,version:pkg.version,license:pkg.license,repository:pkg.repository})),null,2)+'\n');

// Original 24-second stereo chime fixture, generated here; no recordings/weights.
const rate=44100,seconds=24,sample=Buffer.alloc(44+rate*seconds*4);
sample.write('RIFF');sample.writeUInt32LE(sample.length-8,4);sample.write('WAVEfmt ',8);sample.writeUInt32LE(16,16);sample.writeUInt16LE(1,20);sample.writeUInt16LE(2,22);sample.writeUInt32LE(rate,24);sample.writeUInt32LE(rate*4,28);sample.writeUInt16LE(4,32);sample.writeUInt16LE(16,34);sample.write('data',36);sample.writeUInt32LE(sample.length-44,40);
for(let i=0;i<rate*seconds;i++){const t=i/rate;for(let channel=0;channel<2;channel++){let value=0;for(let onset=0;onset<seconds;onset+=2){const dt=t-onset;if(dt>=0&&dt<2)value+=.14*Math.exp(-dt*2)*Math.min(1,dt*50)*Math.sin(2*Math.PI*[261.63,329.63,392,523.25][onset/2%4]*t+(channel?.12:0));}sample.writeInt16LE(Math.round(value*32767),44+i*4+channel*2);}}
const sampleDir=join(backend,'dist/web/samples');mkdirSync(sampleDir);writeFileSync(join(sampleDir,'offline-chimes.wav'),sample);
writeFileSync(join(sampleDir,'LICENSE.txt'),'Original synthetic offline chimes, generated by scripts/desktop-build.mjs. Copyright 2026 BambiOS. Licensed under AGPL-3.0-only, like the generator. No speech, reference media or private recordings.\n');
if(alpha){const assetId='a7bb59ef-1548-48e7-9a71-7a081319c70d';writeFileSync(join(sampleDir,'studio-chimes.bambi.json'),JSON.stringify({format:'bambi-session',version:1,title:'Offline chimes Studio sample',duration:30,created:'2026-10-06T00:00:00.000Z',description:'Original synthetic chimes for prepared Studio import, preview and export. The audio is music, not speech.',seed:0,requirements:'Web Audio; pre-rendered WAV; no live model required',assets:[{id:assetId,name:'Offline chimes.wav',mime:'audio/wav',sha256:digest(sample),data:sample.toString('base64'),attribution:'Original synthetic audio by BambiOS, AGPL-3.0-only; generated by scripts/desktop-build.mjs.'}],cues:[{id:'a7bb59ef-1548-48e7-9a71-7a081319c70e',time:0,type:'speech',text:'Original synthetic chimes — no speech or private recording.',duration:24,assetId},{id:'a7bb59ef-1548-48e7-9a71-7a081319c70f',time:0,type:'action',action:{type:'scene',scene:'Soft Pink'}}]},null,2)+'\n');}

// Corresponding Source includes the actual dirty worktree files used by this build.
const source=join(stage,'source');
const sourceManifest=await stageDesktopSource(root,source,version),{sourceDigest}=sourceManifest;
const release=await releaseIdentity(root,sourceManifest);writeSourceManifest(source,sourceManifest);
run('tar',['-czf',join(backend,'dist/web/corresponding-source.tar.gz'),'-C',source,'.']);
if(alpha){const html=readFileSync(resolve('docs/AI_ALPHA_TESTING.md'),'utf8').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');writeFileSync(join(backend,'dist/web/desktop-guide.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Bambi Local ${version} guide</title><body><a href="/">Open companion</a> · <a href="/setup">Setup</a> · <a href="/corresponding-source.tar.gz">Matching application source</a> · <a href="/samples/studio-chimes.bambi.json" download>Prepared Studio sample</a><pre style="white-space:pre-wrap;max-width:80ch">${html}</pre></body></html>`);}
const manifest={version,shell:{appRunSha256:digest(readFileSync(resolve(alpha?'apps/desktop/AppRun.alpha':'apps/desktop/AppRun'))),mainSha256:digest(readFileSync(resolve('apps/desktop/main.cjs'))),permissionPolicySha256:digest(readFileSync(resolve('apps/desktop/permission-policy.cjs'))),...(alpha?{preloadSha256:digest(readFileSync(resolve('apps/desktop/preload.cjs')))}:{})},release,builtAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,sourceDigest,node:{version:nodeVersion,archiveSha256:nodeSha,url:`https://nodejs.org/dist/v${nodeVersion}/`},electron:'44.5.1',builder:'26.15.3',loader:'tsx@4.20.6',capabilities:{sample:true,ai:alpha,speech:alpha,devices:false,onlineMedia:false},...(alpha?{native:{llama:{distribution:'ollama@0.35.1',commit:'6f767fe96',archiveSha256:'9fcd79ac4575b2bd31b992eee18b1000c8ad126b451627c8f8cd091714cfbb10'},speech:{python:'3.12.13',pyinstaller:'6.22.3',buildLockSha256:digest(readFileSync(resolve('packages/speech/desktop-build.lock')))}}}:{} ),dependencies:[...dependencies.values()].map(pkg=>({name:pkg.name,version:pkg.version})),files:files(backend).map(path=>({path:relative(backend,path),bytes:lstatSync(path).size,sha256:digest(readFileSync(path))}))};
writeFileSync(join(notices,'RUNTIME-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(backend,'dist/web/runtime-manifest.json'),JSON.stringify({...manifest,files:undefined},null,2)+'\n');
const shell=join(stage,'shell');mkdirSync(shell);copy(resolve('apps/desktop/main.cjs'),join(shell,'main.cjs'));if(alpha)copy(resolve('apps/desktop/preload.cjs'),join(shell,'preload.cjs'));
copy(resolve('apps/desktop/runtime-environment.cjs'),join(shell,'runtime-environment.cjs'));
copy(resolve('apps/desktop/permission-policy.cjs'),join(shell,'permission-policy.cjs'));
writeFileSync(join(shell,'package.json'),JSON.stringify({name:alpha?'bambi-local-alpha':'bambi-local-smoke',version,main:'main.cjs',description:'Bambi Local Linux x64 packaging smoke build',author:'BambiOS',license:'AGPL-3.0-only',dependencies:{},devDependencies:{}},null,2)+'\n');
run(process.execPath,['node_modules/electron-builder/cli.js','--config',alpha?'desktop-alpha-builder.cjs':'desktop-builder.cjs','--linux','--x64','--publish','never']);
// Check the builder's actual copy, rather than trusting staging inventory.
for(const file of manifest.files){const actual=join(output,'linux-unpacked/resources/backend',file.path);if(!existsSync(actual)||digest(readFileSync(actual))!==file.sha256)throw Error('Finished backend differs from staging: '+file.path);}
run('tar',['-czf',join(output,`bambi-local-${version}-x64.tar.gz`),'-C',join(output,'linux-unpacked'),'.']);copy(join(backend,'dist/web/corresponding-source.tar.gz'),join(output,`bambi-local-${version}-source.tar.gz`));copy(join(notices,'RUNTIME-MANIFEST.json'),join(output,'RUNTIME-MANIFEST.json'));
writeFileSync(join(output,'SHA256SUMS'),files(output).filter(path=>dirname(path)===output&&!path.endsWith('SHA256SUMS')&&/\.(?:AppImage|tar\.gz|json)$/.test(path)).map(path=>`${digest(readFileSync(path))}  ${relative(output,path)}`).join('\n')+'\n');
console.log('Desktop artifacts:',output,'\nMatching source digest:',sourceDigest);
