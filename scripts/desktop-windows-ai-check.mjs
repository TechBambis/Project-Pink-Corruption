// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync,cpSync} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {processSnapshot,observeRows,measureProcesses,machineConditions,startObserver,stopObserver} from './desktop-windows-processes.mjs';
import {inventory} from './desktop-windows-support.mjs';

if(process.argv.includes('--help')){console.log('Native Windows: node scripts/desktop-windows-ai-check.mjs "Bambi Local.exe" "reviewed model-data folder" [--cpu]. Run the packaging acceptance first.');process.exit(0);}
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Conversation acceptance requires native Windows x64.');
if(!process.argv[2]||!process.argv[3])throw Error('Supply the alpha executable and a folder containing the manifest-reviewed public assets.');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const outputRoot=resolve(process.env.BAMBI_WINDOWS_TEST_OUTPUT||join(process.env.LOCALAPPDATA,'Bambi qualification'));mkdirSync(outputRoot,{recursive:true});
const output=mkdtempSync(join(outputRoot,'Windows ü AI ')),data=join(output,'User data ä'),emptyPath=join(output,'Empty PATH');mkdirSync(emptyPath);
let executable=realpathSync(resolve(process.argv[2]));
const local=relative(root,executable);
if(!local.startsWith('..')&&!isAbsolute(local)){const received=join(output,'Received app ü');cpSync(dirname(executable),received,{recursive:true,errorOnExist:true,force:false});executable=join(received,executable.slice(dirname(executable).length+1));}
const source=realpathSync(resolve(process.argv[3])),cpu=process.argv.includes('--cpu'),port=17969;
const resources=join(dirname(executable),'resources');
process.env.BAMBI_WINDOWS_JOB_HELPER=join(resources,'backend/native/ownership/bambi-job.exe');
const manifest=JSON.parse(readFileSync(join(resources,'notices/RUNTIME-MANIFEST.json'),'utf8'));assert.equal(manifest.phase,'alpha');
const evidence={testedAt:new Date().toISOString(),executable,data,environment:machineConditions(),accelerator:cpu?'cpu':'auto',checks:[],errors:[],measurements:{}};
const record=(name,details={})=>{evidence.checks.push({name,...details});writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('PASS',name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,timeout=180000){const deadline=performance.now()+timeout;while(performance.now()<deadline){if(await predicate())return;await delay(200);}throw Error('Acceptance condition timed out.');}
const env={...process.env,PATH:emptyPath};delete env.ELECTRON_RUN_AS_NODE;
const microphonePath=join(output,'Virtual microphone.wav');
let application,page,owner,applicationChild;
async function launch(){
 const started=performance.now();
 application=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,`--bambi-port=${port}`,`--bambi-accelerator=${cpu?'cpu':'auto'}`,'--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${microphonePath}`],cwd:output,env,timeout:30000});
 applicationChild=application.process();owner=await application.evaluate(()=>process.pid);page=await application.firstWindow();page.on('pageerror',e=>evidence.errors.push(String(e)));await page.waitForSelector('#offline-sample',{state:'visible'});
 const privacyAccess=await page.evaluate(async()=>{const response=await fetch('/api/access');return response.ok?response.json():{configured:true};});
 if(!privacyAccess.configured){await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [name=microphone]').check();await page.locator('#privacy-access button[type=submit]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});}

 return performance.now()-started;
}
try{
 await startObserver();
 const before=await inventory(resources);evidence.measurements.startupMs=await launch();record('isolated-alpha-start',{startupMs:evidence.measurements.startupMs});
 await page.goto(`http://127.0.0.1:${port}/setup`);await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='not-installed');
 await application.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},source);
 await page.getByRole('button',{name:'2. Choose a model',exact:true}).click();await page.locator('input[name="model-choice"][value="bambi-qwen35-9b-hauhau:q4_k_m"]').check();
 await page.getByRole('button',{name:'3. Install and start',exact:true}).click();
 const installStart=performance.now();await page.locator('#setup-copy').click();
 await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='installed',{},{timeout:300000});evidence.measurements.verifiedCopyMs=performance.now()-installStart;record('explicit-model-copy-and-verification',{ms:evidence.measurements.verifiedCopyMs,downloadTest:false});
 const prepareStart=performance.now();await page.getByRole('button',{name:'3. Install and start',exact:true}).click();await page.locator('#setup-prepare').click();await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='ready',{},{timeout:300000});evidence.measurements.firstPreparationMs=performance.now()-prepareStart;record('native-model-and-Kokoro-preparation',{ms:evidence.measurements.firstPreparationMs});
 const fixture=await page.evaluate(async()=>{
  const response=await fetch('/api/voice-lab/render',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Keep the small silver key beside the blue glass.',preset:'bambi_local_clean',voice:'bambi_classic',speed:1})});
  if(!response.ok)throw Error('Frozen Kokoro fixture failed');return Array.from(new Uint8Array(await response.arrayBuffer()));
 });
 const wav=Buffer.from(fixture);assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',36,40),'data');
 const silence=Buffer.alloc(wav.readUInt16LE(32)*wav.readUInt32LE(24)*2),microphone=Buffer.concat([wav.subarray(0,44),silence,wav.subarray(44),silence]);microphone.writeUInt32LE(microphone.length-8,4);microphone.writeUInt32LE(microphone.length-44,40);writeFileSync(microphonePath,microphone);record('frozen-Kokoro-produces-real-WAV');
 await page.addInitScript(()=>{
  window.__captureTracks=[];window.__speechResults=[];
  const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await capture(options);window.__captureTracks.push(...stream.getTracks());return stream;};
  const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(url,...args){super(url,...args);if(String(url).endsWith('/ws/speech'))this.addEventListener('message',event=>{try{window.__speechResults.push(JSON.parse(event.data));}catch{}});}};
 });
 await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>!!window.bambi&&document.querySelector('#health-tts')?.textContent==='Kokoro ready');
 await page.evaluate(()=>{for(const [id,value] of [['mode','conversation'],['ai-mode','text'],['voice','bambi_classic'],['audio-preset','bambi_classic'],['response-length','220']]){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('#narration-enabled').checked=false;});
 const traceIds=()=>page.evaluate(async()=>(await(await fetch('/api/diagnostics/replies')).json()).replies.map(r=>r.id));
 async function reply(prompt,spoken){
  const previous=await traceIds();await page.locator('#chat-input').fill(prompt);await page.locator('#chat-form').evaluate(n=>n.requestSubmit());
  let trace;await until(async()=>{const report=await page.evaluate(async()=>await(await fetch('/api/diagnostics/replies')).json());trace=report.replies.find(r=>!previous.includes(r.id));if(trace?.status==='error')throw Error('Local reply failed');return trace?.status==='done';},300000);
  if(spoken)assert(trace.stages['playback-start']!==undefined);return trace;
 }
 const textStart=performance.now();const textTrace=await reply('Tell me briefly what color the blue glass is.',false);
 const text=await page.locator('.message.assistant').last().textContent();assert(text?.trim().length>8);record('actual-local-text-conversation',{characters:text.length,requestToDoneMs:performance.now()-textStart,trace:textTrace});
 await page.evaluate(()=>{window.bambi.hardStop();const node=document.querySelector('#ai-mode');node.value='voice';node.dispatchEvent(new Event('change',{bubbles:true}));});
 const voice=await reply('Say one short sentence about the small silver key.',true);evidence.measurements.warmFirstPlaybackMs=voice.stages['playback-start'];record('real-voice-playback',{trace:voice});
 await page.evaluate(()=>window.bambi.hardStop());await page.locator('#mic').click();await page.waitForFunction(()=>document.querySelector('#mic')?.getAttribute('aria-pressed')==='true');
 await page.waitForFunction(()=>window.__speechResults.some(r=>r.type==='partial'&&/silver|blue|glass|key/i.test(r.text)),{},{timeout:60000});
 await page.waitForFunction(()=>window.__speechResults.some(r=>r.type==='final'&&/silver|blue|glass|key/i.test(r.text)),{},{timeout:60000});record('native-streaming-recognizes-virtual-microphone',{results:await page.evaluate(()=>window.__speechResults.filter(r=>r.type==='partial'||r.type==='final'))});
 await page.locator('#mute').click();assert.equal(await page.locator('#mic').getAttribute('aria-pressed'),'true');await page.locator('#mute').click();
 await page.locator('#mic').click();await page.waitForFunction(()=>window.__captureTracks.every(t=>t.readyState==='ended'));record('audio-Mute-and-mic-Mute-are-separate');
 await page.evaluate(()=>window.bambi.hardStop());await page.waitForFunction(()=>document.querySelector('#mic').getAttribute('aria-pressed')==='false'&&window.bambi.audio?.context.state==='suspended');record('End-session-releases-mic-and-output');
 const measurement=measureProcesses(owner,120);const turns=[];
 for(const prompt of ['Describe a small silver key in one sentence.','Now describe a blue glass in one sentence.','Compare their colors briefly.','Give the key a simple name.','What name did you choose for the key?','Tell me one short sentence about a quiet room.','Mention the key and glass together briefly.','Give a brief closing sentence about the room.'])turns.push(await reply(prompt,true));
 evidence.measurements.sustainedConversation={turns,processes:await measurement};record('eight-spoken-turns-and-owned-resource-measurement',{turns:turns.length});
 evidence.runtime=await page.evaluate(async()=>(await(await fetch('/api/desktop/capabilities')).json()).runtime);
 await page.evaluate(()=>window.bambi.hardStop());const rows=(await processSnapshot(owner)).processes,quitStart=performance.now();await application.evaluate(({app})=>{setImmediate(()=>app.quit());});
 await until(async()=>{const current=await observeRows(rows.map(r=>r.pid));return rows.every(r=>!current.some(now=>now.pid===r.pid&&now.created===r.created));},12000);record('Quit-after-native-AI-cleans-owned-tree',{ms:performance.now()-quitStart});await application.close().catch(()=>{});application=null;
 const llamaLog=readFileSync(join(data,'logs/llama.log'),'utf8');
 evidence.accelerationEvidence=llamaLog.split(/\r?\n/).filter(line=>/offload.*layers.*GPU|(?:Vulkan|CUDA|ggml_cuda).*device|device.*(?:Vulkan|CUDA)/i.test(line));
 const offloaded=evidence.accelerationEvidence.some(line=>/offloaded [1-9][0-9]*\//i.test(line));
 if(cpu){assert(!offloaded,'CPU fallback unexpectedly offloaded layers');assert.equal(evidence.runtime.backend,'cpu');}
 else {assert(offloaded,'Automatic GPU qualification requires actual GPU-offloaded layers; CPU fallback is a separate run.');assert(['cuda','vulkan','hip','sycl','metal'].includes(evidence.runtime.backend));assert(evidence.runtime.offloadedLayers>0);}
 record('acceleration-observations',{requested:evidence.accelerator,backend:evidence.runtime.backend,cudaVersion:evidence.runtime.cudaVersion,logLines:evidence.accelerationEvidence,gpuQualified:!cpu&&offloaded});
 await launch();await page.goto(`http://127.0.0.1:${port}/setup`);await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='installed',{},{timeout:180000});
 await page.getByRole('button',{name:'3. Install and start',exact:true}).click();await page.locator('#setup-prepare').click();await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='ready',{},{timeout:300000});record('reopen-with-verified-installed-models',{networkIsolationVerified:false});
 assert.deepEqual(await inventory(resources),before);record('resources-unchanged');evidence.result='passed';
 evidence.limitations=['This is native application acceptance with a synthetic microphone, not physical hearing/microphone qualification.','Received browser download, Windows security policy, actual NSIS install/uninstall and offline network isolation are separate gates.','Setup copy is verified here; actual model download, cancellation/retry and damaged-install recovery need the setup acceptance run.','CPU and automatic GPU must be run separately. Automatic qualifies only the observed backend/variant; use the setup performance comparison to measure other CUDA/Vulkan paths. GPU presence alone is not support evidence.'];
}catch(error){evidence.result='failed';evidence.failure=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{
 if(application){
  try{const rows=owner?(await processSnapshot(owner)).processes:[];await application.close().catch(()=>{});if(applicationChild?.exitCode===null)applicationChild.kill('SIGKILL');
   if(rows.length)await until(async()=>{const current=await observeRows(rows.map(r=>r.pid));return rows.every(r=>!current.some(now=>now.pid===r.pid&&now.created===r.created));},12000);
  }catch(error){evidence.cleanupFailure=String(error);evidence.result='failed';process.exitCode=1;}
 }
 await stopObserver();
 writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Evidence:',join(output,'evidence.json'));
}
