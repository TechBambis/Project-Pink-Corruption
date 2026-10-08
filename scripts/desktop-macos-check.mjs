// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import { _electron as electron } from 'playwright';
import {processRows,running,ownedProcessIds,appPaths,assertMachArm64} from './desktop-macos-support.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Use a native Apple Silicon host.');
const executable=realpathSync(resolve(process.argv[2]));
const {resources,bundle}=appPaths(executable);
assert(!executable.startsWith(root),'Extract/copy the received artifact outside the repository before testing');
const outputRoot=resolve(process.env.BAMBI_SMOKE_OUTPUT||join(process.env.HOME,'.local/share/bambi-macos-tests'));mkdirSync(outputRoot,{recursive:true});
const output=mkdtempSync(join(outputRoot,'macOS ü smoke ')),data=join(output,'User data ä'),emptyPath=join(output,'empty-path');mkdirSync(emptyPath);
const environment={...process.env,PATH:emptyPath,NODE_OPTIONS:'--trace-warnings',BAMBI_CLOUD_API_KEY:'smoke-sentinel-must-not-be-inherited'};
delete environment.ELECTRON_RUN_AS_NODE;
// Playwright strips NODE_OPTIONS itself. Keep it absent for ordinary starts
// too; inherited loader filtering is verified separately by portable tests.
delete environment.NODE_OPTIONS;
const evidence={testedAt:new Date().toISOString(),executable,output,data,launchPath:emptyPath,checks:[],errors:[],environment:{kernel:execFileSync('/usr/bin/uname',['-smr'],{encoding:'utf8'}).trim(),os:execFileSync('/usr/bin/sw_vers',[],{encoding:'utf8'}).trim(),ci:process.env.GITHUB_ACTIONS==='true'}};
const record=(name,detail={})=>{evidence.checks.push({name,...detail});console.log('PASS',name);writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');};
const delay=ms=>new Promise(accept=>setTimeout(accept,ms));
const alive=running;
const applications=new Set();
async function launchApp(options){const application=await electron.launch(options);applications.add(application);return application;}
async function closeApp(application){
 if(!application)return;
 const child=application.process();let timer;
 try{await Promise.race([application.close().catch(()=>{}),new Promise(done=>{timer=setTimeout(done,4000);})]);}
 finally{clearTimeout(timer);if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');applications.delete(application);}
}

async function stopped(pids){for(let i=0;i<60;i++){if(pids.every(pid=>!alive(pid)))return;await delay(100);}assert.fail('Owned processes survived shutdown: '+pids.filter(alive));}
async function launch(port=16969){
 const launchStart=performance.now();const application=await launchApp({executablePath:executable,args:[`--bambi-user-data=${data}`,`--bambi-port=${port}`],cwd:output,env:environment,timeout:30000});
 const page=await application.firstWindow();page.on('pageerror',error=>evidence.errors.push(String(error)));
 await page.waitForSelector('#offline-sample',{state:'visible',timeout:30000});

 const privacyAccess=await page.evaluate(async()=>{const response=await fetch('/api/access');return response.ok?response.json():{configured:true};});
 if(!privacyAccess.configured){await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [data-local-only]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});}
 const setup=await page.evaluate(async()=>{
  const [state,capabilities]=await Promise.all([fetch('/api/models/onboarding'),fetch('/api/desktop/capabilities')]);
  if(!state.ok||!capabilities.ok)throw Error('Desktop onboarding state is unavailable.');
  return {onboarding:await state.json(),capabilities:await capabilities.json()};
 });
 await page.locator('#model-onboarding').waitFor({state:'attached'});
 if(setup.capabilities.alpha&&!setup.onboarding.done){await page.locator('#model-onboarding[open]').waitFor();await page.locator('#model-onboarding [data-finish]').click();await page.locator('#model-onboarding').waitFor({state:'hidden'});}
 else assert.equal(await page.locator('#model-onboarding').evaluate(dialog=>dialog.open),false,'Smoke and completed profiles must not automatically open local-AI onboarding');
 const ownership=await application.evaluate(({app,BrowserWindow})=>({pid:process.pid,rendererPid:BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId(),data:app.getPath('userData'),windows:BrowserWindow.getAllWindows().map(window=>window.webContents.getLastWebPreferences())}));
 const pids=processRows();
 const supervisor=pids.find(row=>row.parent===ownership.pid&&row.command.includes('supervisor.mjs'));assert(supervisor,'Owned supervisor missing');
 const backend=pids.find(row=>row.parent===supervisor.pid&&row.command.includes('apps/server/index.ts'));assert(backend,'Owned backend missing');
 const backendEnv=execFileSync('/bin/ps',['eww','-p',String(backend.pid),'-o','command='],{encoding:'utf8'});
 assert(!backendEnv.includes('smoke-sentinel-must-not-be-inherited')&&!backendEnv.includes('NODE_OPTIONS=--trace-warnings'),'Inherited provider or loader configuration');
 assert(backend.command.startsWith(join(resources,'backend/node/bin/node')),'Backend must use the bundled Node');
 const renderer=pids.find(row=>row.pid===ownership.rendererPid);assert(renderer&&!renderer.command.includes('--no-sandbox'));
 assert.equal(ownership.data,data);assert(ownership.windows.every(p=>p.sandbox&&p.contextIsolation&&!p.nodeIntegration&&p.webSecurity));
 return {application,page,ownership,supervisor,backend,startupMs:performance.now()-launchStart,pids:ownedProcessIds(pids,ownership.pid)};
}
let current,conflict,blocked,blockedPid;
// A wedged automation connection must still leave a failed report and release
// the Electron lease. Keep a separate bound from the workflow's billing cap.
const watchdog=setTimeout(()=>{
 evidence.result='failed';evidence.failure??='Received-app acceptance exceeded its six-minute deadline.';
 writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
 console.error(evidence.failure);
 for(const application of applications){const child=application.process();if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 // The supervisor gets the closed Electron IPC lease and cleans its group.
 setTimeout(()=>process.exit(1),10000);
},6*60*1000);
try{
 // Inspect the extracted finished package, including app.asar and source archive.
 const require=createRequire(import.meta.url),asar=require('@electron/asar');const extracted=join(output,'shell-inspection');asar.extractAll(join(resources,'app.asar'),extracted);
 const source=join(output,'source-inspection');mkdirSync(source);execFileSync('/usr/bin/tar',['-xzf',join(resources,'backend/dist/web/corresponding-source.tar.gz'),'-C',source]);
 const walk=folder=>readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const path=join(folder,entry.name);if(entry.isSymbolicLink()){const target=realpathSync(path);assert(target.startsWith(bundle+'/')||target.startsWith(source+'/')||target.startsWith(extracted+'/'),'Artifact symlink escapes reviewed tree: '+path);if(lstatSync(target).isDirectory())return [];}return entry.isDirectory()?walk(path):[path];});
 const sourceManifest=JSON.parse(readFileSync(join(source,'SOURCE-MANIFEST.json'),'utf8'));const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(JSON.stringify(sourceManifest.files)),sourceManifest.sourceDigest);
 for(const file of sourceManifest.files)assert.equal(hash(readFileSync(join(source,file.path))),file.sha256,'Source snapshot mismatch: '+file.path);
 const runtime=JSON.parse(readFileSync(join(resources,'notices/RUNTIME-MANIFEST.json'),'utf8'));assert.equal(runtime.sourceDigest,sourceManifest.sourceDigest);assert.equal(hash(readFileSync(join(extracted,'main.cjs'))),runtime.shell.mainSha256);assert.equal(hash(readFileSync(join(source,'apps/desktop/main.cjs'))),runtime.shell.mainSha256);assert.equal(JSON.parse(readFileSync(join(extracted,'package.json'),'utf8')).version,runtime.version);
 if(runtime.shell.permissionPolicySha256){assert.equal(hash(readFileSync(join(extracted,'permission-policy.cjs'))),runtime.shell.permissionPolicySha256);assert.equal(hash(readFileSync(join(source,'apps/desktop/permission-policy.cjs'))),runtime.shell.permissionPolicySha256);}
 assertMachArm64(executable);assertMachArm64(join(resources,'backend/node/bin/node'));
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
 for(const file of runtime.files)assert.equal(hash(readFileSync(join(resources,'backend',file.path))),file.sha256,'Runtime inventory mismatch: '+file.path);
 const inputs=[...walk(bundle),...walk(source),...walk(extracted)];
 const secrets=existsSync(join(root,'.env.cloud'))?readFileSync(join(root,'.env.cloud'),'utf8').split('\n').flatMap(line=>{const match=line.match(/^[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=(.*)$/);const value=match?.[1]?.trim().replace(/^['"]|['"]$/g,'');return value&&value.length>=12?[Buffer.from(value)]:[];}):[];
 for(const path of inputs){assert(!/(?:^|\/)(?:\.env(?:\.|$)|\.git|\.runtime|internal|vendor|imported-sounds|recordings)(?:\/|$)|\.(?:sqlite|key|pem|p12|pfx|gguf)$/.test(relative(bundle,path)),'Excluded material in finished artifact '+path);const bytes=readFileSync(path);assert(!secrets.some(secret=>bytes.includes(secret)),'Private credential found (value withheld)');}
 record('finished-artifact-and-matching-source-audit',{files:inputs.length,sourceDigest:runtime.sourceDigest,privateCredentialValuesChecked:secrets.length,scope:'Allowlisted paths, every runtime/source SHA-256, actual local credential values; not an exhaustive semantic secret detector'});
 current=await launch();const {application,page,backend}=current;record('isolated-packaged-launch',{startupMs:current.startupMs,backendPid:backend.pid,nodeExecutable:join(resources,'backend/node/bin/node'),rendererSandbox:true,chromiumSandboxSwitchAbsent:true});
 const health=await page.evaluate(async()=>await(await fetch('/api/health')).json());assert(health.database&&health.desktopSmoke);assert(!health.ollama&&!health.kokoro&&!health.whisper&&!health.streamingSpeech);record('bundled-node-sqlite-and-explicit-capabilities',{health});
 const api=`http://127.0.0.1:16969`;
 assert.equal((await fetch(api+'/api/preferences',{headers:{origin:'https://example.com'}})).status,403);
 assert.equal((await fetch(api+'/api/desktop/identity')).status,403);
 assert.equal((await fetch(api+'/api/warm',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,503);
 assert.equal(await page.evaluate(()=>typeof window.require),'undefined');record('local-boundary-and-unavailable-service-gates');
 await page.evaluate(()=>{
  const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){
   if(destination===this.context.destination&&!window.__smokeAnalyser){
    const analyser=this.context.createAnalyser(),gain=this.context.createGain();analyser.fftSize=2048;gain.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,gain);connect.call(gain,destination);window.__smokeAnalyser=analyser;
   }return connect.call(this,destination,...args);
  };
 });
 await page.locator('#offline-sample').click();await page.waitForFunction(()=>Number.isFinite(document.querySelector('#media').duration));
 await page.locator('#stage').hover();await page.locator('#pause').click();await page.waitForFunction(()=>document.querySelector('#media').currentTime>.4&&!document.querySelector('#media').paused);
 const pcm=()=>page.evaluate(()=>{const analyser=window.__smokeAnalyser;if(!analyser)return 0;const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);return Math.max(...values.map(Math.abs));});
 async function audible(){let peak=0;for(let i=0;i<20;i++){peak=Math.max(peak,await pcm());if(peak>.0001)return peak;await delay(100);}assert.fail('No nonzero PCM at app output');}
 const peak=await audible();record('offline-sample-playing-with-nonzero-output-pcm',{peak,durationSeconds:await page.locator('#media').evaluate(node=>node.duration)});

 await page.locator('#stage').hover();await page.locator('#pause').click();const position=await page.locator('#media').evaluate(node=>node.currentTime);await delay(700);assert(await page.locator('#media').evaluate(node=>node.paused));assert(Math.abs(await page.locator('#media').evaluate(node=>node.currentTime)-position)<.15);record('pause-freezes-playback');
 await page.locator('#stage').hover();await page.locator('#pause').click();await page.waitForFunction(previous=>document.querySelector('#media').currentTime>previous+.3,position);record('resume-advances-playback');
 await page.locator('#seek').evaluate(node=>{node.value='12';node.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#media').currentTime>=11.9);record('seek-updates-media');
 await page.locator('#stage').hover();await page.locator('#mute').click();await delay(500);assert(await pcm()<=1e-7);await page.locator('#stage').hover();await page.locator('#mute').click();await audible();record('audio-mute-silences-pcm-and-unmute-restores-it');
 await page.locator('#master').evaluate(node=>{node.value='0';node.dispatchEvent(new Event('input',{bubbles:true}));});await delay(500);assert(await pcm()<=1e-7);await page.locator('#master').evaluate(node=>{node.value='0.7';node.dispatchEvent(new Event('input',{bubbles:true}));});await audible();record('master-volume-controls-output');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#media').paused);await page.waitForFunction(()=>window.__smokeAnalyser.context.state==='suspended');const stoppedAt=await page.locator('#media').evaluate(node=>node.currentTime);await delay(700);assert.equal(await page.locator('#media').evaluate(node=>node.currentTime),stoppedAt);record('end-session-stops-playback-and-output',{audioContext:'suspended',transportPosition:stoppedAt});
 assert(existsSync(join(data,'data/bambi.sqlite')));assert.equal(lstatSync(join(data,'data/bambi.sqlite')).mode&0o077,0);
 await page.context().addInitScript(()=>{
  const connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){
   if(destination===this.context.destination&&!window.__smokeAnalyser){const analyser=this.context.createAnalyser(),gain=this.context.createGain();analyser.fftSize=2048;gain.gain.value=0;connect.call(this,analyser);connect.call(analyser,gain);connect.call(gain,destination);window.__smokeAnalyser=analyser;}return connect.call(this,destination,...args);
  };
 });
  const sample=readFileSync(join(join(resources,'backend'),'dist/web/samples/studio-chimes.bambi.json'));
  const originalPack=JSON.parse(sample);
  await current.page.goto('http://127.0.0.1:16969/studio');
  await current.page.locator('#import').setInputFiles({name:'studio-chimes.bambi.json',mimeType:'application/json',buffer:sample});
  await current.page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Package opened. Preview when you are ready.');
  await current.page.locator('#preview').click();
  await current.page.waitForFunction(()=>{const a=window.__smokeAnalyser;if(!a)return false;const v=new Float32Array(a.fftSize);a.getFloatTimeDomainData(v);return Math.max(...v.map(Math.abs))>.0001&&document.querySelector('#preview-scene').textContent==='Soft Pink';});
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
  record('prepared-Studio-export-and-reimport-preserve-audio-and-cues',{assets:exportedPack.assets.length,cues:exportedPack.cues.length,exportSha256:hash(exported)});
 await page.goto(api+'/');await page.waitForFunction(()=>window.bambi);
 const before=walk(resources).map(path=>({path,sha:hash(readFileSync(path))}));
 await page.locator('[data-nav=extras]').click();
 await page.locator('#settings-save-status[data-state="saved"]').waitFor({state:'attached'});
 await page.evaluate(()=>{const field=document.getElementById('bambi-name');field.value='Smoke persistence ü';field.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(async()=>(await(await fetch('/api/preferences')).json())['bambi-name']==='Smoke persistence ü');
 const exportedSettings=join(output,'Settings exported ü.bambi-settings.json');
 await application.evaluate(({session},destination)=>{session.defaultSession.once('will-download',(_event,item)=>item.setSavePath(destination));},exportedSettings);
 await page.locator('#settings-export').click();await page.locator('#settings-transfer-dialog').waitFor({state:'visible'});
 await page.locator('#settings-transfer-confirm').click();
 for(let i=0;i<100&&!existsSync(exportedSettings);i++)await delay(100);
 const settingsFile=JSON.parse(readFileSync(exportedSettings,'utf8'));assert.equal(settingsFile.version,1);assert.equal(settingsFile.sections.personal['bambi-name'],'Smoke persistence ü');
 await page.locator('#settings-import-file').setInputFiles(exportedSettings);await page.locator('#settings-transfer-dialog').waitFor({state:'visible'});
 await page.locator('#settings-transfer-confirm').click();await page.locator('#settings-transfer-dialog').waitFor({state:'hidden'});
 await page.locator('#preset-save').click();await page.locator('#settings-file-name').fill('Mac smoke preset');await page.locator('#settings-transfer-confirm').click();await page.locator('#settings-transfer-dialog').waitFor({state:'hidden'});
 await page.waitForFunction(async()=>(await(await fetch('/api/settings/presets')).json()).some(p=>p.name==='Mac smoke preset'));
 record('packaged-settings-save-portable-export-import-and-named-preset');
 await application.evaluate(({app})=>app.quit());await stopped(current.pids);await closeApp(application);record('ordinary-quit-cleans-owned-services');
 current=await launch();assert.equal(await current.page.evaluate(async()=>(await(await fetch('/api/preferences')).json())['bambi-name']),'Smoke persistence ü');record('reopen-retains-preferences');
 const second=await launchApp({executablePath:executable,args:[`--bambi-user-data=${data}`,'--bambi-port=16969'],cwd:output,env:environment,timeout:15000}).catch(()=>null);
 if(second){await delay(500);await closeApp(second);}
 assert(alive(current.backend.pid));assert.equal(await current.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);record('second-launch-preserves-single-owner');
 process.kill(current.ownership.pid,'SIGKILL');await stopped(current.pids);await closeApp(current.application);record('forced-electron-termination-cleans-owned-services');
 current=await launch();await current.application.evaluate(({dialog})=>{dialog.showErrorBox=(title,content)=>console.error('Expected backend failure:',title,content);});process.kill(current.backend.pid,'SIGKILL');await stopped(current.pids);await closeApp(current.application);record('killed-backend-cleans-supervisor');
 current=await launch();process.kill(current.supervisor.pid,'SIGSTOP');process.kill(current.backend.pid,'SIGSTOP');const hungQuit=performance.now();await current.application.evaluate(({app})=>app.quit());await stopped(current.pids);await closeApp(current.application);record('hung-supervisor-quit-is-bounded',{ms:performance.now()-hungQuit});
 current=await launch();await current.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await stopped(current.pids);await closeApp(current.application);record('window-close-quits-and-reopen-after-failure');
 conflict=createServer((_req,res)=>res.end('unrelated service'));await new Promise((accept,reject)=>conflict.once('error',reject).listen(16969,'127.0.0.1',accept));
 blocked=await launchApp({executablePath:executable,args:[`--bambi-user-data=${data}`,'--bambi-port=16969'],cwd:output,env:environment,timeout:15000});
 blockedPid=blocked.process().pid;
 await blocked.evaluate(({app,dialog})=>{global.__smokeOriginalQuit=app.quit.bind(app);app.quit=()=>{};dialog.showErrorBox=(title,content)=>{global.__smokeStartupError={title,content};};});
 let startupError;for(let attempt=0;attempt<150;attempt++){startupError=await blocked.evaluate(()=>global.__smokeStartupError);if(startupError)break;await delay(100);}
 assert(startupError?.content.includes('No unrelated process was stopped'),'Expected explicit startup failure');
 assert.equal(await blocked.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),0);assert.equal(await(await fetch(api)).text(),'unrelated service');
 await blocked.evaluate(()=>global.__smokeOriginalQuit());await closeApp(blocked);await delay(2200);assert.equal(await(await fetch(api)).text(),'unrelated service');await new Promise(accept=>conflict.close(accept));record('port-conflict-does-not-reuse-or-kill-unrelated-listener',{startupError});
 current=await launch(16970);await current.page.locator('#offline-sample').click();await current.page.locator('#stage').hover();await current.page.locator('#pause').click();await current.page.waitForFunction(()=>document.querySelector('#media').currentTime>.3);await current.page.screenshot({path:join(output,'packaged-player.png')});await current.application.evaluate(({app})=>app.quit());await stopped(current.pids);await closeApp(current.application);record('explicit-alternate-port-recovery');
 for(const entry of before)assert.equal(hash(readFileSync(entry.path)),entry.sha,'Immutable resource changed: '+entry.path);record('resources-unchanged-and-private-user-data-separated');
 assert.deepEqual(evidence.errors,[],'Unexpected packaged renderer errors');
 evidence.result='passed';evidence.limitations=['PCM verifies app output; no human listening or speaker/earbud certification.','Available runtime reference is recorded in environment.os and environment.kernel; a separate clean physical machine is not tested.','This initial runner covers packaging and sample only; local AI/speech/microphone integration remains pending. Microphone consent, native AI/speech, physical Mac installation, Gatekeeper, real audio devices, sleep/wake and Intel Macs are unqualified.'];
}catch(error){evidence.result='failed';evidence.failure=String(error.stack||error);console.error(error);if(current)await closeApp(current.application);process.exitCode=1;}
finally{for(const application of [...applications])await closeApp(application);if(conflict?.listening)await new Promise(accept=>conflict.close(accept));writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Evidence:',join(output,'evidence.json'));clearTimeout(watchdog);}
// Failed Electron startup can retain a driver transport even after its child
// exits. Reports and owned-child cleanup above precede this failure-only bound.
if(process.exitCode)setTimeout(()=>process.exit(process.exitCode),3000);
