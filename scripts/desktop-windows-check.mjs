// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,realpathSync,cpSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {hashFile,digest,inventory,assertNativeTree,logicalPath,files} from './desktop-windows-support.mjs';
import {observeOwnedRows,observeRows,observeAcl,startObserver,stopObserver,machineConditions} from './desktop-windows-processes.mjs';

if(process.argv.includes('--help')){console.log('Native Windows: node scripts/desktop-windows-check.mjs "path to Bambi Local.exe". Evidence stays in LOCALAPPDATA/Bambi qualification.');process.exit(0);}
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Run acceptance on native Windows x64.');
if(!process.argv[2])throw Error('Supply the unpacked or installed Bambi Local.exe path.');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const outputRoot=resolve(process.env.BAMBI_WINDOWS_TEST_OUTPUT||join(process.env.LOCALAPPDATA,'Bambi qualification'));mkdirSync(outputRoot,{recursive:true});
const output=mkdtempSync(join(outputRoot,'Windows ü smoke ')),data=join(output,'User data ä'),emptyPath=join(output,'Empty PATH');mkdirSync(emptyPath);
let executable=realpathSync(resolve(process.argv[2]));
const local=relative(root,executable);
if(!local.startsWith('..')&&!isAbsolute(local)){
 const received=join(output,'Received app ü');cpSync(dirname(executable),received,{recursive:true,errorOnExist:true,force:false});executable=join(received,executable.slice(dirname(executable).length+1));
}
const resources=join(dirname(executable),'resources'),backendRoot=join(resources,'backend');
process.env.BAMBI_WINDOWS_JOB_HELPER=join(backendRoot,'native/ownership/bambi-job.exe');
const evidence={testedAt:new Date().toISOString(),executable,data,environment:machineConditions(),checks:[],measurements:{},errors:[]};
const record=(name,detail={})=>{evidence.checks.push({name,...detail});writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS',name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function stopped(rows){
 const deadline=performance.now()+12000;
 while(performance.now()<deadline){const current=await observeRows(rows.map(row=>row.pid));if(rows.every(row=>!current.some(now=>now.pid===row.pid&&now.created===row.created)))return;await delay(250);}
 assert.fail('Owned processes survived shutdown');
}
async function killOwned(row){const current=(await observeRows([row.pid])).find(now=>now.pid===row.pid);if(!current)return;assert.equal(current.created,row.created,'Refuse a recycled PID');assert.equal(current.executable,row.executable);process.kill(row.pid,'SIGKILL');}
const environment={...process.env,PATH:emptyPath,NODE_OPTIONS:'--trace-warnings',BAMBI_CLOUD_API_KEY:'qualification-sentinel'};delete environment.ELECTRON_RUN_AS_NODE;
// Playwright removes NODE_OPTIONS internally. Match that normal environment in
// ordinary native starts too; do not claim to qualify injected main-node flags.
delete environment.NODE_OPTIONS;
evidence.testConditions={nodeOptions:'Absent for all Electron starts. Existing/injected NODE_OPTIONS behavior is not qualified; backend filtering has separate portable regression coverage.',processInspection:'Persistent read-only observer started before the application; identity and NTFS ACL queries are asynchronous.'};
const applications=new Map();
async function launch(port=16969){
 const started=performance.now();
 const application=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,`--bambi-port=${port}`],cwd:output,env:environment,timeout:30000});
 applications.set(application,application.process());
 const page=await application.firstWindow();page.on('pageerror',error=>evidence.errors.push(String(error)));await page.waitForSelector('#offline-sample',{state:'visible'});
 const privacyAccess=await page.evaluate(async()=>{const response=await fetch('/api/access');return response.ok?response.json():{configured:true};});
 if(!privacyAccess.configured){
  const privacy=page.locator('#privacy-access[open]');await privacy.waitFor();
  assert.equal(await privacy.locator('.privacy-choices input:checked').count(),5);
  assert.equal(await privacy.locator('[data-required]:checked:disabled').count(),3);
  assert.equal(await privacy.locator('[name=contextToCloud]').count(),0);
  assert(!(await privacy.locator('[name=localClock]').isChecked()));assert(!(await privacy.locator('[name=approximateLocation]').isChecked()));
  await privacy.locator('[data-local-only]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});
  const saved=await page.evaluate(async()=>await(await fetch('/api/access')).json());assert(saved.configured&&Object.values(saved.choices).every(value=>value===false));
  evidence.privacyAccess={requiredCheckedDisabled:3,optionalPreselected:5,clock:false,ipPlace:false,cloudSwitches:1,explicitDenyAllSaved:true};
 }
 const setup=await page.evaluate(async()=>{
  const [state,capabilities]=await Promise.all([fetch('/api/models/onboarding'),fetch('/api/desktop/capabilities')]);
  if(!state.ok||!capabilities.ok)throw Error('Desktop onboarding state is unavailable.');
  return {onboarding:await state.json(),capabilities:await capabilities.json()};
 });
 await page.locator('#model-onboarding').waitFor({state:'attached'});
 if(setup.capabilities.alpha&&!setup.onboarding.done){await page.locator('#model-onboarding[open]').waitFor();await page.locator('#model-onboarding [data-finish]').click();await page.locator('#model-onboarding').waitFor({state:'hidden'});}
 else assert.equal(await page.locator('#model-onboarding').evaluate(dialog=>dialog.open),false,'Smoke and completed profiles must not automatically open local-AI onboarding');

 const bounds=await application.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setSize(880,640);return window.getBounds();});
 evidence.measurements.windowBounds=bounds;
 const startupMs=performance.now()-started;
 const owner=await application.evaluate(({app,BrowserWindow})=>({pid:process.pid,data:app.getPath('userData'),sandbox:app.isReady()&&BrowserWindow.getAllWindows().every(w=>{const p=w.webContents.getLastWebPreferences();return p.sandbox&&p.contextIsolation&&!p.nodeIntegration&&p.webSecurity;})}));
 assert.equal(owner.data,data);assert(owner.sandbox);
 const rows=await observeOwnedRows(owner.pid),supervisor=rows.find(r=>r.parent===owner.pid&&r.executable?.toLowerCase()===join(backendRoot,'node/bin/node.exe').toLowerCase());
 const guard=rows.find(r=>r.parent===supervisor?.pid&&r.executable?.toLowerCase().endsWith('bambi-job.exe'));
 const backend=rows.find(r=>r.parent===guard?.pid&&r.executable?.toLowerCase()===join(backendRoot,'node/bin/node.exe').toLowerCase());
 assert(supervisor&&guard&&backend,'Owned native job/supervisor/backend tree is missing');
 assert.equal(backend.executable.toLowerCase(),join(backendRoot,'node/bin/node.exe').toLowerCase());
 return {application,page,owner,supervisor,guard,backend,rows,startupMs};
}
let current,canary,conflict,secondNative,nativeFirst;
try{
 await startObserver();
 if(process.env.BAMBI_WINDOWS_OBSERVER)evidence.processObservation={sha256:await hashFile(process.env.BAMBI_WINDOWS_OBSERVER),method:'Separate read-only qualification observer: Toolhelp parent tree, queried only for specified owned/canary PIDs and descendants. App Job Object and shipped helper unchanged.'};
 const runtime=JSON.parse(readFileSync(join(resources,'notices/RUNTIME-MANIFEST.json'),'utf8'));
 assert.equal(runtime.platform,'win32');assert.equal(runtime.architecture,'x64');assertNativeTree(backendRoot);
 const shell=join(output,'Shell inspection'),source=join(output,'Source inspection');mkdirSync(source);
 createRequire(import.meta.url)('@electron/asar').extractAll(join(resources,'app.asar'),shell);
 execFileSync(join(process.env.SystemRoot,'System32/tar.exe'),['-xzf',join(backendRoot,'dist/web/corresponding-source.tar.gz'),'-C',source]);
 const sourceManifest=JSON.parse(readFileSync(join(source,'SOURCE-MANIFEST.json'),'utf8'));
 assert.equal(digest(JSON.stringify(sourceManifest.files)),sourceManifest.sourceDigest);assert.equal(runtime.sourceDigest,sourceManifest.sourceDigest);
 for(const entry of sourceManifest.files)assert.equal(await hashFile(join(source,entry.path)),entry.sha256,'Source mismatch '+entry.path);
 for(const entry of runtime.files)assert.equal(await hashFile(join(backendRoot,entry.path)),entry.sha256,'Runtime mismatch '+entry.path);
 for(const [name,key] of [['main.cjs','mainSha256'],['preload.cjs','preloadSha256'],['runtime-environment.cjs','runtimeEnvironmentSha256']]){
  assert.equal(await hashFile(join(shell,name)),runtime.shell[key]);assert.equal(await hashFile(join(source,'apps/desktop',name)),runtime.shell[key]);
 }
 if(runtime.shell.permissionPolicySha256){assert.equal(await hashFile(join(shell,'permission-policy.cjs')),runtime.shell.permissionPolicySha256);assert.equal(await hashFile(join(source,'apps/desktop/permission-policy.cjs')),runtime.shell.permissionPolicySha256);}
 for(const folder of [source,shell,resources])for(const entry of await inventory(folder)){
  assert(!/(?:^|\/)(?:\.env(?:\.|$)|\.git|\.runtime|internal|models|recordings|imported-sounds)(?:\/|$)|\.(?:sqlite|key|pem|p12|pfx)$/.test(logicalPath(entry.path)),'Excluded private/local path in artifact '+entry.path);
 }
 record('finished-package-matching-source-and-native-PE-audit',{sourceDigest:runtime.sourceDigest,scope:'Per-file hashes, native x64 PE headers and excluded paths; not a semantic secret scan.'});
 const before=await inventory(resources);
 canary=spawn(join(backendRoot,'node/bin/node.exe'),['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
 // Verify a normal launch and duplicate start without Playwright or debug flags.
 const nativeData=join(output,'Ordinary native profile ü');
 nativeFirst=spawn(executable,[`--bambi-user-data=${nativeData}`,'--bambi-port=16970'],{cwd:output,env:environment,stdio:'ignore'});
 const nativeDeadline=performance.now()+30000;let nativeRows=[],nativeBackend,nativeHealth;
 while(performance.now()<nativeDeadline){
  if(nativeFirst.exitCode!==null)throw Error('Ordinary native launch exited '+nativeFirst.exitCode);
  nativeRows=await observeOwnedRows(nativeFirst.pid);
  const supervisor=nativeRows.find(row=>row.parent===nativeFirst.pid&&row.executable?.toLowerCase()===join(backendRoot,'node/bin/node.exe').toLowerCase());
  const guard=nativeRows.find(row=>row.parent===supervisor?.pid&&row.executable?.toLowerCase().endsWith('bambi-job.exe'));
  nativeBackend=nativeRows.find(row=>row.parent===guard?.pid&&row.executable?.toLowerCase()===join(backendRoot,'node/bin/node.exe').toLowerCase());
  if(nativeBackend){try{nativeHealth=await(await fetch('http://127.0.0.1:16970/api/health',{signal:AbortSignal.timeout(500)})).json();if(nativeHealth.database&&(nativeHealth.desktopSmoke||nativeHealth.desktopAlpha))break;}catch{}}
  const windows=await observeRows([nativeFirst.pid],true);
  if(windows.some(window=>window.title==='Error')){evidence.nativeLaunchFailure={processes:nativeRows.map(({command,...row})=>row),windows};throw Error('Ordinary native launch displayed an error dialog');}
  await delay(250);
 }
 assert(nativeBackend&&nativeHealth?.database,'Ordinary native launch did not become healthy');
 record('ordinary-native-launch-without-debugger',{backendPid:nativeBackend.pid,windows:await observeRows([nativeFirst.pid],true)});
 // The second instance intentionally exits before Electron's ready event.
 // Launch it as an ordinary native process, without a debugger handshake.
 secondNative=spawn(executable,[`--bambi-user-data=${nativeData}`,'--bambi-port=16970'],{cwd:output,env:environment,stdio:['ignore','pipe','pipe']});
 const secondRoots=[secondNative.pid,nativeFirst.pid];
 evidence.secondStart={pid:secondNative.pid,observations:[]};
 let secondDiagnostics='';for(const stream of [secondNative.stdout,secondNative.stderr])stream.on('data',bytes=>{secondDiagnostics=(secondDiagnostics+bytes).slice(-12000);evidence.secondStart.publicFixtureDiagnostics=secondDiagnostics;});
 const inspectSecond=setTimeout(async()=>{
  try{evidence.secondStart.observations.push({at:new Date().toISOString(),processes:await observeRows([secondNative.pid]),windows:await observeRows([secondNative.pid],true)});}
  catch(error){evidence.secondStart.observationFailure=String(error);}
 },5000);
 const secondStarted=performance.now();
 await new Promise((accept,reject)=>{
  const timer=setTimeout(async()=>{
   try{if(process.env.BAMBI_WINDOWS_OBSERVER){
    evidence.secondStart.observations.push({at:new Date().toISOString(),processes:(await observeRows(secondRoots)).map(({command,...row})=>row),windows:await observeRows(secondRoots,true)});
   }}catch(error){evidence.secondStart.observationFailure=String(error);}
   reject(Error('Second instance did not exit within 30 seconds'));
  },30000);
  secondNative.once('error',error=>{clearTimeout(timer);clearTimeout(inspectSecond);reject(error);});
  secondNative.once('exit',(code,signal)=>{clearTimeout(timer);clearTimeout(inspectSecond);if(code===0&&!signal)accept();else reject(Error('Second instance exit '+JSON.stringify({code,signal})));});
 });
 assert((await observeRows([nativeBackend.pid])).some(r=>r.pid===nativeBackend.pid&&r.created===nativeBackend.created));record('second-start-keeps-original-owner',{secondExitCode:secondNative.exitCode,secondExitMs:performance.now()-secondStarted,method:'Ordinary native spawn without Playwright/debug flags; 30-second hosted-runner bound.'});
 nativeFirst.kill('SIGKILL');await stopped(nativeRows);record('ordinary-native-owner-death-cleans-owned-tree');
 current=await launch();evidence.measurements.startupMs=current.startupMs;
 record('isolated-native-launch-with-empty-PATH',{startupMs:current.startupMs,bundledNode:current.backend.executable,rendererSandbox:true});
 const health=await current.page.evaluate(async()=>await(await fetch('/api/health')).json());assert(health.database);
 if(runtime.phase==='smoke'){assert(health.desktopSmoke);assert(!health.ollama&&!health.kokoro&&!health.streamingSpeech);}
 else {assert(health.desktopAlpha);assert(!health.kokoro&&!health.llamaModels.length);}
 record('sqlite-and-explicit-capabilities',{health});
 for(const path of [data,join(data,'data/bambi.sqlite')]){
  const acl=await observeAcl(path);if(path===data)assert(acl.protected);
  assert(acl.rules.length);assert(acl.rules.every(rule=>rule.type==='Allow'&&[acl.user,'S-1-5-18','S-1-5-32-544'].includes(rule.sid)),'Unexpected access to private profile');
 }
 record('private-Windows-profile-ACLs');
 await current.page.addInitScript(()=>{
  const original=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){
   if(destination===this.context.destination&&!window.__testAnalyser){const analyser=this.context.createAnalyser(),silent=this.context.createGain();silent.gain.value=0;original.call(this,analyser);original.call(analyser,silent);original.call(silent,destination);window.__testAnalyser=analyser;}return original.call(this,destination,...args);
  };
 });
 await current.page.reload();await current.page.locator('#offline-sample').click();await current.page.locator('#pause').click();
 await current.page.waitForFunction(()=>document.querySelector('#media').currentTime>.4&&!document.querySelector('#media').paused);
 const pcm=()=>current.page.evaluate(()=>{const a=window.__testAnalyser;if(!a)return 0;const values=new Float32Array(a.fftSize);a.getFloatTimeDomainData(values);return Math.max(...values.map(Math.abs));});
 async function audible(){for(let i=0;i<25;i++){const peak=await pcm();if(peak>.0001)return peak;await delay(100);}assert.fail('No nonzero output PCM');}
 record('included-sample-has-nonzero-output-PCM',{peak:await audible()});
 await current.page.locator('#pause').click();const position=await current.page.locator('#media').evaluate(n=>n.currentTime);await delay(500);assert.equal(await current.page.locator('#media').evaluate(n=>n.currentTime),position);
 await current.page.locator('#pause').click();await current.page.waitForFunction(p=>document.querySelector('#media').currentTime>p+.2,position);record('pause-and-resume');
 // Keep time-sensitive assertions in the renderer: hosted-runner IPC can take
 // seconds per call and otherwise exhaust the real 24-second sample.
 const muteCheck=await current.page.evaluate(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),media=document.querySelector('#media'),mute=document.querySelector('#mute');
  const state=()=>({time:media.currentTime,duration:media.duration,paused:media.paused,ended:media.ended,context:window.__testAnalyser?.context.state,muted:mute.dataset.muted});
  const peak=()=>{const a=window.__testAnalyser;if(!a)return 0;const values=new Float32Array(a.fftSize);a.getFloatTimeDomainData(values);return Math.max(...values.map(Math.abs));};
  const wait=async(predicate,label)=>{const deadline=performance.now()+8000;while(performance.now()<deadline){if(predicate())return;await sleep(100);}throw Error(label+' '+JSON.stringify(state()));};
  await document.querySelector('#offline-sample').onclick();document.querySelector('#pause').click();
  await wait(()=>!media.paused&&!media.ended&&media.currentTime>.4&&peak()>.0001,'Fresh sample has no output');
  const before={...state(),peak:peak()},muteStarted=performance.now();mute.click();
  // MASTER uses the existing 40 ms exponential setTargetAtTime fade. Float
  // PCM need not become bit-exact zero; wait for a measured -140 dBFS floor.
  await wait(()=>peak()<=1e-7,'Mute did not settle below the output floor');
  const muted={...state(),peak:peak(),settleMs:performance.now()-muteStarted};
  if(muted.paused||muted.ended||muted.muted!=='true'||muted.peak>1e-7)throw Error('Mute assertion '+JSON.stringify(muted));
  mute.click();await wait(()=>!media.paused&&!media.ended&&mute.dataset.muted==='false'&&peak()>.0001,'Unmute has no output');
  return {before,muted,unmuted:{...state(),peak:peak()},mutePeakLimit:1e-7,method:'Fresh included sample; real button handlers invoked in the renderer to avoid hosted-runner IPC delays. Existing exponential mute fade must settle to peak <= 1e-7 (-140 dBFS) while playback continues; zero float PCM is not assumed. No direct media, gain or audio-context manipulation.'};
 });
 record('audio-mute-and-unmute',muteCheck);
 await current.page.keyboard.press('Escape');await current.page.keyboard.press('Escape');await current.page.waitForFunction(()=>document.querySelector('#media').paused&&window.__testAnalyser.context.state==='suspended');record('end-session-stops-output');
 if(runtime.phase==='alpha'){
  const sample=readFileSync(join(backendRoot,'dist/web/samples/studio-chimes.bambi.json'));
  const originalPack=JSON.parse(sample);
  await current.page.goto('http://127.0.0.1:16969/studio');
  await current.page.locator('#import').setInputFiles({name:'studio-chimes.bambi.json',mimeType:'application/json',buffer:sample});
  await current.page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Package opened. Preview when you are ready.');
  await current.page.locator('#preview').click();
  await current.page.waitForFunction(()=>{const a=window.__testAnalyser;if(!a)return false;const v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return Math.max(...v.map(Math.abs))>.0001&&document.querySelector('#preview-scene').textContent==='Soft Pink';});
  const studioPeak=await pcm();await current.page.locator('#stop').click();
  await current.page.waitForFunction(()=>document.querySelector('#caption').textContent==='Preview stopped.');
  record('prepared-Studio-import-and-real-PCM-preview-without-AI',{peak:studioPeak,scene:'Soft Pink'});
  const exportedPath=join(output,'Studio exported ü.bambi.json');
  // Electron owns downloads through its native session, outside Playwright's
  // browser-context download routing. Choose only the disposable save path;
  // the actual Studio button must still produce a completed native download.
  await current.application.evaluate(({session},destination)=>{
   globalThis.__studioDownload={state:'waiting'};
   session.defaultSession.once('will-download',(_event,item)=>{
    globalThis.__studioDownload={state:'progressing',filename:item.getFilename()};
    item.setSavePath(destination);
    item.once('done',(_event,state)=>{globalThis.__studioDownload.state=state;});
   });
  },exportedPath);
  await current.page.locator('#export').click();
  const exportDeadline=performance.now()+30000;let nativeDownload;
  while(performance.now()<exportDeadline){
   nativeDownload=await current.application.evaluate(()=>globalThis.__studioDownload);
   if(nativeDownload.state==='completed')break;
   if(['cancelled','interrupted'].includes(nativeDownload.state))throw Error('Native Studio download '+nativeDownload.state);
   await delay(100);
  }
  evidence.studioExport={download:nativeDownload,status:await current.page.locator('#status').textContent(),method:'Actual Studio Export button and Electron session will-download; only the disposable save path is selected by the checker.'};
  assert.equal(nativeDownload?.state,'completed','Studio export did not complete: '+JSON.stringify(evidence.studioExport));
  const exported=readFileSync(exportedPath),exportedPack=JSON.parse(exported);
  assert.deepEqual(exportedPack.assets,originalPack.assets);assert.deepEqual(exportedPack.cues,originalPack.cues);
  await current.page.locator('#import').setInputFiles({name:'reopened.bambi.json',mimeType:'application/json',buffer:exported});
  await current.page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Package opened. Preview when you are ready.');
  record('prepared-Studio-export-and-reimport-preserve-audio-and-cues',{assets:exportedPack.assets.length,cues:exportedPack.cues.length,exportSha256:digest(exported)});
  const consent=await current.page.evaluate(async()=>{
   const record=await(await fetch('/api/access')).json();const response=await fetch('/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record.choices,modelDownloads:true})});return response.ok;
  });assert(consent,'The public-fixture checker must explicitly grant model downloads.');
  await current.page.goto('http://127.0.0.1:16969/setup');
  await current.page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='not-installed');
  await current.page.getByRole('button',{name:'3. Install and start',exact:true}).click();
  const expectedModel=JSON.parse(readFileSync(join(root,'config/desktop-alpha-models.json'),'utf8')).alias;
  const setupChecks=await current.page.evaluate(async expectedModel=>{
   const sleep=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];
   for(const attempt of [1,2]){
    const initial=await(await fetch('/api/desktop/setup')).json();if(initial.model!==expectedModel)throw Error('Qualification must retain the unchanged full chat model.');
    const start=performance.now(),guarded=document.querySelector('#setup-install').disabled;let observed;
    if(guarded){
     const catalog=await(await fetch('/api/models/catalog')).json(),model=catalog.alternatives.find(row=>row.id===expectedModel);
     if(!model||model.memoryFit==='fits')throw Error('Unexpected disabled setup download on a compatible host.');
     const response=await fetch('/api/desktop/setup/install',{method:'POST'});if(!response.ok)throw Error('Explicit public-fixture download was rejected.');
    }else document.querySelector('#setup-install').click();
    while(performance.now()-start<30000){
     const state=await(await fetch('/api/desktop/setup')).json();
     if(state.phase==='failed')throw Error('Actual pinned setup download failed: '+state.error);
     if(state.model!==expectedModel)throw Error('Setup changed the full qualification model.');
     if(state.completed>0&&!document.querySelector('#setup-cancel').disabled){observed={phase:state.phase,completed:state.completed,asset:state.asset,progressVisible:document.querySelector('#setup-progress').textContent};break;}
     await sleep(100);
    }
    if(!observed)throw Error('Actual setup download did not expose cancellable progress.');
    document.querySelector('#setup-cancel').click();let cancelled;
    for(let i=0;i<100;i++){const state=await(await fetch('/api/desktop/setup')).json();if(state.phase==='cancelled'){cancelled=state;break;}await sleep(100);}
    if(!cancelled||cancelled.verified)throw Error('Cancellation activated incomplete model data.');
    checks.push({attempt,model:expectedModel,observed,cancelledPhase:cancelled.phase,elapsedMs:performance.now()-start,startMethod:guarded?'Explicit backend API; hosted runner memory estimate prevents UI installation.':'Actual Setup download button.'});
    if(guarded)continue;
    const retryDeadline=performance.now()+10000;
    while(document.querySelector('#setup-install').disabled&&performance.now()<retryDeadline)await sleep(100);
    if(document.querySelector('#setup-install').disabled)throw Error('Retry did not become available after cancellation.');
   }
   return checks;
  },expectedModel);
  assert(!files(join(data,'models')).some(path=>path.endsWith('.partial')));
  record('actual-pinned-Setup-download-progress-cancel-and-retry',{attempts:setupChecks,fullModelActivated:false});
  await current.page.goto('http://127.0.0.1:16969/');
  await current.page.waitForSelector('#offline-sample');
  const afterCancel=await current.page.evaluate(async()=>{
   await document.querySelector('#offline-sample').onclick();document.querySelector('#pause').click();
   const end=performance.now()+8000;while(performance.now()<end){const a=window.__testAnalyser;if(a){const v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);const peak=Math.max(...v.map(Math.abs));if(peak>.0001)return peak;}await new Promise(r=>setTimeout(r,100));}throw Error('Sample failed after canceled model setup.');
  });
  const setup=await current.page.evaluate(async()=>await(await fetch('/api/desktop/setup')).json());assert.equal(setup.verified,false);
  record('sample-remains-usable-after-cancelled-and-retried-Setup',{peak:afterCancel});
  await current.page.keyboard.press('Escape');await current.page.keyboard.press('Escape');
  current.rows=await observeOwnedRows(current.owner.pid);
 }
 await current.page.evaluate(async()=>{const profile=await(await fetch('/api/preferences')).json();await fetch('/api/preferences',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...profile,'bambi-name':'Windows persistence ü'})});});
 await current.application.evaluate(({app})=>{setImmediate(()=>app.quit());});await stopped(current.rows);await current.application.close().catch(()=>{});record('ordinary-Quit-cleans-owned-tree');
 current=await launch();assert.equal(await current.page.evaluate(async()=>(await(await fetch('/api/preferences')).json())['bambi-name']),'Windows persistence ü');record('reopen-retains-preferences');
 const electronOwner=current.rows.find(row=>row.pid===current.owner.pid);
 assert(electronOwner?.created&&electronOwner.executable.toLowerCase()===executable.toLowerCase());
 await killOwned(electronOwner);await stopped(current.rows);await current.application.close().catch(()=>{});record('forced-Electron-death-cleans-owned-tree',{killedPid:electronOwner.pid,method:'Verified native Electron PID, creation time and executable; Playwright Windows shell PID is not the app owner.'});
 for(const target of ['backend','supervisor','guard']){
  current=await launch();await current.application.evaluate(({dialog})=>{dialog.showErrorBox=()=>{};});await killOwned(current[target]);await stopped(current.rows);await current.application.close().catch(()=>{});record('forced-'+target+'-death-cleans-owned-tree');
 }
 current=await launch();await current.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await stopped(current.rows);await current.application.close().catch(()=>{});current=null;record('window-close-quits');
 conflict=createServer((_req,res)=>res.end('unrelated listener'));await new Promise((accept,reject)=>conflict.once('error',reject).listen(16969,'127.0.0.1',accept));
 const blocked=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,'--bambi-port=16969'],cwd:output,env:environment,timeout:15000});
 applications.set(blocked,blocked.process());
 await blocked.evaluate(({dialog})=>{dialog.showErrorBox=()=>{};}).catch(()=>{});
 await Promise.race([new Promise(r=>applications.get(blocked).once('exit',r)),delay(15000)]);
 await blocked.close().catch(()=>{});assert.equal(await(await fetch('http://127.0.0.1:16969')).text(),'unrelated listener');record('port-conflict-preserves-unrelated-listener');
 await new Promise(r=>conflict.close(r));conflict=null;
 assert(canary.exitCode===null&&(await observeRows([canary.pid])).some(r=>r.pid===canary.pid));record('unrelated-native-canary-survives-all-shutdowns');
 assert.deepEqual(await inventory(resources),before);record('immutable-resources-unchanged');
 evidence.result='passed';
 evidence.limitations=['This tests the unpacked/installed binary on the recorded native Windows host. Actual browser download, NSIS install/uninstall and security policy are separate tests.','PCM is application output, not physical listening. No physical microphone test.','AI, setup, GPU offloading, CPU fallback, offline network isolation and suspended-process injection need separate qualification.'];
}catch(error){evidence.result='failed';evidence.failure=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{
 for(const [application,child] of applications){
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  await Promise.race([application.close().catch(()=>{}),delay(2000)]);
 }
 if(canary&&canary.exitCode===null)canary.kill();
 if(secondNative&&secondNative.exitCode===null&&secondNative.signalCode===null)secondNative.kill('SIGKILL');
 if(nativeFirst&&nativeFirst.exitCode===null&&nativeFirst.signalCode===null)nativeFirst.kill('SIGKILL');
 if(conflict?.listening)await new Promise(r=>conflict.close(r));
 await stopObserver();
 writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Evidence:',join(output,'evidence.json'));
}
