// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {inventory} from './desktop-windows-support.mjs';
import {appPaths,processRows,ownedProcessIds,running,closeTrackedApplication} from './desktop-macos-support.mjs';

if(process.argv.includes('--help')){console.log('Native Apple Silicon: desktop-macos-ai-check.mjs RECEIVED_APP_EXECUTABLE VERIFIED_MODEL_FOLDER [--cpu] [--download-check]. Keep the full reference model/context. Physical microphone, audible output and disconnected-network checks require a Mac.');process.exit(0);}
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Native Apple Silicon is required.');
if(!process.argv[2]||!process.argv[3]||process.argv.slice(4).some(arg=>!['--cpu','--download-check'].includes(arg)))throw Error('Supply the received app and reviewed model-data folder.');
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),executable=realpathSync(resolve(process.argv[2])),source=realpathSync(resolve(process.argv[3]));
const local=relative(root,executable);assert(local.startsWith('..')||isAbsolute(local),'Test the received app outside the checkout.');
const {resources}=appPaths(executable),manifest=JSON.parse(readFileSync(join(resources,'notices/RUNTIME-MANIFEST.json'),'utf8'));assert.equal(manifest.phase,'alpha');
const outputRoot=resolve(process.env.BAMBI_MACOS_AI_OUTPUT||join(process.env.HOME,'.local/share/bambi-macos-tests'));mkdirSync(outputRoot,{recursive:true});
const output=mkdtempSync(join(outputRoot,'Mac ü AI ')),data=join(output,'Private profile ä'),emptyPath=join(output,'Empty PATH');mkdirSync(emptyPath);
const cpu=process.argv.includes('--cpu'),downloads=process.argv.includes('--download-check'),port=17969,origin='http://127.0.0.1:'+port;
const evidence={testedAt:new Date().toISOString(),version:manifest.version,sourceDigest:manifest.sourceDigest,executable,data,checks:[],errors:[],measurements:{},requested:cpu?'cpu':'auto',environment:{os:execFileSync('/usr/bin/sw_vers',[],{encoding:'utf8'}).trim(),ci:process.env.GITHUB_ACTIONS==='true'},conditions:{physicalMicrophone:false,physicalListening:false,systemNetworkDisconnected:false}};
const save=()=>writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
const record=(name,detail={})=>{evidence.checks.push({name,...detail});save();console.log('PASS',name);};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const env={...process.env,PATH:emptyPath};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
let application,child,page,owner;
async function until(predicate,timeout=300000){const end=performance.now()+timeout;while(performance.now()<end){if(await predicate())return;await delay(150);}throw Error('Full-model acceptance timed out; model/context must not be reduced.');}
async function stopped(pids){await until(()=>pids.every(pid=>!running(pid)),12000);}
async function close(){if(!application)return;await closeTrackedApplication(application,child);application=null;}
const watchdog=setTimeout(()=>{evidence.result='failed';evidence.failure='Full-model acceptance exceeded twenty minutes.';save();if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');setTimeout(()=>process.exit(1),10000);},20*60*1000);
async function launch(restart=false){
 const start=performance.now();application=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,`--bambi-port=${port}`,`--bambi-accelerator=${cpu?'cpu':'auto'}`],cwd:output,env,timeout:30000});
 child=application.process();owner=await application.evaluate(()=>process.pid);page=await application.firstWindow();page.on('pageerror',error=>evidence.errors.push(String(error)));
 const rejected=[];
 if(restart)await page.context().route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();rejected.push(url.origin);return route.abort();});
 await page.waitForSelector('#offline-sample',{state:'visible'});
 const access=await page.evaluate(async()=>(await(await fetch('/api/access')).json()));
 if(!access.configured){await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [data-local-only]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});}
 const state=await page.evaluate(async()=>(await(await fetch('/api/models/onboarding')).json()));
 if(!state.done){await page.locator('#model-onboarding[open]').waitFor();await page.locator('#model-onboarding [data-finish]').click();await page.locator('#model-onboarding').waitFor({state:'hidden'});}
 return {ms:performance.now()-start,rejected};
}
async function setupReady(){await until(()=>page.evaluate(async()=>{const state=await(await fetch('/api/desktop/setup')).json();if(state.phase==='failed')throw Error(state.error);return state.phase==='ready';}));}
async function prepare(){await page.getByRole('button',{name:'3. Install and start',exact:true}).click();await page.locator('#setup-prepare').click();await setupReady();}
async function conversation(spoken=false){
 await page.addInitScript(()=>{const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...args){if(destination===this.context.destination&&!window.__qualificationAnalyser){const analyser=this.context.createAnalyser();analyser.fftSize=2048;connect.call(this,analyser);window.__qualificationAnalyser=analyser;}return connect.call(this,destination,...args);};});
 await page.goto(origin+'/');await page.waitForFunction(()=>window.bambi&&document.querySelector('#health-tts')?.textContent==='Kokoro ready');
 await page.evaluate(spoken=>{
  for(const [id,value] of [['mode','conversation'],['ai-mode',spoken?'voice':'text'],['voice','bambi_classic'],['audio-preset','bambi_classic']]){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));}
  const narration=document.querySelector('#narration-enabled');narration.checked=false;narration.dispatchEvent(new Event('change',{bubbles:true}));
 },spoken);
}
async function reply(prompt,spoken){
 const prior=await page.evaluate(async()=>(await(await fetch('/api/diagnostics/replies')).json()).replies.map(reply=>reply.id));
 await page.locator('#chat-input').fill(prompt);await page.locator('#chat-form').evaluate(form=>form.requestSubmit());let trace,peak=0;
 await until(async()=>{
  const state=await page.evaluate(async()=>{let peak=0;const analyser=window.__qualificationAnalyser;if(analyser){const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);peak=Math.max(...samples.map(Math.abs));}return {report:await(await fetch('/api/diagnostics/replies')).json(),peak};});
  peak=Math.max(peak,state.peak);trace=state.report.replies.find(reply=>!prior.includes(reply.id));if(trace?.status==='error')throw Error('Full-model reply failed.');return trace?.status==='done';
 });
 const text=await page.locator('.message.assistant').last().textContent();assert(text?.trim().length>8);
 if(spoken){assert(trace.stages['playback-start']!==undefined);assert(peak>.0001,'No actual voice output PCM observed');}
 return {trace,characters:text.length,peak};
}
try{
 const original=await inventory(resources);record('received-alpha-with-private-profile',{startupMs:(await launch()).ms});
 await page.goto(origin+'/setup');await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='not-installed');
 const denied=await page.evaluate(async()=>{let microphone;try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop());microphone='granted';}catch(error){microphone=error.name;}return {download:(await fetch('/api/desktop/setup/install',{method:'POST'})).status,microphone};});
 assert.deepEqual(denied,{download:403,microphone:'NotAllowedError'});record('explicit-download-and-microphone-consent-required',denied);
 await page.getByRole('button',{name:'3. Install and start',exact:true}).click();
 if(downloads){
  await page.locator('[data-access]').click();await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [name=modelDownloads]').check();await page.locator('#privacy-access button[type=submit]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});
  for(let attempt=1;attempt<=2;attempt++){
   await page.locator('#setup-install').click();await until(()=>page.evaluate(async()=>{const state=await(await fetch('/api/desktop/setup')).json();if(state.phase==='failed')throw Error(state.error);return state.phase==='downloading'&&state.completed>0;}),60000);
   await page.locator('#setup-cancel').click();await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='cancelled');record('real-pinned-download-cancel-and-retry',{attempt});
  }
 }
 await application.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},source);
 await page.locator('[data-folder]').click();await until(()=>page.locator('.model-source').count().then(count=>count===1));
 const selected=await page.evaluate(async()=>(await(await fetch('/api/desktop/setup/sources')).json()).sources);assert(selected[0].models.includes('bambi-qwen35-9b-hauhau:q4_k_m'));record('native-selected-reference-model-folder',{supportedModels:selected[0].models});
 await page.locator('#setup-copy').click();await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='installed',{},{timeout:300000});record('actual-verified-model-and-speech-import');
 await prepare();const runtime=await page.evaluate(async()=>(await(await fetch('/api/desktop/setup')).json()).runtime);
 assert.equal(runtime.context,24576);assert.equal(runtime.inferenceVerified,true);assert.equal(runtime.backend,cpu?'cpu':'metal');
 if(cpu)assert.equal(runtime.offloadedLayers,0);else assert(runtime.offloadedLayers>0);
 record('full-reference-context-and-actual-inference-offload',{runtime});
 await conversation();record('actual-full-model-text-conversation',await reply('Tell me briefly what color the blue glass is.',false));
 await page.evaluate(()=>{window.bambi.hardStop();const field=document.querySelector('#ai-mode');field.value='voice';field.dispatchEvent(new Event('change',{bubbles:true}));});
 for(const prompt of ['Say one short sentence about a small silver key.','Now mention the blue glass beside it.','Give a brief closing sentence about the quiet room.'])record('actual-full-model-spoken-turn',await reply(prompt,true));
 await page.evaluate(()=>window.bambi.hardStop());const pids=ownedProcessIds(processRows(),owner);await application.evaluate(({app})=>{setImmediate(()=>app.quit());});await stopped(pids);await close();record('quit-with-loaded-native-services-cleans-owned-tree');
 const restarted=await launch(true);await page.goto(origin+'/setup');await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='installed',{},{timeout:180000});await prepare();await conversation(true);
 record('persisted-verified-model-restart-and-local-conversation',{startupMs:restarted.ms,reply:await reply('Give one short sentence about a silver key.',true),rendererExternalRequestsRejected:restarted.rejected,systemNetworkDisconnected:false});
 await page.evaluate(()=>window.bambi.hardStop());const reopened=ownedProcessIds(processRows(),owner);await application.evaluate(({app})=>{setImmediate(()=>app.quit());});await stopped(reopened);await close();
 assert.deepEqual(await inventory(resources),original);assert.deepEqual(evidence.errors,[]);record('received-resources-unchanged');evidence.result='passed';
 evidence.limitations=['The actual model, authored prompts and 24576 context are unchanged; CPU and Metal require separate runs.','Renderer external requests are rejected on restart; backend/system-wide network disconnection is not proven. Physical disconnected-network restart remains required.','Physical microphone capture, listening, OS permission revocation, sleep/wake and downloaded Gatekeeper installation are not certified by this script.','Model download cancellation is tested only when --download-check is explicitly selected.'];
}catch(error){evidence.result='failed';evidence.failure=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{try{await close();}catch(error){evidence.result='failed';evidence.cleanupFailure=String(error);process.exitCode=1;}save();clearTimeout(watchdog);console.log('Mac AI evidence:',join(output,'evidence.json'));}
