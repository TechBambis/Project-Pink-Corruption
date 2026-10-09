// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Diagnostic of the immutable received Alpha .28 app; no model or hardware substitution.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {totalmem,cpus} from 'node:os';
import {_electron as electron} from 'playwright';
import {appPaths,closeTrackedApplication,ownedProcessIds,processRows,running} from '../scripts/desktop-macos-support.mjs';
const executable=realpathSync(process.argv[2]),output=resolve(process.env.BAMBI_EVIDENCE_OUTPUT);mkdirSync(output,{recursive:true});
assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
const {resources,bundle}=appPaths(executable),backend=join(resources,'backend'),manifest=JSON.parse(readFileSync(join(resources,'notices/RUNTIME-MANIFEST.json'),'utf8'));
assert.equal(manifest.sourceDigest,'d13a2faccdea893fe789733dd9e6716397715534704865b55710b54a0beacc46');
assert.equal(manifest.version,'0.1.0-alpha.28');
const report={testedAt:new Date().toISOString(),version:manifest.version,sourceDigest:manifest.sourceDigest,gitSha:process.env.GITHUB_SHA,conditions:{platform:process.platform,architecture:process.arch,memoryBytes:totalmem(),cpuCount:cpus().length,os:execFileSync('/usr/bin/sw_vers',[],{encoding:'utf8'}).trim(),fullChatModel:false,gpuOffloading:false,physicalMac:false},checks:[]};
const save=()=>writeFileSync(join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n');
const record=(name,detail)=>{report.checks.push({name,...detail});save();console.log('EVIDENCE',name);};
const env={PATH:'',TMPDIR:output};for(const key of ['HOME','USER','LANG','LC_ALL','LC_CTYPE'])if(process.env[key])env[key]=process.env[key];
let application,appChild,nativeChild;
const watchdog=setTimeout(()=>{report.result='failed';report.failure='Diagnostic exceeded three minutes';save();if(nativeChild?.exitCode===null)nativeChild.kill('SIGKILL');if(appChild?.exitCode===null)appChild.kill('SIGKILL');setTimeout(()=>process.exit(1),3000);},180000);
try{
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{timeout:30000});
 const llama=join(backend,'native/llama/llama-server'),binary=readFileSync(llama),pin=manifest.files.find(file=>file.path==='native/llama/llama-server');
 assert.equal(binary.length,pin.bytes);assert.equal(createHash('sha256').update(binary).digest('hex'),pin.sha256);record('exact-received-native-executable',{sha256:pin.sha256});
 const started=performance.now();nativeChild=spawn(llama,['--list-devices'],{cwd:output,env,stdio:['ignore','pipe','pipe'],detached:true});let stdout='',stderr='',timedOut=false;
 nativeChild.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-32768);});nativeChild.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-32768);});
 const nativeResult=await new Promise((accept,reject)=>{const timer=setTimeout(()=>{timedOut=true;try{process.kill(-nativeChild.pid,'SIGTERM');}catch{}const force=setTimeout(()=>{try{process.kill(-nativeChild.pid,'SIGKILL');}catch{}},2000);nativeChild.once('exit',()=>clearTimeout(force));},60000);nativeChild.once('error',error=>{clearTimeout(timer);reject(error);});nativeChild.once('exit',(code,signal)=>{clearTimeout(timer);accept({code,signal});});});
 record('native-Metal-discovery-with-stderr',{...nativeResult,ms:performance.now()-started,timedOut,stdout,stderr,modelLoaded:false});
 const profile=join(output,'Private profile ü');application=await electron.launch({executablePath:executable,args:['--bambi-user-data='+profile,'--bambi-port=17969'],cwd:output,env,timeout:30000});appChild=application.process();const owner=await application.evaluate(()=>process.pid),page=await application.firstWindow();
 await page.waitForSelector('#offline-sample',{state:'visible'});await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [data-local-only]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});
 await page.locator('#model-onboarding[open]').waitFor();await page.locator('#model-onboarding [data-finish]').click();await page.locator('#model-onboarding').waitFor({state:'hidden'});
 await page.goto('http://127.0.0.1:17969/setup');await page.waitForSelector('.model-list input');
 const catalog=await page.evaluate(async()=>await(await fetch('/api/models/catalog')).json()),alias='bambi-qwen35-9b-hauhau:q4_k_m',reference=catalog.alternatives.find(model=>model.id===alias);assert(reference);assert.equal(reference.contextTokens,24576);assert.equal(reference.weightsBytes,5627044224);assert.equal(catalog.hardware.ramTotal,totalmem());
 await page.getByRole('button',{name:'2. Choose a model',exact:true}).click();await page.locator('input[value="'+alias+'"]').check();await page.getByRole('button',{name:'3. Install and start',exact:true}).click();
 await page.locator('[data-access]').click();await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [name=modelDownloads]').check();await page.locator('#privacy-access button[type=submit]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});
 const controls={downloadDisabled:await page.locator('#setup-install').isDisabled(),importDisabled:await page.locator('#setup-copy').isDisabled(),prepareDisabled:await page.locator('#setup-prepare').isDisabled()};
 assert.equal(reference.memoryFit,'too-large');assert(controls.downloadDisabled&&controls.importDisabled&&controls.prepareDisabled);
 record('actual-reference-model-memory-fit-and-setup-guard',{hardware:catalog.hardware,reserveBytes:catalog.reserveBytes,reference,controls,downloadConsent:true,modelDownloaded:false});
 await page.screenshot({path:join(output,'setup-memory-guard.png')});
 const owned=ownedProcessIds(processRows(),owner);await application.evaluate(({app})=>{setImmediate(()=>app.quit());});await closeTrackedApplication(application,appChild);application=null;
 const deadline=performance.now()+12000;while(owned.some(running)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,100));assert(!owned.some(running));record('diagnostic-owned-app-tree-cleanup',{ownedProcesses:owned.length});report.result='passed';
}catch(error){report.result='failed';report.failure=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{if(application)await closeTrackedApplication(application,appChild);save();clearTimeout(watchdog);}
