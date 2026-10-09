// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,chmodSync,statfsSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {desktopVersion} from './desktop-release-version.mjs';
import {copy,copyTree,inventory,downloadPinned,digest,hashFile} from './desktop-windows-support.mjs';
import {stageDesktopSource,releaseIdentity,writeSourceManifest} from './desktop-source.mjs';
import {writeSamples} from './desktop-windows-sample.mjs';
import {assertMachArm64} from './desktop-macos-support.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));process.chdir(root);
if(process.argv.includes('--help')){console.log('node scripts/desktop-macos-build.mjs smoke|alpha 0.1.0-PHASE.N');process.exit(0);}
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Use a native macOS Apple Silicon host.');
const [phase,version,...extra]=process.argv.slice(2);
if(!['smoke','alpha'].includes(phase)||!desktopVersion(version,phase)||extra.length)throw Error('Choose a fresh version matching smoke or alpha.');
const alpha=phase==='alpha',product=alpha?'Bambi Local':'Bambi Local Smoke';
const output=resolve('dist/desktop-macos',version);
if(existsSync(output))throw Error('Immutable version output already exists. Choose a new version.');
const stage=resolve('.runtime/desktop-macos-stage'),backend=join(stage,'backend'),notices=join(stage,'notices');
const run=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',...options});
const space=statfsSync(root);if(space.bavail*space.bsize<(alpha?6:2)*1024**3)throw Error('Insufficient free disk for the native Mac build.');
const nodeVersion='24.18.1',archiveName=`node-v${nodeVersion}-darwin-arm64.tar.gz`;
const nodeAsset={url:`https://nodejs.org/dist/v${nodeVersion}/${archiveName}`,bytes:52089613,sha256:'eb02f7fab96d3d67de40c5ec8566096fcb4c2026728787683ae5a97eb612b941'};
const archive=resolve('.runtime/desktop-downloads',archiveName);await downloadPinned(nodeAsset,archive);
run(process.execPath,['scripts/prepare-vad.mjs']);rmSync(resolve('dist/web'),{recursive:true,force:true});
run(process.execPath,['node_modules/vite/bin/vite.js','build','apps/web','--outDir','../../dist/web']);
rmSync(stage,{recursive:true,force:true});mkdirSync(backend,{recursive:true});mkdirSync(notices,{recursive:true});
for(const folder of ['apps/server','packages','config','presets'])copyTree(resolve(folder),join(backend,folder),path=>/\.(?:ts|mjs|json|py|lock|md|js|txt)$/.test(path));
copy(resolve('apps/web/index.html'),join(backend,'apps/web/index.html'));
copy(resolve('apps/desktop/supervisor.mjs'),join(backend,'apps/desktop/supervisor.mjs'));
copyTree(resolve('dist/web'),join(backend,'dist/web'));
copyTree(resolve('assets/sounds'),join(backend,'assets/sounds'),path=>['tick-clicks.json','tick_main.wav','tick_sub.wav'].includes(path));
writeFileSync(join(backend,'package.json'),JSON.stringify({name:'bambi-local-backend',version,type:'module'},null,2)+'\n');
const dependencies=new Map();
function locate(name,parent){
 let dir=parent;
 while(dir===root||dir.startsWith(root+'/')){const path=join(dir,'node_modules',name);if(existsSync(join(path,'package.json')))return path;const next=dirname(dir);if(next===dir)break;dir=next;}
 throw Error('Missing locked runtime dependency '+name);
}
function dependency(name,parent=root){
 const path=locate(name,parent);if(dependencies.has(path))return;
 const pkg=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));dependencies.set(path,pkg);
 for(const child of Object.keys(pkg.dependencies||{}))dependency(child,path);
 if(name==='esbuild')dependency('@esbuild/darwin-arm64',path);
}
for(const name of ['express','ws','zod','tsx'])dependency(name);
for(const [path] of dependencies)copyTree(path,join(backend,relative(root,path)),file=>!file.split('/').includes('node_modules'));
const extracted=join(stage,'node-extracted');mkdirSync(extracted);run('/usr/bin/tar',['-xzf',archive,'-C',extracted]);
const nodeRoot=join(extracted,`node-v${nodeVersion}-darwin-arm64`);
copy(join(nodeRoot,'bin/node'),join(backend,'node/bin/node'));chmodSync(join(backend,'node/bin/node'),0o755);assertMachArm64(join(backend,'node/bin/node'));
copy(join(nodeRoot,'LICENSE'),join(notices,'NODE-LICENSE.txt'));
for(const path of ['LICENSE','LICENSING.md','docs/LICENSE.stable2','docs/STABLE_CONTENT.md','docs/LOCAL_AUDIO_LICENSES.md'])copy(resolve(path),join(notices,path));
copyTree(resolve('docs/licenses'),join(notices,'docs/licenses'));
copy(resolve('voices/bambi_classic.json'),join(notices,'voices/bambi_classic.json'));
writeFileSync(join(notices,'DEPENDENCIES.json'),JSON.stringify([...dependencies].map(([path,pkg])=>({path:relative(root,path),name:pkg.name,version:pkg.version,license:pkg.license,repository:pkg.repository})),null,2)+'\n');
let native;
if(alpha){
 const pins=JSON.parse(readFileSync(resolve('config/desktop-macos-runtime.json'),'utf8'));
 const {buildMacNative}=await import('./desktop-macos-native.mjs');
 native={llama:pins.llama,speech:await buildMacNative({root,backend,notices,cache:resolve('.runtime/desktop-downloads/macos-native'),pins})};
}
writeSamples(join(backend,'dist/web/samples'),true);
const guide=`# Bambi Local ${version} · Apple Silicon tester\n\nExtract the ZIP and copy the app to Applications. This tester has an ad-hoc signature and is not notarized. Keep macOS security controls enabled; report a blocked download or launch.\n\nTry the offline sample, Play/Pause, mute and End session. In Studio, import the prepared chime sample, preview, export and reopen it. Settings export/import and named presets are in Extras.\n\n${alpha?'Use Setup to explicitly download or import supported model and speech data; allow 15 GB free. No models are downloaded automatically. Test the full reference model/context with CPU and Metal separately. macOS may request microphone permission after you enable it in Privacy & access.':'AI, speech and microphone are unavailable in this Smoke build.'}\n\nPhysical downloaded-app/Gatekeeper, audible output, microphone capture, permission revocation and sleep/wake remain unqualified. Alpha full-model Metal/CPU and disconnected-network conversation also require their recorded tests. Do not describe a missing gate as passed.\n`;
const escaped=guide.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
writeFileSync(join(backend,'dist/web/desktop-guide.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Bambi Local tester guide</title><body><a href="/">Open app</a> · <a href="/setup">Setup</a> · <a href="/corresponding-source.tar.gz">Matching source</a> · <a href="/samples/studio-chimes.bambi.json" download>Studio sample</a><pre style="white-space:pre-wrap;max-width:80ch">${escaped}</pre></body></html>`);
const source=join(stage,'source'),sourceManifest=await stageDesktopSource(root,source,version),release=await releaseIdentity(root,sourceManifest);
writeSourceManifest(source,sourceManifest);
run('/usr/bin/tar',['-czf',join(backend,'dist/web/corresponding-source.tar.gz'),'-C',source,'.']);
const manifest={version,phase,release,builtAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,sourceDigest:sourceManifest.sourceDigest,
 shell:Object.fromEntries(['main.cjs','permission-policy.cjs','runtime-environment.cjs',...(alpha?['preload.cjs']:[])].map(name=>[{'main.cjs':'mainSha256','permission-policy.cjs':'permissionPolicySha256','runtime-environment.cjs':'runtimeEnvironmentSha256','preload.cjs':'preloadSha256'}[name],digest(readFileSync(resolve('apps/desktop',name)))])),
 node:{version:nodeVersion,...nodeAsset},electron:'44.5.1',builder:'26.15.3',loader:'tsx@4.20.6',
 native,signing:{identity:'ad-hoc',notarized:false,recipientGatekeeper:'pending'},capabilities:{sample:true,studio:true,settings:true,ai:alpha,speech:alpha,devices:false,onlineMedia:false},
 dependencies:[...dependencies.values()].map(pkg=>({name:pkg.name,version:pkg.version})),files:await inventory(backend)};
writeFileSync(join(notices,'RUNTIME-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(backend,'dist/web/runtime-manifest.json'),JSON.stringify({...manifest,files:undefined},null,2)+'\n');
const shell=join(stage,'shell');mkdirSync(shell);
for(const name of ['main.cjs','permission-policy.cjs','runtime-environment.cjs',...(alpha?['preload.cjs']:[])])copy(resolve('apps/desktop',name),join(shell,name));
writeFileSync(join(shell,'package.json'),JSON.stringify({name:alpha?'bambi-local-alpha':'bambi-local-smoke',version,main:'main.cjs',description:'Bambi Local Apple Silicon tester',author:'BambiOS',license:'AGPL-3.0-only',dependencies:{},devDependencies:{}},null,2)+'\n');
run(process.execPath,['node_modules/electron-builder/cli.js','--config','desktop-macos-builder.cjs','--mac','--arm64','--publish','never'],{env:{...process.env,BAMBI_MACOS_VERSION:version,BAMBI_MACOS_PHASE:phase,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
const bundle=join(output,'mac-arm64',product+'.app'),resources=join(bundle,'Contents/Resources');
for(const file of manifest.files)if(await hashFile(join(resources,'backend',file.path))!==file.sha256)throw Error('Finished backend differs from staging: '+file.path);
assertMachArm64(join(bundle,'Contents/MacOS',product));
run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',bundle]);
copy(join(backend,'dist/web/corresponding-source.tar.gz'),join(output,`bambi-local-${version}-macos-arm64-source.tar.gz`));
copy(join(notices,'RUNTIME-MANIFEST.json'),join(output,'RUNTIME-MANIFEST.json'));
writeFileSync(join(output,'TESTER-GUIDE.md'),guide);
run('/usr/bin/tar',['-czf',join(output,'NOTICES.tar.gz'),'-C',join(resources,'notices'),'.']);
const sums=[];
const {readdirSync}=await import('node:fs');sums.length=0;
for(const filename of readdirSync(output).sort())if(/\.(?:zip|tar\.gz|json|md)$/.test(filename))sums.push(`${await hashFile(join(output,filename))}  ${filename}`);
writeFileSync(join(output,'SHA256SUMS'),sums.join('\n')+'\n');
console.log('macOS tester artifacts:',output,'\nMatching source digest:',manifest.sourceDigest);
