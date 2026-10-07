// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Build frozen services on Windows itself. Linux inspection is preparation only.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync,existsSync,statfsSync,openSync,closeSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildOptions,downloadPinned,hashFile,files,copy,copyTree,inventory,logicalPath,sourcePathAllowed,llamaEntries,assertNativeTree,assertWindowsX64,stageWindowsSource,windowsDependencyReport} from './desktop-windows-support.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
process.chdir(root);
if(process.argv.includes('--help')){
 console.log('Native Windows x64: node scripts/desktop-windows-build.mjs smoke|alpha [0.1.0-smoke.N|0.1.0-alpha.N]. Default: smoke 0.1.0-smoke.4.');process.exit(0);
}
const {phase,version,alpha}=buildOptions(process.argv.slice(2),process.env);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Use a native Windows x64 build host for this target.');
const pins=JSON.parse(readFileSync('config/desktop-windows-runtime.json','utf8'));
const output=resolve('dist/desktop-windows',version);
if(existsSync(output))throw Error('Immutable Windows version output already exists: '+output);
const stage=resolve('.runtime/desktop-windows-stage'),backend=join(stage,'backend'),notices=join(stage,'notices');
const cache=resolve('.runtime/desktop-windows-downloads');mkdirSync(cache,{recursive:true});
const lockPath=resolve('.runtime/desktop-windows-build.lock');
const lock=openSync(lockPath,'wx');writeFileSync(lock,String(process.pid));
try{await build();}finally{closeSync(lock);rmSync(lockPath);}

async function build(){
 const space=statfsSync(root);
 if(space.bavail*space.bsize<(alpha?6:2)*1024**3)throw Error(`The ${phase} build needs at least ${alpha?6:2} GiB free for its native build tree and verified archives.`);
 const run=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',windowsHide:true,...options});
 const acquire=async asset=>{const path=join(cache,asset.file);await downloadPinned(asset,path);return path;};
 const nodeArchive=await acquire(pins.node),electronZip=await acquire(pins.electron);
 // Only generated staging paths are reset. Versioned results and Linux handoff
 // artifacts are never overwritten, including after a failed packaging attempt.
 rmSync(stage,{recursive:true,force:true});mkdirSync(backend,{recursive:true});mkdirSync(notices,{recursive:true});
 const extract=join(stage,'extract');mkdirSync(extract);
 run('tar',['-xf',nodeArchive,'-C',extract]);
 const nodeRoot=join(extract,`node-v${pins.node.version}-win-x64`);
 const bundledNode=join(backend,'node/bin/node.exe');copy(join(nodeRoot,'node.exe'),bundledNode);assertWindowsX64(bundledNode);
 copy(join(nodeRoot,'LICENSE'),join(notices,'NODE-LICENSE.txt'));
 const nodeOutput=execFileSync(bundledNode,['--no-warnings','--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(':memory:');console.log(JSON.stringify({version:process.version,sqlite:db.prepare('select 42 as result').get().result}));db.close();"],{encoding:'utf8',windowsHide:true});
 const bundledCheck=JSON.parse(nodeOutput.trim());
 if(bundledCheck.version!=='v'+pins.node.version||bundledCheck.sqlite!==42)throw Error('Bundled native Node/SQLite check failed.');
 const csc=join(process.env.SystemRoot||process.env.WINDIR||'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 if(!existsSync(csc))throw Error('Windows inbox .NET Framework x64 compiler is required for the private Job Object helper.');
 const ownership=join(backend,'native/ownership/bambi-job.exe');mkdirSync(dirname(ownership),{recursive:true});
 run(csc,['/nologo','/target:exe','/platform:x64','/optimize+','/out:'+ownership,resolve('apps/desktop/windows-job.cs')]);assertWindowsX64(ownership);
 let speechBuild;
 if(alpha){
  const uvArchive=await acquire(pins.uv);run('tar',['-xf',uvArchive,'-C',extract]);
  // Upstream Windows ZIPs place uv.exe directly at their root.
  const uv=join(extract,'uv.exe');assertWindowsX64(uv);
  const buildEnv=resolve('.runtime/alpha-windows-build');rmSync(buildEnv,{recursive:true,force:true});mkdirSync(buildEnv,{recursive:true});
  const pythonVenv=join(buildEnv,'venv'),python=join(pythonVenv,'Scripts/python.exe');
  const buildEnvironment={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',UV_PYTHON_INSTALL_DIR:join(buildEnv,'python'),UV_CACHE_DIR:join(buildEnv,'cache')};
  run(uv,['venv',pythonVenv,'--python',pins.python,'--managed-python','--no-project'],{env:buildEnvironment});
  run(uv,['pip','install','--python',python,'-r',resolve('packages/speech/desktop-build.lock')],{env:buildEnvironment});
  const actualPython=execFileSync(python,['-c','import platform; print(platform.python_version())'],{encoding:'utf8',env:buildEnvironment}).trim();
  if(actualPython!==pins.python)throw Error('Native Python build differs from the pinned version.');
  const speechDist=resolve('.runtime/alpha-speech-windows'),speechWork=resolve('.runtime/alpha-speech-windows-build');
  rmSync(speechDist,{recursive:true,force:true});rmSync(speechWork,{recursive:true,force:true});
  run(python,['scripts/freeze-desktop-speech.py'],{env:{...buildEnvironment,BAMBI_SPEECH_DISTPATH:speechDist,BAMBI_SPEECH_WORKPATH:speechWork}});
  copyTree(join(speechDist,'bambi-speech'),join(backend,'native/speech'));assertNativeTree(join(backend,'native/speech'));
  const metadata=join(pythonVenv,'Lib/site-packages');
  for(const folder of readdirSync(metadata).filter(name=>name.endsWith('.dist-info')))copyTree(join(metadata,folder),join(notices,'speech-metadata',folder));
  for(const asset of JSON.parse(readFileSync('config/desktop-speech-sources.json','utf8'))){
   const path=join(cache,'speech-source',asset.file);await downloadPinned(asset,path);copy(path,join(notices,'speech-source',asset.file));
  }
  copy(resolve('config/desktop-speech-sources.json'),join(notices,'speech-source/SOURCE-MANIFEST.json'));
  speechBuild={python:actualPython,pyinstaller:'6.22.3',buildLockSha256:await hashFile('packages/speech/desktop-build.lock'),environment:'Fresh uv-managed native Windows x64 CPython; frozen in this build'};
  const llamaZip=await acquire(pins.llama);
  const listing=execFileSync('tar',['-tf',llamaZip],{encoding:'utf8',maxBuffer:4*1024**2}).trim().split(/\r?\n/);
  const approved=llamaEntries(listing),llamaExtract=join(stage,'llama');mkdirSync(llamaExtract);
  // Extract the reviewed CPU/Vulkan slice only, never the CUDA acquisition tree.
  run('tar',['-xf',llamaZip,'-C',llamaExtract,...approved]);
  copyTree(join(llamaExtract,'lib/ollama'),join(backend,'native/llama'));assertNativeTree(join(backend,'native/llama'));
  writeFileSync(join(notices,'LLAMA-SELECTION.json'),JSON.stringify({archive:pins.llama,entries:approved},null,2)+'\n');
 }
 const electronDist=resolve('.runtime/desktop-windows-electron');rmSync(electronDist,{recursive:true,force:true});mkdirSync(electronDist,{recursive:true});
 run('tar',['-xf',electronZip,'-C',electronDist]);assertWindowsX64(join(electronDist,'electron.exe'));
 for(const name of ['LICENSE','LICENSES.chromium.html'])copy(join(electronDist,name),join(notices,'electron',name));
 run(process.execPath,['scripts/prepare-vad.mjs']);rmSync(resolve('dist/web'),{recursive:true,force:true});
 run(process.execPath,['node_modules/vite/bin/vite.js','build','apps/web','--outDir','../../dist/web']);
 for(const folder of ['apps/server','packages','config','presets'])copyTree(resolve(folder),join(backend,folder),path=>sourcePathAllowed(folder+'/'+path));
 copy(resolve('apps/web/index.html'),join(backend,'apps/web/index.html'));
 for(const name of ['windows-supervisor.mjs','windows-runtime-paths.mjs'])copy(resolve('apps/desktop',name),join(backend,'apps/desktop',name));
 copyTree(resolve('dist/web'),join(backend,'dist/web'));
 copyTree(resolve('assets/sounds'),join(backend,'assets/sounds'),path=>['tick-clicks.json','tick_main.wav','tick_sub.wav'].includes(path));
 writeFileSync(join(backend,'package.json'),JSON.stringify({name:'bambi-local-backend',version,type:'module'},null,2)+'\n');
 const dependencies=new Map();
 function locate(name,parent){
  let dir=parent;
  while(true){
   const local=relative(root,dir);if(local.startsWith('..')||isAbsolute(local))break;
   const path=join(dir,'node_modules',name);if(existsSync(join(path,'package.json')))return path;
   if(dir===root)break;const next=dirname(dir);if(next===dir)break;dir=next;
  }
  throw Error('Missing runtime dependency '+name);
 }
 function dependency(name,parent=root){
  const path=locate(name,parent);if(dependencies.has(path))return;
  const pkg=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));dependencies.set(path,pkg);
  for(const child of Object.keys(pkg.dependencies||{}))dependency(child,path);
  if(name==='esbuild')dependency('@esbuild/win32-x64',path);
 }
 for(const name of ['express','ws','zod','tsx'])dependency(name);
 for(const [path] of dependencies)copyTree(path,join(backend,relative(root,path)),file=>!file.split('/').includes('node_modules'));
 for(const path of ['LICENSE','LICENSING.md','docs/LICENSE.stable2','docs/STABLE_CONTENT.md','docs/LOCAL_AUDIO_LICENSES.md'])copy(resolve(path),join(notices,path));
 copyTree(resolve('docs/licenses'),join(notices,'docs/licenses'));
 copy(resolve('voices/bambi_classic.json'),join(notices,'voices/bambi_classic.json'));
 writeFileSync(join(notices,'DEPENDENCIES.json'),JSON.stringify([...dependencies].map(([path,pkg])=>({path:logicalPath(relative(root,path)),name:pkg.name,version:pkg.version,license:pkg.license,repository:pkg.repository})),null,2)+'\n');
 const {writeSamples}=await import('./desktop-windows-sample.mjs');writeSamples(join(backend,'dist/web/samples'),alpha);
 const source=join(stage,'source'),sourceManifest=await stageWindowsSource(root,source,version),{sourceDigest}=sourceManifest;
 writeFileSync(join(source,'SOURCE-MANIFEST.json'),JSON.stringify(sourceManifest,null,2)+'\n');
 run('tar',['-czf',join(backend,'dist/web/corresponding-source.tar.gz'),'-C',source,'.']);
 const guide=readFileSync('docs/DESKTOP_WINDOWS.md','utf8').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 writeFileSync(join(backend,'dist/web/desktop-guide.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Bambi Local ${version} guide</title><body><a href="/">Open companion</a> · <a href="/setup">Setup</a> · <a href="/corresponding-source.tar.gz">Matching application source</a>${alpha?' · <a href="/samples/studio-chimes.bambi.json" download>Prepared Studio sample</a>':''}<pre style="white-space:pre-wrap;max-width:80ch">${guide}</pre></body></html>`);
 assertNativeTree(backend);
 const dependencyReport=windowsDependencyReport(backend);
 writeFileSync(join(notices,'WINDOWS-DLL-IMPORTS.json'),JSON.stringify(dependencyReport,null,2)+'\n');
 if(dependencyReport.unresolved.length)throw Error('Bundled native DLL dependencies are incomplete: '+JSON.stringify(dependencyReport.unresolved));
 const shell=join(stage,'shell');mkdirSync(shell);
 for(const name of ['main.cjs','preload.cjs','runtime-environment.cjs'])copy(resolve('apps/desktop',name),join(shell,name));
 writeFileSync(join(shell,'package.json'),JSON.stringify({name:alpha?'bambi-local-alpha':'bambi-local-smoke',version,main:'main.cjs',author:'BambiOS',license:'AGPL-3.0-only'},null,2)+'\n');
 const manifest={version,phase,platform:'win32',architecture:'x64',builtAt:new Date().toISOString(),sourceDigest,
  qualification:{status:'built-unqualified',nativeNodeSQLite:bundledCheck,installer:false,conversation:false,physicalAudio:false,gpu:false},
  shell:{mainSha256:await hashFile(join(shell,'main.cjs')),preloadSha256:await hashFile(join(shell,'preload.cjs')),runtimeEnvironmentSha256:await hashFile(join(shell,'runtime-environment.cjs'))},
  node:pins.node,electron:pins.electron,builder:pins.builder,loader:'tsx@4.20.6',
  native:{ownership:{source:'apps/desktop/windows-job.cs',jobLimit:'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE'},...(alpha?{llama:pins.llama,speech:speechBuild}:{})},
  capabilities:{sample:true,ai:alpha,speech:alpha,devices:false,onlineMedia:false},
  dependencies:[...dependencies.values()].map(pkg=>({name:pkg.name,version:pkg.version})),files:await inventory(backend)};
 writeFileSync(join(notices,'RUNTIME-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
 writeFileSync(join(backend,'dist/web/runtime-manifest.json'),JSON.stringify({...manifest,files:undefined},null,2)+'\n');
 run(process.execPath,['node_modules/electron-builder/cli.js','--config',resolve('desktop-windows-builder.cjs'),'--win','--x64','--publish','never'],{env:{...process.env,BAMBI_WINDOWS_VERSION:version,BAMBI_WINDOWS_PHASE:phase,BAMBI_ELECTRON_DIST:electronDist}});
 for(const file of manifest.files){
  const actual=join(output,'win-unpacked/resources/backend',file.path);
  if(!existsSync(actual)||await hashFile(actual)!==file.sha256)throw Error('Finished Windows backend differs from staging: '+file.path);
 }
 for(const file of await inventory(notices))if(await hashFile(join(output,'win-unpacked/resources/notices',file.path))!==file.sha256)throw Error('Finished notices differ from staging: '+file.path);
 copy(join(backend,'dist/web/corresponding-source.tar.gz'),join(output,`bambi-local-${version}-source.tar.gz`));
 copy(join(notices,'RUNTIME-MANIFEST.json'),join(output,'RUNTIME-MANIFEST.json'));copy(resolve('docs/DESKTOP_WINDOWS.md'),join(output,'TESTER-GUIDE.md'));
 const sums=[];for(const path of files(output).filter(path=>dirname(path)===output&&/\.(?:exe|gz|json|md)$/.test(path)))sums.push(`${await hashFile(path)}  ${relative(output,path)}`);
 writeFileSync(join(output,'SHA256SUMS'),sums.join('\n')+'\n');
 console.log('Windows per-user NSIS artifacts:',output,'\nSource digest:',sourceDigest,'\nNative acceptance and actual installer/download tests remain separate.');
}
