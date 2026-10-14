// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {measureProcesses,processSnapshot} from './desktop-performance.mjs';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
const executable=resolve(process.argv[2]);
const root=resolve(new URL('../',import.meta.url).pathname);
assert(!executable.startsWith(root+'/'));
const outputRoot=resolve(process.env.BAMBI_ALPHA_TEST_OUTPUT||join(process.env.HOME,'.local/share/bambi-alpha-tests'));mkdirSync(outputRoot,{recursive:true});
const output=mkdtempSync(join(outputRoot,'AI ü alpha ')),data=join(output,'User data ä'),emptyPath=join(output,'empty-path');mkdirSync(emptyPath);
const evidence={testedAt:new Date().toISOString(),executable,data,checks:[],errors:[],measurements:{}};
const record=(name,details={})=>{evidence.checks.push({name,...details});console.log('PASS',name,JSON.stringify(details));writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');};
const alive=pid=>{try{return readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ')[0]!=='Z';}catch{return false;}};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,timeout=180000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await predicate())return;await delay(200);}throw Error('Acceptance condition timed out.');}
const env={...process.env,PATH:emptyPath};delete env.ELECTRON_RUN_AS_NODE;
let application,page;
try{
 const started=performance.now();
 application=await electron.launch({executablePath:executable,args:[`--bambi-user-data=${data}`,'--bambi-port=17969',`--bambi-accelerator=${process.env.BAMBI_ALPHA_TEST_CPU==='1'?'cpu':'auto'}`,'--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${join(output,'microphone.wav')}`],cwd:output,env,timeout:30000});
 page=await application.firstWindow();page.on('pageerror',e=>evidence.errors.push(String(e)));
 await page.waitForSelector('#offline-sample',{state:'visible'});
 const privacyAccess=await page.evaluate(async()=>{const response=await fetch('/api/access');return response.ok?response.json():{configured:true};});
 if(!privacyAccess.configured){await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [data-local-only]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});}
 const onboarding=await page.evaluate(async()=>(await(await fetch('/api/models/onboarding')).json()).done);
 if(!onboarding){await page.locator('#model-onboarding[open]').waitFor();await page.locator('#model-onboarding [data-finish]').click();await page.locator('#model-onboarding').waitFor({state:'hidden'});}
 evidence.measurements.startupMs=performance.now()-started;record('isolated-start',{startupMs:evidence.measurements.startupMs});
 await page.goto('http://127.0.0.1:17969/setup');await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='not-installed');
 await application.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},process.env.BAMBI_ALPHA_DATA_SOURCE||root);
 await page.getByRole('button',{name:'2. Choose a model',exact:true}).click();await page.locator('input[name="model-choice"][value="bambi-qwen35-9b-hauhau:q4_k_m"]').check();
 await page.getByRole('button',{name:'3. Install and start',exact:true}).click();
 const denied=await page.evaluate(async()=>{const response=await fetch('/api/desktop/setup/install',{method:'POST'});let microphone;try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(track=>track.stop());microphone='granted';}catch(error){microphone=error.name;}return {download:response.status,microphone};});
 assert.equal(denied.download,403);assert.equal(denied.microphone,'NotAllowedError');record('packaged-denied-download-and-microphone-access',{denied});
 await page.locator('[data-access]').click();await page.locator('#privacy-access[open]').waitFor();await page.locator('#privacy-access [name=microphone]').check();await page.locator('#privacy-access [name=modelDownloads]').check();await page.locator('#privacy-access button[type=submit]').click();await page.locator('#privacy-access').waitFor({state:'hidden'});
 for(let attempt=1;attempt<=2;attempt++){
  await page.locator('#setup-install').click();await until(()=>page.evaluate(async()=>{const state=await(await fetch('/api/desktop/setup')).json();if(state.phase==='failed')throw Error(state.error);return state.phase==='downloading'&&state.completed>0;}),60000);
  await page.waitForFunction(()=>document.querySelector('progress').value>0);await page.locator('#setup-cancel').click();await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='cancelled');record('actual-download-progress-cancel-and-retry',{attempt});
 }
 await page.locator('[data-folder]').click();await until(()=>page.locator('.model-source').count().then(count=>count===1));
 const saved=await page.evaluate(async()=>(await(await fetch('/api/desktop/setup/sources')).json()).sources);assert.equal(saved.length,1);assert(saved[0].models.includes('bambi-qwen35-9b-hauhau:q4_k_m'));
 await page.goto('http://127.0.0.1:17969/setup');await page.getByRole('button',{name:'2. Choose a model',exact:true}).click();await page.locator('input[name="model-choice"][value="bambi-qwen35-9b-hauhau:q4_k_m"]').check();await page.getByRole('button',{name:'3. Install and start',exact:true}).click();await until(()=>page.locator('.model-source').count().then(count=>count===1));
 await page.locator('[data-folder]').click();await until(()=>page.evaluate(async()=>(await(await fetch('/api/desktop/setup/sources')).json()).sources.length===1));record('native-chosen-model-folder-persists-and-deduplicates',{supportedModels:saved[0].models});
 const installStart=performance.now();await page.locator('#setup-copy').click();
 await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='installed',{},{timeout:180000});
 evidence.measurements.verifiedCopyMs=performance.now()-installStart;record('explicit-native-folder-copy-and-verification',{ms:evidence.measurements.verifiedCopyMs});
 const prepareStart=performance.now();await page.locator('#setup-prepare').click();
 await page.waitForFunction(()=>document.querySelector('#setup-progress')?.dataset.phase==='ready',{},{timeout:180000});evidence.measurements.firstPreparationMs=performance.now()-prepareStart;record('first-model-and-speech-preparation',{ms:evidence.measurements.firstPreparationMs});
 const runtime=await page.evaluate(async()=>(await(await fetch('/api/desktop/setup')).json()).runtime);assert.equal(runtime.context,24576);assert.equal(runtime.inferenceVerified,true);
 if(process.env.BAMBI_ALPHA_TEST_CPU==='1'){assert.equal(runtime.backend,'cpu');assert.equal(runtime.offloadedLayers,0);}else{assert.equal(runtime.backend,'vulkan');assert(runtime.offloadedLayers>0);}
 record('full-context-and-actual-inference-acceleration',{runtime});
 const pids=execFileSync('ps',['-eo','pid,ppid,args'],{encoding:'utf8'}).split('\n').map(line=>line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m=>({pid:Number(m[1]),parent:Number(m[2]),args:m[3]}));
 const owner=application.process().pid,supervisor=pids.find(p=>p.parent===owner&&p.args.includes('supervisor.mjs')),backend=pids.find(p=>p.parent===supervisor?.pid&&p.args.includes('apps/server/index.ts'));assert(backend);
 const backendEnv=Object.fromEntries(readFileSync(`/proc/${backend.pid}/environ`,'utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
 const fixture=await fetch(backendEnv.BAMBI_TTS_URL+'/v1/audio/speech',{method:'POST',headers:{'content-type':'application/json','X-Bambi-TTS-Token':backendEnv.BAMBI_TTS_TOKEN},body:JSON.stringify({text:'Keep the small silver key beside the blue glass.',preset:'bambi_local_clean',voice:'bambi_classic',speed:1})});assert(fixture.ok);const wav=Buffer.from(await fixture.arrayBuffer()),block=wav.readUInt16LE(32),rate=wav.readUInt32LE(24),silence=Buffer.alloc(block*rate*2),microphone=Buffer.concat([wav.subarray(0,44),silence,wav.subarray(44),silence]);microphone.writeUInt32LE(microphone.length-8,4);microphone.writeUInt32LE(microphone.length-44,40);writeFileSync(join(output,'microphone.wav'),microphone);record('frozen-kokoro-real-wav-fixture');
 await page.addInitScript(()=>{window.__captureTracks=[];window.__speechResults=[];const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await capture(options);window.__captureTracks.push(...stream.getTracks());return stream;};const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(url,...args){super(url,...args);if(String(url).endsWith('/ws/speech'))this.addEventListener('message',event=>{try{window.__speechResults.push(JSON.parse(event.data));}catch{}});}};});
 await page.goto('http://127.0.0.1:17969/');await page.waitForFunction(()=>!!window.bambi&&document.querySelector('#health-tts')?.textContent==='Kokoro ready');
 await page.evaluate(()=>{for(const [id,value] of [['mode','conversation'],['ai-mode','text'],['voice','bambi_classic'],['audio-preset','bambi_classic'],['response-length','220']]){const node=document.getElementById(id);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('#narration-enabled').checked=false;});
 async function send(prompt){await page.locator('[data-nav="session"]').first().click();await page.locator('#stage').hover();await page.locator('#chat-input').waitFor({state:'visible'});await page.locator('#composer-reply').click();await page.locator('#chat-input').fill(prompt);await page.getByRole('button',{name:'Send message',exact:true}).click();}
 const coldConversationStart=performance.now();await send('Tell me briefly what color the blue glass is.');
 await page.waitForFunction(()=>[...document.querySelectorAll('.message.assistant')].some(n=>n.textContent.trim().length>8),{},{timeout:180000});
 await until(()=>page.evaluate(async()=>{const r=await(await fetch('/api/diagnostics/replies')).json();return r.replies.some(t=>t.status==='done');}));
 const text=await page.locator('.message.assistant').last().textContent();assert(text&&!text.includes('Thinking'));evidence.measurements.firstTextConversationMs=performance.now()-coldConversationStart;record('actual-local-text-conversation',{characters:text.length,requestToDoneMs:evidence.measurements.firstTextConversationMs});
 await page.evaluate(()=>window.bambi.hardStop());
 await page.evaluate(()=>{const n=document.querySelector('#ai-mode');n.value='voice';n.dispatchEvent(new Event('change',{bubbles:true}));});
 const spokenStart=performance.now();await send('Say one short sentence about that small silver key.');
 await until(()=>page.evaluate(async()=>{const r=await(await fetch('/api/diagnostics/replies')).json();return r.replies.some(t=>t.stages['playback-start']!==undefined);}));
 const traces=await page.evaluate(async()=>await(await fetch('/api/diagnostics/replies')).json());const spoken=traces.replies.find(t=>t.stages['playback-start']!==undefined);evidence.measurements.warmFirstPlaybackMs=spoken.stages['playback-start'];record('real-voice-browser-playback',{trace:spoken,observedWaitMs:performance.now()-spokenStart});
 await page.evaluate(()=>window.bambi.hardStop());await page.locator('#stage').hover();await page.locator('#mic').click();
 await page.waitForFunction(()=>document.querySelector('#mic')?.getAttribute('aria-pressed')==='true',{},{timeout:30000});
 await page.waitForFunction(()=>window.__speechResults.some(r=>r.type==='partial'&&/silver|blue|glass|key/i.test(r.text)),{},{timeout:45000});await page.waitForFunction(()=>window.__speechResults.some(r=>r.type==='final'&&/silver|blue|glass|key/i.test(r.text)),{},{timeout:45000});record('microphone-started-and-real-streaming-words',{results:await page.evaluate(()=>window.__speechResults.filter(r=>r.type==='partial'||r.type==='final'))});
 await page.evaluate(()=>window.bambi.hardStop());await page.waitForFunction(()=>document.querySelector('#mic')?.getAttribute('aria-pressed')==='false'&&window.bambi.audio?.context.state==='suspended'&&window.__captureTracks.length>0&&window.__captureTracks.every(t=>t.readyState==='ended'));record('end-session-releases-microphone-and-output');

 await page.evaluate(()=>{const n=document.querySelector('#ai-mode');n.value='voice';n.dispatchEvent(new Event('change',{bubbles:true}));window.__frameDeltas=[];let previous=performance.now();function frame(now){window.__frameDeltas.push(now-previous);previous=now;if(window.__frameDeltas.length<50000)requestAnimationFrame(frame);}requestAnimationFrame(frame);});
 const longStart=performance.now(),longTurns=[];const processMeasurement=measureProcesses(owner,120);
 for(const prompt of ['Describe a small silver key in one sentence.','Now describe a blue glass in one sentence.','Compare their colors briefly.','Give the key a simple name.','What name did you choose for the key?','Tell me one short sentence about a quiet room.','Mention the key and glass together briefly.','Give a brief closing sentence about the room.']){
  const previous=await page.evaluate(async()=>(await(await fetch('/api/diagnostics/replies')).json()).replies.map(r=>r.id));
  await send(prompt);
  let trace;await until(async()=>{const report=await page.evaluate(async()=>await(await fetch('/api/diagnostics/replies')).json());trace=report.replies.find(r=>!previous.includes(r.id));if(trace?.status==='error')throw Error('Long conversation failed: '+JSON.stringify(trace));return trace?.status==='done';},180000);assert(trace.stages['playback-start']!==undefined);longTurns.push(trace);record('sustained-conversation-turn',{turn:longTurns.length,firstPlaybackMs:trace.stages['playback-start'],doneMs:trace.stages.done});
 }
 const frames=await page.evaluate(()=>window.__frameDeltas);evidence.measurements.longConversation={durationMs:performance.now()-longStart,turns:longTurns,processes:await processMeasurement,frames:{count:frames.length,meanMs:frames.reduce((a,b)=>a+b,0)/frames.length,p95Ms:[...frames].sort((a,b)=>a-b)[Math.ceil(frames.length*.95)-1]},scope:'Eight actual spoken turns after text, voice and virtual microphone checks; live visual canvas. RAF timing measures callback cadence, not physical display latency.'};await page.screenshot({path:join(output,'long-conversation.png')});record('sustained-conversation-with-visuals',{durationMs:evidence.measurements.longConversation.durationMs,frames:evidence.measurements.longConversation.frames});
 await page.evaluate(()=>window.bambi.hardStop());
 const owned=processSnapshot(owner).pids;const quitStart=performance.now();await application.evaluate(({app})=>{setImmediate(()=>app.quit());});await until(()=>owned.every(pid=>!alive(pid)),7500);record('native-quit-after-real-voice-and-microphone-cleans-all-owned-processes',{ms:performance.now()-quitStart,pids:owned});await application.close().catch(()=>{});application=null;
 evidence.result='passed';
}catch(error){evidence.result='failed';evidence.failure=String(error.stack||error);if(page)try{evidence.failurePage=await page.evaluate(()=>({url:location.href,notice:document.querySelector('#notice')?.textContent,microphone:document.querySelector('#mic-status')?.textContent,tracks:window.__captureTracks?.map(t=>({kind:t.kind,state:t.readyState})),speech:window.__speechResults?.filter(r=>r.type==='partial'||r.type==='final'||r.type==='error')}));await page.screenshot({path:join(output,'failure.png')});}catch{}console.error(error);process.exitCode=1;}
finally{if(application)await application.close().catch(()=>{});writeFileSync(join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Evidence:',join(output,'evidence.json'));}
