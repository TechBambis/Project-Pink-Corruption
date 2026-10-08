// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import { _electron as electron } from 'playwright';
import {measureProcesses} from './desktop-performance.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=fileURLToPath(new URL('../',import.meta.url));
const executable=realpathSync(resolve(process.argv[2]||'dist/desktop/0.1.0-alpha.1/linux-unpacked/bambi-local'));
assert(!executable.startsWith(root),'Extract/copy the received artifact outside the repository before testing');
const outputRoot=resolve(process.env.BAMBI_SMOKE_OUTPUT||join(process.env.HOME,'.local/share/bambi-alpha-tests'));mkdirSync(outputRoot,{recursive:true});
const output=mkdtempSync(join(outputRoot,'Linux ü alpha ')),data=join(output,'User data ä'),emptyPath=join(output,'empty-path');mkdirSync(emptyPath);
const environment={...process.env,PATH:emptyPath,NODE_OPTIONS:'--trace-warnings',BAMBI_CLOUD_API_KEY:'smoke-sentinel-must-not-be-inherited'};
delete environment.ELECTRON_RUN_AS_NODE;
const evidence={testedAt:new Date().toISOString(),executable,output,data,launchPath:emptyPath,checks:[],errors:[],environment:{kernel:execFileSync('uname',['-srmo'],{encoding:'utf8'}).trim(),os:readFileSync('/etc/os-release','utf8')}};
const record=(name,detail={})=>{evidence.checks.push({name,...detail});console.log('PASS',name);writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');};
const delay=ms=>new Promise(accept=>setTimeout(accept,ms));
const alive=pid=>{try{const stat=readFileSync(`/proc/${pid}/stat`,'utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]!=='Z';}catch{return false;}};
async function stopped(pids){for(let i=0;i<60;i++){if(pids.every(pid=>!alive(pid)))return;await delay(100);}assert.fail('Owned processes survived shutdown: '+pids.filter(alive));}
async function launch(port=16969){
 const launchStart=performance.now();const application=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,`--bambi-port=${port}`],cwd:output,env:environment,timeout:30000});
 const page=await application.firstWindow();page.on('pageerror',error=>evidence.errors.push(String(error)));
 await page.waitForSelector('#offline-sample',{state:'visible',timeout:30000});

 const privacyAccess=await page.evaluate(async()=>{const response=await fetch('/api/access');return response.ok?response.json():{configured:true};});
 if(!privacyAccess.configured){await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [data-local-only]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});}
 const onboarding=await page.evaluate(async()=>{const response=await fetch('/api/models/onboarding');return response.ok?response.json():{done:true};});
 if(!onboarding.done){await page.locator('#model-onboarding[open]').waitFor();await page.locator('#model-onboarding [data-finish]').click();await page.locator('#model-onboarding').waitFor({state:'hidden'});}
 const ownership=await application.evaluate(({app,BrowserWindow})=>({pid:process.pid,rendererPid:BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId(),data:app.getPath('userData'),windows:BrowserWindow.getAllWindows().map(window=>window.webContents.getLastWebPreferences())}));
 const pids=execFileSync('ps',['-eo','pid,ppid,args'],{encoding:'utf8'}).split('\n').flatMap(line=>{const match=line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);return match?[{pid:Number(match[1]),parent:Number(match[2]),command:match[3]}]:[];});
 const supervisor=pids.find(row=>row.parent===ownership.pid&&row.command.includes('supervisor.mjs'));assert(supervisor,'Owned supervisor missing');
 const backend=pids.find(row=>row.parent===supervisor.pid&&row.command.includes('apps/server/index.ts'));assert(backend,'Owned backend missing');
 const backendEnv=readFileSync(`/proc/${backend.pid}/environ`,'utf8').split('\0');
 assert(!backendEnv.some(value=>value.startsWith('NODE_OPTIONS=')||value.startsWith('BAMBI_CLOUD_API_KEY=')));
 assert(backendEnv.includes('PATH='+join(dirname(executable),'resources/backend/node/bin')));
 assert(!readFileSync(`/proc/${ownership.rendererPid}/cmdline`,'utf8').includes('--no-sandbox'));assert(/Seccomp:\s+2/.test(readFileSync(`/proc/${ownership.rendererPid}/status`,'utf8')));assert.equal(ownership.data,data);assert(ownership.windows.every(p=>p.sandbox&&p.contextIsolation&&!p.nodeIntegration&&p.webSecurity));
 return {application,page,ownership,supervisor,backend,startupMs:performance.now()-launchStart,pids:[supervisor.pid,backend.pid]};
}
let current,conflict,blocked,blockedPid;
try{
 // Inspect the extracted finished package, including app.asar and source archive.
 const require=createRequire(import.meta.url),asar=require('@electron/asar');const extracted=join(output,'shell-inspection');asar.extractAll(join(dirname(executable),'resources/app.asar'),extracted);
 const source=join(output,'source-inspection');mkdirSync(source);execFileSync('tar',['-xzf',join(dirname(executable),'resources/backend/dist/web/corresponding-source.tar.gz'),'-C',source]);
 const walk=folder=>readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{const path=join(folder,entry.name);if(entry.isSymbolicLink()){const target=realpathSync(path);assert(target.startsWith(dirname(executable)+'/')||target.startsWith(source+'/')||target.startsWith(extracted+'/'),'Artifact symlink escapes reviewed tree: '+path);if(lstatSync(target).isDirectory())return [];}return entry.isDirectory()?walk(path):[path];});
 const sourceManifest=JSON.parse(readFileSync(join(source,'SOURCE-MANIFEST.json'),'utf8'));const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(JSON.stringify(sourceManifest.files)),sourceManifest.sourceDigest);
 for(const file of sourceManifest.files)assert.equal(hash(readFileSync(join(source,file.path))),file.sha256,'Source snapshot mismatch: '+file.path);
 const runtime=JSON.parse(readFileSync(join(dirname(executable),'resources/notices/RUNTIME-MANIFEST.json'),'utf8'));assert.equal(runtime.sourceDigest,sourceManifest.sourceDigest);assert.equal(hash(readFileSync(join(extracted,'main.cjs'))),runtime.shell.mainSha256);assert.equal(hash(readFileSync(join(source,'apps/desktop/main.cjs'))),runtime.shell.mainSha256);assert.equal(JSON.parse(readFileSync(join(extracted,'package.json'),'utf8')).version,runtime.version);
 if(runtime.shell.permissionPolicySha256){assert.equal(hash(readFileSync(join(extracted,'permission-policy.cjs'))),runtime.shell.permissionPolicySha256);assert.equal(hash(readFileSync(join(source,'apps/desktop/permission-policy.cjs'))),runtime.shell.permissionPolicySha256);}
 assert.equal(hash(readFileSync(join(extracted,'preload.cjs'))),runtime.shell.preloadSha256||hash(readFileSync(join(source,'apps/desktop/preload.cjs'))));
 for(const file of runtime.files)assert.equal(hash(readFileSync(join(dirname(executable),'resources/backend',file.path))),file.sha256,'Runtime inventory mismatch: '+file.path);
 const inputs=[...walk(dirname(executable)),...walk(source),...walk(extracted)];
 const secrets=existsSync(join(root,'.env.cloud'))?readFileSync(join(root,'.env.cloud'),'utf8').split('\n').flatMap(line=>{const match=line.match(/^[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=(.*)$/);const value=match?.[1]?.trim().replace(/^['"]|['"]$/g,'');return value&&value.length>=12?[Buffer.from(value)]:[];}):[];
 for(const path of inputs){assert(!/(?:^|\/)(?:\.env(?:\.|$)|\.git|\.runtime|internal|vendor|imported-sounds|recordings)(?:\/|$)|\.(?:sqlite|key|pem|p12|pfx|gguf)$/.test(relative(dirname(executable),path)),'Excluded material in finished artifact '+path);const bytes=readFileSync(path);assert(!secrets.some(secret=>bytes.includes(secret)),'Private credential found (value withheld)');}
 record('finished-artifact-and-matching-source-audit',{files:inputs.length,sourceDigest:runtime.sourceDigest,privateCredentialValuesChecked:secrets.length,scope:'Allowlisted paths, every runtime/source SHA-256, actual local credential values; not an exhaustive semantic secret detector'});
 current=await launch();const {application,page,backend}=current;record('isolated-packaged-launch',{startupMs:current.startupMs,backendPid:backend.pid,nodeExecutable:realpathSync(`/proc/${backend.pid}/exe`),rendererSandbox:true,rendererSeccomp:true});
 const health=await page.evaluate(async()=>await(await fetch('/api/health')).json());assert(health.database&&health.desktopAlpha);assert(!health.ollama&&!health.kokoro&&!health.whisper&&!health.streamingSpeech);record('bundled-node-sqlite-and-explicit-capabilities',{health});
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
 record('sample-without-loaded-ai-process-performance',await measureProcesses(current.ownership.pid,10));
 await page.locator('#stage').hover();await page.locator('#pause').click();const position=await page.locator('#media').evaluate(node=>node.currentTime);await delay(700);assert(await page.locator('#media').evaluate(node=>node.paused));assert(Math.abs(await page.locator('#media').evaluate(node=>node.currentTime)-position)<.15);record('pause-freezes-playback');
 await page.locator('#stage').hover();await page.locator('#pause').click();await page.waitForFunction(previous=>document.querySelector('#media').currentTime>previous+.3,position);record('resume-advances-playback');
 await page.locator('#seek').evaluate(node=>{node.value='12';node.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#media').currentTime>=11.9);record('seek-updates-media');
 await page.locator('#stage').hover();await page.locator('#mute').click();await delay(500);assert.equal(await pcm(),0);await page.locator('#stage').hover();await page.locator('#mute').click();await audible();record('audio-mute-silences-pcm-and-unmute-restores-it');
 await page.locator('#master').evaluate(node=>{node.value='0';node.dispatchEvent(new Event('input',{bubbles:true}));});await delay(500);assert.equal(await pcm(),0);await page.locator('#master').evaluate(node=>{node.value='0.7';node.dispatchEvent(new Event('input',{bubbles:true}));});await audible();record('master-volume-controls-output');
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#media').paused);await page.waitForFunction(()=>window.__smokeAnalyser.context.state==='suspended');const stoppedAt=await page.locator('#media').evaluate(node=>node.currentTime);await delay(700);assert.equal(await page.locator('#media').evaluate(node=>node.currentTime),stoppedAt);record('end-session-stops-playback-and-output',{audioContext:'suspended',transportPosition:stoppedAt});
 assert(existsSync(join(data,'data/bambi.sqlite')));assert.equal(lstatSync(join(data,'data/bambi.sqlite')).mode&0o077,0);
 const before=walk(join(dirname(executable),'resources')).map(path=>({path,sha:hash(readFileSync(path))}));
 await page.evaluate(async()=>{const snapshot=await(await fetch('/api/settings')).json();const saved=await fetch('/api/preferences',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:snapshot.revision,settings:{...snapshot.settings,'bambi-name':'Smoke persistence ü'}})});if(!saved.ok)throw Error('Preference save was not acknowledged');});
 await application.evaluate(({app})=>app.quit());await stopped(current.pids);await application.close().catch(()=>{});record('ordinary-quit-cleans-owned-services');
 current=await launch();assert.equal(await current.page.evaluate(async()=>(await(await fetch('/api/preferences')).json())['bambi-name']),'Smoke persistence ü');record('reopen-retains-preferences');
 const second=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,'--bambi-port=16969'],cwd:output,env:environment,timeout:15000}).catch(()=>null);
 if(second){await delay(500);await second.close().catch(()=>{});}
 assert(alive(current.backend.pid));assert.equal(await current.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);record('second-launch-preserves-single-owner');
 process.kill(current.ownership.pid,'SIGKILL');await stopped(current.pids);await current.application.close().catch(()=>{});record('forced-electron-termination-cleans-owned-services');
 current=await launch();await current.application.evaluate(({dialog})=>{dialog.showErrorBox=(title,content)=>console.error('Expected backend failure:',title,content);});process.kill(current.backend.pid,'SIGKILL');await stopped(current.pids);await current.application.close().catch(()=>{});record('killed-backend-cleans-supervisor');
 current=await launch();process.kill(current.supervisor.pid,'SIGSTOP');process.kill(current.backend.pid,'SIGSTOP');const hungQuit=performance.now();await current.application.evaluate(({app})=>app.quit());await stopped(current.pids);await current.application.close().catch(()=>{});record('hung-supervisor-quit-is-bounded',{ms:performance.now()-hungQuit});
 current=await launch();await current.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await stopped(current.pids);await current.application.close().catch(()=>{});record('window-close-quits-and-reopen-after-failure');
 conflict=createServer((_req,res)=>res.end('unrelated service'));await new Promise((accept,reject)=>conflict.once('error',reject).listen(16969,'127.0.0.1',accept));
 blocked=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,'--bambi-port=16969'],cwd:output,env:environment,timeout:15000});
 blockedPid=blocked.process().pid;
 await blocked.evaluate(({app,dialog})=>{global.__smokeOriginalQuit=app.quit.bind(app);app.quit=()=>{};dialog.showErrorBox=(title,content)=>{global.__smokeStartupError={title,content};};});
 let startupError;for(let attempt=0;attempt<150;attempt++){startupError=await blocked.evaluate(()=>global.__smokeStartupError);if(startupError)break;await delay(100);}
 assert(startupError?.content.includes('No unrelated process was stopped'),'Expected explicit startup failure');
 assert.equal(await blocked.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),0);assert.equal(await(await fetch(api)).text(),'unrelated service');
 await blocked.evaluate(()=>global.__smokeOriginalQuit());await blocked.close().catch(()=>{});await delay(2200);assert.equal(await(await fetch(api)).text(),'unrelated service');await new Promise(accept=>conflict.close(accept));record('port-conflict-does-not-reuse-or-kill-unrelated-listener',{startupError});
 current=await launch(16970);await current.page.locator('#offline-sample').click();await current.page.locator('#stage').hover();await current.page.locator('#pause').click();await current.page.waitForFunction(()=>document.querySelector('#media').currentTime>.3);await current.page.screenshot({path:join(output,'packaged-player.png')});await current.application.evaluate(({app})=>app.quit());await stopped(current.pids);await current.application.close().catch(()=>{});record('explicit-alternate-port-recovery');
 for(const entry of before)assert.equal(hash(readFileSync(entry.path)),entry.sha,'Immutable resource changed: '+entry.path);record('resources-unchanged-and-private-user-data-separated');
 evidence.result='passed';evidence.limitations=['PCM verifies app output; no human listening or speaker/earbud certification.','Available runtime reference is recorded in environment.os and environment.kernel; a separate clean physical machine is not tested.','This initial runner covers packaging and sample only; local AI/speech/microphone qualification is recorded separately. Devices/import analysis and Windows/macOS are unqualified.'];
}catch(error){evidence.result='failed';evidence.failure=String(error.stack||error);console.error(error);if(current)await current.application.close().catch(()=>{});process.exitCode=1;}
finally{if(blockedPid&&alive(blockedPid)){process.kill(blockedPid,'SIGKILL');await blocked.close().catch(()=>{});}if(conflict?.listening)await new Promise(accept=>conflict.close(accept));writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Evidence:',join(output,'evidence.json'));}
