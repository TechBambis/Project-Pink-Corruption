// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {once} from 'node:events';

const root=fileURLToPath(new URL('../',import.meta.url)),realStreaming=process.env.BAMBI_BROWSER_STREAMING==='1';
const streamingFixture=join(root,'.runtime/streaming-speech/test.wav');
if(realStreaming&&!existsSync(streamingFixture))throw Error('Streaming integration needs the public test WAV at .runtime/streaming-speech/test.wav. See docs/STREAMING_SPEECH.md.');
const wav=Buffer.alloc(44+32000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
// Allow a realistic display window for each word on the two-core CI runner.
const captionSeconds=2,captionWav=Buffer.alloc(44+32000*captionSeconds);wav.copy(captionWav,0,0,44);captionWav.writeUInt32LE(captionWav.length-8,4);captionWav.writeUInt32LE(captionWav.length-44,40);
const inferenceRequests=[];
const stub=createServer(async(req,res)=>{
 const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'Cydonia-24B-v4.3'}]}));return;}
 if(req.url==='/v1/audio/voices'){res.end(JSON.stringify({voices:['af_heart']}));return;}
 if(req.url==='/lab/render'){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
 if(req.url==='/dev/captioned_speech'){res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({audio:captionWav.toString('base64'),audio_format:'wav',text:body.input,spoken_seconds:captionSeconds,timestamps:body.input.split(' ').map((word,i,all)=>({word,start_time:captionSeconds*i/all.length,end_time:captionSeconds*(i+1)/all.length}))})+'\n');return;}
 if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:JSON.stringify(body.messages)}));return;}
 if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:Array(Math.ceil(body.content.length/4)).fill(1)}));return;}
 if(!body.stream){res.end(JSON.stringify({choices:[{message:{content:'{"action":"adapt"}'}}]}));return;}
 if(req.url==='/v1/chat/completions')inferenceRequests.push(body);
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'The color is green.'}}]})+'\n\ndata: [DONE]\n\n');
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');const stubPort=stub.address().port;
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`,errors=[];let browser,logs='';
// A separate working directory excludes private .env files, recordings and caches.
const fixture=mkdtempSync(join(tmpdir(),'bambi-browser-check-'));
for(const name of ['packages','presets','voices','apps','docs','dist','config','scripts','node_modules'])
 if(existsSync(join(root,name)))symlinkSync(join(root,name),join(fixture,name),process.platform==='win32'?'junction':'dir');
if(realStreaming){mkdirSync(join(fixture,'.runtime'),{recursive:true});for(const name of ['streaming-stt-venv','streaming-speech'])symlinkSync(join(root,'.runtime',name),join(fixture,'.runtime',name),'dir');}
writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
writeFileSync(join(fixture,'bootstrap.mjs'),`
 import dgram from 'node:dgram';
 import {EventEmitter} from 'node:events';
 dgram.createSocket=()=>{const socket=new EventEmitter();socket.bind=(_p,_h,callback)=>callback?.();socket.unref=()=>socket;socket.send=()=>{};socket.close=()=>{};return socket;};
 await import(${JSON.stringify(new URL('../apps/server/index.ts',import.meta.url).href)});
`);
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^BAMBI_|^OLLAMA_/.test(key)));
const app=spawn(process.execPath,['--import','tsx','bootstrap.mjs'],{cwd:fixture,env:{...inherited,BAMBI_PORT:String(port),BAMBI_DATABASE:':memory:',BAMBI_TTS_URL:`http://127.0.0.1:${stubPort}`,BAMBI_CLOUD_URL:`http://127.0.0.1:${stubPort}`,BAMBI_CLOUD_MODEL:'Cydonia-24B-v4.3',BAMBI_CLOUD_CONTEXT:'32768',BAMBI_CLOUD_KIND:'llama.cpp',BAMBI_CLOUD_API_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});
app.stdout.on('data',data=>logs+=data);app.stderr.on('data',data=>logs+=data);
try{
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(app.exitCode!==null)throw Error('Fixture server failed: '+logs);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'Fixture server started');
 // This independent feature check uses an explicitly preconfigured fixture. First-run consent has its own browser check.
 assert.equal((await fetch(base+'/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({microphone:true,devices:true,modelDownloads:false,onlineMedia:false,cloudAI:true,localClock:false,approximateLocation:false,contextToCloud:false})})).status,200);
 browser=await chromium.launch({...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{}),headless:true});
 // Permit only the isolated synthetic microphone and local stub AI used by this fixture.
 const accessResponse=await fetch(base+'/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({microphone:true,devices:false,modelDownloads:false,onlineMedia:false,cloudAI:true,localClock:false,approximateLocation:false,contextToCloud:false})});assert.equal(accessResponse.status,200);
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(String(error)));
 // Model warming is covered separately; this check never invokes an installed local model.
 let warmCalls=0,failWarm=false;const warmRequests=[];
 await page.route('**/api/warm',route=>{warmCalls++;warmRequests.push({settings:route.request().postData(),failed:failWarm});return route.fulfill(failWarm?{status:503,json:{error:'Fixture preparation failed'}}:{json:{ok:true}});});
 if(!realStreaming){
  // Both health transports must describe the same synthetic recognizers from
  // the first navigation. Replacing one HTTP route mid-test leaves earlier
  // refreshes in flight, which can overwrite the streaming capability later.
  const recognitionHealth=data=>({...data,whisper:true,streamingSpeech:true});
  await page.route('**/api/health',async route=>{
   const response=await route.fetch();await route.fulfill({response,json:recognitionHealth(await response.json())});
  });
  await page.routeWebSocket('**/ws',socket=>{
   const server=socket.connectToServer();
   server.onMessage(raw=>{
    const data=JSON.parse(String(raw));
    socket.send(data.type==='health'?JSON.stringify({...data,data:recognitionHealth(data.data)}):raw);
   });
  });
  await page.routeWebSocket('**/ws/speech',socket=>{socket.send(JSON.stringify({type:'ready'}));socket.onMessage(raw=>{if(typeof raw!=='string')return;const command=JSON.parse(raw);if(command.type==='start')socket.send(JSON.stringify({type:'partial',id:command.id,text:'My live provisional words'}));if(command.type==='finish')socket.send(JSON.stringify({type:'final',id:command.id,text:'My final microphone words because'}));});});
 }
 await page.addInitScript(()=>{
  const OriginalWorker=window.Worker;window.fixtureWorkers=[];window.fixtureWorkerInstances=[];
  window.Worker=class extends OriginalWorker {
   constructor(...args){super(...args);this.fixture={frames:0,terminated:false,epoch:0};window.fixtureWorkers.push(this.fixture);window.fixtureWorkerInstances.push(this);this.addEventListener('message',({data})=>{if(data.type==='event'&&data.event.msg==='FRAME_PROCESSED')this.fixture.frames++;});}
   postMessage(message,...rest){if(Number.isInteger(message?.epoch))this.fixture.epoch=message.epoch;super.postMessage(message,...rest);}
   terminate(){this.fixture.terminated=true;super.terminate();}
  };
  const OriginalSocket=window.WebSocket;window.fixtureRequests=[];window.fixtureBegins=[];window.fixtureDones=[];window.fixtureSpeechResults=[];window.fixtureSpeechFinishes=[];
  window.WebSocket=class extends OriginalSocket{
   constructor(...args){super(...args);const speech=String(args[0]).endsWith('/ws/speech');if(speech)window.fixtureSpeechSocket=this;else window.fixtureSocket=this;this.addEventListener('message',event=>{const data=JSON.parse(event.data);if(speech)window.fixtureSpeechResults.push({...data,at:performance.now()});else if(data.type==='begin')window.fixtureBegins.push(data);else if(data.type==='done')window.fixtureDones.push(data);});}
   send(raw){if(typeof raw==='string'){const data=JSON.parse(raw);if(data.type==='chat')window.fixtureRequests.push(data);if(data.type==='finish')window.fixtureSpeechFinishes.push({...data,at:performance.now()});}super.send(raw);}
  };
 });
 await page.goto(base+'/setup');await page.waitForFunction(()=>document.getElementById('readiness').textContent.includes('Cloud AI: ready'));
 // Use the built worker and real local ONNX model with synthetic silence. No microphone or recording.
 const mainAsset=readFileSync(join(root,'dist/web/index.html'),'utf8').match(/src="([^\"]*\/main-[^\"]+\.js)"/)[1];
 const workerAsset=readFileSync(join(root,'dist/web',mainAsset),'utf8').match(/\/assets\/detector-worker-[\w-]+\.js/)[0];
 const speechWorker=await page.evaluate(async path=>{
  const worker=new Worker(path),received=[],waiting=[];
  worker.onmessage=({data})=>{received.push(data);for(const notify of [...waiting])notify(data);};
  const next=predicate=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{waiting.splice(waiting.indexOf(notify),1);reject(Error('Speech worker timed out'));},30000);
   const notify=data=>{if(data.type==='error'||predicate(data)){clearTimeout(timer);waiting.splice(waiting.indexOf(notify),1);data.type==='error'?reject(Error(data.message)):resolve(data);}};
   waiting.push(notify);
  });
  try{
   await next(data=>data.type==='ready');
   const first=next(data=>data.type==='event'&&data.event.msg==='FRAME_PROCESSED');
   worker.postMessage({type:'frame',epoch:0,data:new Float32Array(512),rate:16000,durationMs:32});
   await first;
   worker.postMessage({type:'reset',epoch:1});
   const fresh=next(data=>data.type==='event'&&data.epoch===1&&data.event.msg==='FRAME_PROCESSED');
   worker.postMessage({type:'frame',epoch:1,data:new Float32Array(512),rate:16000,durationMs:32});
   await fresh;
   return {ready:true,frames:received.filter(data=>data.type==='event'&&data.event.msg==='FRAME_PROCESSED').length,falseSpeech:received.some(data=>data.type==='event'&&data.event.msg==='SPEECH_REAL_START')};
  }finally{worker.terminate();}
 },workerAsset);
 assert.equal(speechWorker.ready,true);assert.equal(speechWorker.frames,2);assert.equal(speechWorker.falseSpeech,false);
 await page.goto(base+'/studio');await page.selectOption('#kind','caption');await page.fill('#text','A quiet test moment.');await page.click('#add');await page.waitForFunction(()=>document.querySelector('#cues')?.textContent.includes('A quiet test moment.'));
 await page.selectOption('#kind','speech');await page.fill('#time','2');await page.fill('#text','A rendered fixture passage.');await page.click('#add');await page.waitForFunction(()=>document.querySelector('#cues')?.textContent.includes('A rendered fixture passage.'));
 const downloadPromise=page.waitForEvent('download');await page.click('#export');const download=await downloadPromise;assert.equal(download.suggestedFilename(),'session.bambi.json');
 const path=await download.path();assert.equal(JSON.parse(readFileSync(path,'utf8')).assets.length,1);await page.setInputFiles('#import',path);await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Package opened'));
 await page.click('#preview');await page.waitForFunction(()=>document.getElementById('caption').textContent==='A quiet test moment.');await page.click('#stop');assert.equal(await page.locator('#clock').textContent(),'00:00');
 mkdirSync('runtime',{recursive:true});await page.screenshot({path:'runtime/session-studio-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'runtime/session-studio-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});await page.goto(base+'/');await page.waitForFunction(()=>!!window.bambi&&[...document.getElementById('model').options].some(option=>option.value==='cloud:cydonia-24b-v4.3')&&document.getElementById('connection').textContent==='Connected locally');
 // These checks exercise conversational replies; Guided defaults are covered by navigation-browser-check.
 await page.evaluate(()=>{document.querySelector('#experience-choices [data-experience="conversation"]').click();});
 // Settings panels are intentionally collapsed; configure through the same change events.
 await page.evaluate(()=>{for(const [id,value] of [['model','cloud:cydonia-24b-v4.3'],['mode','conversation'],['ai-mode','text']]){const select=document.getElementById(id);select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}});
 // Failed background preparation must not retry on every health refresh.
 failWarm=true;
 await page.evaluate(()=>{const select=document.getElementById('sampling-profile');select.value=select.value==='qwen'?'creative':'qwen';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForFunction(()=>document.body.textContent.includes('Fixture preparation failed'));
 // A late health response can legitimately change context/voice settings.
 // Detect retries of the exact failed settings, independently of that update.
 const failedSettings=warmRequests.findLast(request=>request.failed)?.settings;
 assert.ok(failedSettings,'The fixture observed a failed preparation request');
 const failedSettingsCalls=warmRequests.filter(request=>request.settings===failedSettings).length;
 await page.waitForTimeout(6500);assert.equal(warmRequests.filter(request=>request.settings===failedSettings).length,failedSettingsCalls,'Failed settings stay idle until an explicit retry');
 const failedWarmCalls=warmCalls;
 failWarm=false;await page.evaluate(()=>window.bambi.startSession());
 await page.waitForFunction(()=>window.bambi.director.active&&window.bambi.clock.running);assert.ok(warmCalls>failedWarmCalls,'Start retries failed preparation');
 await page.locator('#chat-input').focus();
 await page.evaluate(async()=>{await fetch('/api/memory/facts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'color',value:'green'})});document.getElementById('chat-input').value='What color did I choose?';document.getElementById('chat-input').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('chat-form').requestSubmit();});
 try{await page.waitForFunction(()=>document.querySelector('#messages')?.textContent.includes('The color is green.'));}catch(error){console.error(await page.evaluate(()=>({status:document.getElementById('ai-status').textContent,model:document.getElementById('model').value,notices:[...document.querySelectorAll('[role="status"]')].map(node=>node.textContent),messages:document.getElementById('messages').textContent})));throw error;}
 await page.waitForFunction(()=>document.getElementById('composer-reply').textContent.includes('The color is green.'));
 assert.equal(await page.locator('#chat-input').inputValue(),'','Sending clears only the user draft');
 assert.equal(await page.locator('#composer-reply').getAttribute('hidden'),null,'Empty focused field keeps the reply available after sending');
 const memory=await(await fetch(base+'/api/memory')).json();assert.equal(memory.facts[0].value,'green');assert.ok(memory.turns.some(turn=>turn.role==='assistant'&&turn.content.includes('green')));
 await page.evaluate(()=>{document.getElementById('ai-mode').value='voice';document.getElementById('ai-mode').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('master').value='0';document.getElementById('master').dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>window.bambi.ask('Tell me my color in one sentence.'));
 await page.waitForFunction(async()=>{const report=await(await fetch('/api/diagnostics/replies')).json();return report.replies.some(reply=>reply.stages['playback-start']!==undefined&&reply.status==='done');});
 // The word display and composer share the audible clock, not token arrival.
 await page.waitForFunction(()=>document.getElementById('word').textContent===''&&document.getElementById('mic').dataset.activity==='idle');
 await page.evaluate(()=>{
  document.getElementById('subtitles').checked=true;document.getElementById('subtitles').dispatchEvent(new Event('input',{bubbles:true}));
  window.fixtureDisplayTrace=[];
  // Observe actual DOM presentation after each frame, rather than sampling it
  // with an independent timer which can miss a short word under CPU pressure.
  window.fixtureDisplayObserver=new MutationObserver(()=>{const word=document.getElementById('word').textContent,reply=document.getElementById('composer-reply').textContent;if(word&&word!==window.fixtureDisplayTrace.at(-1)?.word)window.fixtureDisplayTrace.push({word,reply});});
  window.fixtureDisplayObserver.observe(document.getElementById('word'),{childList:true,characterData:true,subtree:true});
 });
 await page.evaluate(()=>window.bambi.ask('Use a single sentence about my color.'));
 try{await page.waitForFunction(()=>window.fixtureDisplayTrace.some(item=>item.word==='green.'));}catch(error){
  const display=await page.evaluate(()=>({trace:window.fixtureDisplayTrace,requests:window.fixtureRequests.map(({requestId})=>requestId),begins:window.fixtureBegins.map(({id})=>id),dones:window.fixtureDones.map(({id})=>id),activity:document.getElementById('mic').dataset.activity,word:document.getElementById('word').textContent,reply:document.getElementById('composer-reply').textContent,audioState:window.bambi.audio?.context.state,playbackTime:window.bambi.playbackClock.time,clockRunning:window.bambi.playbackClock.running,visibility:document.visibilityState}));
  writeFileSync('runtime/voice-display-diagnostics.json',JSON.stringify(display,null,2));console.error('Fixture voice display diagnostics: '+JSON.stringify(display));throw error;
 }
 const revealTrace=await page.evaluate(()=>{window.fixtureDisplayObserver.disconnect();return window.fixtureDisplayTrace;});
 assert.deepEqual(revealTrace.map(item=>item.word),['The','color','is','green.'],'Every spoken word reaches the display in order');
 assert.ok(revealTrace.some(item=>item.word==='The'&&item.reply==='The'),'Reply begins with the caption first word, without showing the queued sentence: '+JSON.stringify(revealTrace));
 assert.ok(revealTrace.every(item=>item.reply.trim().split(/\s+/).at(-1)===item.word),'The latest reply word matches the caption on the same display frame');
 // Hover controls follow pointer activity, independently of AI voice playback.
 // Keep this fixture playing throughout the UI assertions even when runner
 // IPC takes several seconds. The check explicitly stops it below.
 const longSpeech=Buffer.alloc(44+16000*2*30);wav.copy(longSpeech,0,0,44);longSpeech.writeUInt32LE(longSpeech.length-8,4);longSpeech.writeUInt32LE(longSpeech.length-44,40);
 await page.evaluate(async encoded=>{
  document.getElementById('narration-enabled').checked=false;document.getElementById('narration-enabled').dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('master').value='.1';document.getElementById('master').dispatchEvent(new Event('input',{bubbles:true}));
  document.activeElement?.blur();
  await window.bambi.audio.playVoice(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)).buffer,()=>{},()=>{window.fixtureLongSpeechEnded=true;},undefined,{conversation:true,spokenSeconds:30});
 },longSpeech.toString('base64'));
 await page.waitForFunction(()=>window.bambi.audio.foregroundOutputActive('AI_VOICE'));
 await page.mouse.move(2,2);await page.waitForTimeout(3200);
 assert.equal(await page.locator('#stage').evaluate(node=>node.classList.contains('controls-hidden')),true,'Speech never forces the menu open');
 const playerBounds=await page.locator('#stage').boundingBox();await page.mouse.move(playerBounds.x+playerBounds.width/2,playerBounds.y+playerBounds.height-35);
 await page.waitForFunction(()=>document.getElementById('stage').classList.contains('controls-visible'));
 assert.equal(await page.locator('#chat-form').isVisible(),true,'Moving toward the controls reveals them while AI is speaking');
 assert.equal(await page.locator('#mic .voice-toggle-state').textContent(),'Speaking');
 assert.notEqual(await page.locator('#stage').evaluate(node=>getComputedStyle(node).cursor),'none');
 await page.locator('#stage').screenshot({path:'runtime/player-speaking-visible.png'});
 await page.evaluate(()=>window.bambi.audio.stopVoice(true,true));
 await page.waitForFunction(()=>!window.bambi.audio.foregroundOutputActive('AI_VOICE'));
 await page.locator('[data-nav=voice]').click();await page.locator('#memory').scrollIntoViewIfNeeded();await page.click('#memory');await page.waitForSelector('#memory-dialog[open]');await page.fill('#memory-key','color');await page.fill('#memory-value','blue');await page.click('#memory-form button[type=submit]');await page.waitForFunction(()=>document.getElementById('memory-content').textContent.includes('color: blue'));
 await page.click('#forget');await page.waitForFunction(()=>!document.getElementById('memory-content').textContent.includes('color:'));assert.deepEqual((await(await fetch(base+'/api/memory')).json()).facts,[]);await page.click('#close-memory');
 // A new conversation resets current context, retaining confirmed preferences and history.
 await page.evaluate(async()=>{await fetch('/api/memory/facts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'voice',value:'slow'})});await window.bambi.ask('Tell me one calm sentence.');});
 // Let the requested reply finish before comparing history: an interrupted
 // reply legitimately saves its heard prefix when New conversation cancels it.
 await page.waitForFunction(()=>window.fixtureDones.at(-1)?.requestId===window.fixtureRequests.at(-1)?.requestId);
 const beforeNew=await(await fetch(base+'/api/memory')).json();
 await page.locator('#new-conversation').click();
 await page.waitForFunction(()=>document.getElementById('composer-reply').textContent.includes('A fresh little beginning'));
 const afterNew=await(await fetch(base+'/api/memory')).json();
 assert.notEqual(afterNew.conversationId,beforeNew.conversationId);assert.deepEqual(afterNew.facts,beforeNew.facts);assert.deepEqual(afterNew.turns,beforeNew.turns);
 const health=await(await fetch(base+'/api/health')).json();assert.equal(health.protocolVersion,1);assert.equal(health.modelConnections['cloud:cydonia-24b-v4.3'].context,32768);assert.ok(!JSON.stringify(health).includes('fixture-key'));
 // Replay a genuinely issued reply identity after Stop, including silent audio
 // and an action. Nothing may restart output or overwrite the stopped state.
 const stopped=await page.evaluate(audio=>{
  const begin=window.fixtureBegins.at(-1);if(!begin?.requestId)throw Error('Server did not echo the client request identity');
  window.bambi.hardStop(false);const before=document.getElementById('ai-status').textContent,scene=window.bambi.visuals?.scene;
  for(const data of [begin,{type:'token',text:'OBSOLETE_REPLY_AFTER_STOP'},{type:'audio',seq:900,text:'OBSOLETE_REPLY_AFTER_STOP',audio,spoken_seconds:1},{type:'action',action:{type:'scene',scene:'Audio Only'}},{type:'error',text:'OBSOLETE_ERROR_AFTER_STOP'}])window.fixtureSocket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({...data,id:begin.id,requestId:begin.requestId})}));
  return {before,after:document.getElementById('ai-status').textContent,obsoleteTextShown:document.getElementById('messages').textContent.includes('OBSOLETE_REPLY_AFTER_STOP'),sceneUnchanged:window.bambi.visuals?.scene===scene};
 },wav.toString('base64'));
 assert.equal(stopped.before,stopped.after);assert.equal(stopped.obsoleteTextShown,false);assert.equal(stopped.sceneUnchanged,true);
 await page.waitForFunction(()=>window.bambi.audio.context.state==='suspended');
 // Stop in the same task as issuing a request, before its begin can be handled.
 await page.evaluate(async()=>{await window.bambi.ask('A fresh request before immediate Stop.');window.bambi.hardStop();});
 const immediatelyStopped=await page.evaluate(audio=>{
  const request=window.fixtureRequests.at(-1),id='fixture-before-begin';
  for(const data of [{type:'begin',dialogue:true},{type:'token',text:'OBSOLETE_BEFORE_BEGIN'},{type:'audio',seq:901,text:'OBSOLETE_BEFORE_BEGIN',audio}])window.fixtureSocket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({...data,id,requestId:request.requestId})}));
  return !document.getElementById('messages').textContent.includes('OBSOLETE_BEFORE_BEGIN');
 },wav.toString('base64'));
 assert.equal(immediatelyStopped,true);
 // Exercise capture, the production worker client and Mute with a generated silent MediaStream.
 if(realStreaming)await page.route('**/api/health',route=>route.fulfill({json:{...health,whisper:true}}));
 if(realStreaming)await page.route('**/fixture-streaming.wav',route=>route.fulfill({contentType:'audio/wav',body:readFileSync(streamingFixture)}));
 await page.evaluate(realStreaming=>{
  window.fixtureMicContexts=[];window.fixtureMicStreams=[];
  if(!realStreaming){document.getElementById('mic-recognizer').value='whisper';document.getElementById('mic-recognizer').dispatchEvent(new Event('input',{bubbles:true}));}
  navigator.mediaDevices.getUserMedia=async()=>{
   const context=new AudioContext(),destination=context.createMediaStreamDestination(),silence=context.createConstantSource();
   silence.offset.value=0;silence.connect(destination);silence.start();await context.resume();
   if(realStreaming){const samples=await context.decodeAudioData(await(await fetch('/fixture-streaming.wav')).arrayBuffer());const source=context.createBufferSource();source.buffer=samples;source.connect(destination);source.start(context.currentTime+1.5);}
   window.fixtureMicContexts.push(context);window.fixtureMicStreams.push(destination.stream);return destination.stream;
  };
  document.getElementById('narration-enabled').checked=false;document.getElementById('narration-enabled').dispatchEvent(new Event('input',{bubbles:true}));
 },realStreaming);
 await page.locator('#stage').hover();await page.click('#mic');
 await page.waitForFunction(()=>document.getElementById('mic').dataset.captureState==='ready'&&window.fixtureWorkers.some(worker=>worker.frames>=3),null,{timeout:30000});
 let streamingRecognition=null;
 if(!realStreaming){
  await page.route('**/api/transcribe',route=>route.fulfill({json:{text:'My recognized microphone words because',latencyMs:1}}));
  await page.evaluate(()=>{document.getElementById('mic-smart-turns').checked=true;const worker=window.fixtureWorkerInstances.at(-1);worker.onmessage({data:{type:'event',epoch:worker.fixture.epoch,event:{msg:'SPEECH_REAL_START'}}});worker.onmessage({data:{type:'event',epoch:worker.fixture.epoch,event:{msg:'SPEECH_END',audio:new Float32Array(16000)}}});});
  await page.waitForFunction(()=>document.getElementById('composer-reply').textContent==='My recognized microphone words because');
  assert.equal(await page.locator('#chat-input').inputValue(),'','Recognized microphone words are a readout, not a user draft');
  await page.waitForFunction(()=>window.fixtureRequests.some(request=>request.text==='My recognized microphone words because'));
  // Isolate recognition transport while exercising the production partial/final UI hooks.
  await page.evaluate(health=>{window.bambi.hardStop(false);window.fixtureSocket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'health',data:{...health,whisper:true,streamingSpeech:true}})}));document.getElementById('mic-recognizer').value='streaming';document.getElementById('mic-recognizer').dispatchEvent(new Event('input',{bubbles:true}));},health);
  await page.locator('#stage').hover();await page.click('#mic');
  try{await page.waitForFunction(()=>document.getElementById('mic').dataset.captureState==='ready'&&!window.fixtureWorkerInstances.at(-1).fixture.terminated);}catch(error){console.error(await page.evaluate(()=>({mic:document.getElementById('mic').dataset,notice:document.getElementById('notice').textContent,speech:window.fixtureSpeechResults,workers:window.fixtureWorkers})));throw error;}
  await page.evaluate(()=>{const worker=window.fixtureWorkerInstances.at(-1);worker.onmessage({data:{type:'event',epoch:worker.fixture.epoch,event:{msg:'SPEECH_REAL_START'}}});});
  await page.waitForFunction(()=>document.getElementById('composer-reply').textContent==='My live provisional words');
  assert.equal(await page.locator('#messages').textContent().then(text=>text.includes('My live provisional words')),false,'Partial speech is visible without entering message history');
  assert.equal(await page.locator('#chat-input').inputValue(),'','Live recognition never replaces the user draft');
  await page.evaluate(()=>{const worker=window.fixtureWorkerInstances.at(-1);worker.onmessage({data:{type:'event',epoch:worker.fixture.epoch,event:{msg:'SPEECH_END',audio:new Float32Array(16000)}}});});
  await page.waitForFunction(()=>document.getElementById('composer-reply').textContent==='My final microphone words because');
  await page.waitForFunction(()=>window.fixtureRequests.some(request=>request.text==='My final microphone words because'));
 }
 if(realStreaming){
  try{await page.waitForFunction(()=>window.fixtureSpeechResults.some(result=>result.type==='partial'&&result.text.includes('AFTER EARLY')),null,{timeout:30000});}catch(error){console.error(await page.evaluate(()=>({speech:window.fixtureSpeechResults,workers:window.fixtureWorkers,mic:document.getElementById('mic').dataset,status:document.getElementById('listening-status').textContent,messages:document.getElementById('messages').textContent,notices:[...document.querySelectorAll('[role=\"status\"]')].map(node=>node.textContent)})));throw error;}
  const interim=await(await fetch(base+'/api/memory')).json();assert.ok(!interim.turns.some(turn=>turn.role==='user'&&turn.content.includes('AFTER EARLY')),'Provisional recognition must not become conversation history');
  await page.waitForFunction(()=>window.fixtureRequests.some(request=>request.text.includes('AFTER EARLY')),null,{timeout:30000});
  await page.waitForFunction(async()=>{const memory=await(await fetch('/api/memory')).json();return memory.turns.some(turn=>turn.role==='user'&&turn.content.includes('AFTER EARLY'));},null,{timeout:10000});
  const finalMemory=await(await fetch(base+'/api/memory')).json();assert.equal(finalMemory.turns.filter(turn=>turn.role==='user'&&turn.content.includes('AFTER EARLY')).length,1);
  streamingRecognition=await page.evaluate(()=>{const first=window.fixtureSpeechResults.find(result=>result.type==='partial'&&result.text),final=window.fixtureSpeechResults.find(result=>result.type==='final'),finish=window.fixtureSpeechFinishes.find(command=>command.id===final.id);return {partialBeforeFinal:first.at<final.at,partials:window.fixtureSpeechResults.filter(result=>result.type==='partial').length,finalAfterFinishMs:Math.round(final.at-finish.at),oneCommittedInput:true};});
  assert.equal(streamingRecognition.partialBeforeFinal,true);
 }
 await page.locator('#stage').hover();await page.click('#mic');
 await page.waitForFunction(()=>document.getElementById('mic').dataset.captureState==='muted'&&window.fixtureWorkers.every(worker=>worker.terminated)&&window.fixtureMicStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
 if(realStreaming){
  const completedId=await page.evaluate(()=>window.fixtureSpeechResults.find(result=>result.type==='final').id);
  await page.locator('#stage').hover();await page.click('#mic');
  await page.waitForFunction(id=>window.fixtureSpeechResults.some(result=>result.type==='partial'&&result.id!==id&&result.text),completedId,{timeout:30000});
  const cancelled=await page.evaluate(()=>({id:window.fixtureSpeechResults.filter(result=>result.type==='partial').at(-1).id,requests:window.fixtureRequests.length}));
  await page.locator('#stage').hover();await page.click('#mic');
  await page.waitForFunction(()=>document.getElementById('mic').dataset.captureState==='muted'&&window.fixtureWorkers.every(worker=>worker.terminated)&&window.fixtureMicStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.fixtureRequests.length),cancelled.requests,'Mute must not commit the interrupted recording');
  assert.equal(await page.evaluate(id=>window.fixtureSpeechResults.some(result=>result.type==='final'&&result.id===id),cancelled.id),false);
  assert.equal(await page.locator('#listening-status').textContent(),'');
  streamingRecognition.cancelledInputDiscarded=true;
 }
 // Natural completion must release capture just like End session, retaining the chat.
 await page.locator('#stage').hover();await page.click('#mic');
 await page.waitForFunction(()=>document.getElementById('mic').dataset.captureState==='ready');
 await page.waitForFunction(()=>!document.getElementById('panic').hidden);
 // A reply from the preceding microphone check can still be completing.
 // Compare retained history only after that real issued reply has finished.
 await page.waitForFunction(()=>window.fixtureDones.at(-1)?.requestId===window.fixtureRequests.at(-1)?.requestId);
 await page.waitForFunction(()=>!window.bambi.audio.foregroundOutputActive('AI_VOICE')&&document.getElementById('mic').dataset.activity!=='thinking');
 // Simulate the browser suspending RAF in a hidden page. The control timer must
 // complete a session and stop audio without requiring another visual frame.
 await page.evaluate(()=>{
  document.getElementById('ai-mode').value='off';document.getElementById('ai-mode').dispatchEvent(new Event('change',{bubbles:true}));
  window.fixtureRetainedChat=document.getElementById('messages').textContent;
  window.fixtureRAF=window.requestAnimationFrame;window.requestAnimationFrame=()=>0;
  Object.defineProperty(document,'hidden',{value:true,configurable:true});
 });
 await page.waitForTimeout(150);
 await page.evaluate(()=>{window.bambi.director.unlimited=false;window.bambi.director.duration=window.bambi.clock.time+1;});
 await page.waitForFunction(()=>window.bambi.director.state==='FINISHED',null,{polling:50,timeout:5000});
 assert.equal(await page.evaluate(()=>window.bambi.clock.running),false);
 await page.waitForFunction(()=>document.getElementById('mic').dataset.captureState==='muted'&&window.fixtureWorkers.every(worker=>worker.terminated)&&window.fixtureMicStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')));
 assert.equal(await page.evaluate(()=>window.bambi.audio.context.state),'suspended');
 assert.equal(await page.evaluate(()=>document.getElementById('panic').hidden),true);
 assert.equal(await page.evaluate(()=>document.getElementById('messages').textContent===window.fixtureRetainedChat),true,'Natural completion retains the conversation');
 await page.evaluate(async()=>{await Promise.all(window.fixtureMicContexts.map(context=>context.close()));});
 await page.evaluate(()=>{
  window.dispatchEvent(new Event('pagehide'));window.requestAnimationFrame=window.fixtureRAF;delete window.fixtureRAF;delete document.hidden;
  window.dispatchEvent(new Event('pageshow'));
 });
 // Exercise the native adaptive path separately from conversation and finished files.
 // Silent WAVs verify scheduling and presentation, not subjective voice/mix quality.
 let eventRenders=0;const eventRequests=[];
 await page.route('**/api/events/render',async route=>{
  const body=route.request().postDataJSON();
  eventRequests.push(body);
  if(++eventRenders===1){await route.fulfill({status:429,json:{error:'Local voice renderer is busy.'}});return;}
  const eye=body.payloadId.includes(':eye:Blink'),required=body.event.fractionation?.speechA.requiredTrigger??body.event.speech.requiredTrigger;
  const text=eye?'Blink':required??body.event.speech.fixedText??'Stay with this familiar scene.';
  await route.fulfill({json:{payloadId:body.payloadId,text,audio:wav.toString('base64'),durationMs:1000,targetMs:body.event.speech.targetMs,textAttempts:0,words:text.split(' ').map((word,i,all)=>({word,atMs:i/all.length*1000})),...(eye?{cueOffsetMs:0}:{}),...(required?{triggerOffsetMs:0}:{})}});
 });
 await page.evaluate(async()=>{
  document.getElementById('duration').value='1200';document.getElementById('master').value='0';
  document.getElementById('ai-mode').value='voice';document.getElementById('narration-enabled').checked=true;
  document.getElementById('session-events').checked=true;document.getElementById('event-haptics').checked=false;
  document.getElementById('session-events').dispatchEvent(new Event('input',{bubbles:true}));
  await window.bambi.startSession();
 });
 await page.waitForFunction(()=>window.bambi.sessionEvents.active&&window.bambi.sessionEvents.snapshot?.state.motifForm==='ring');
 const forms=new Set(['ring']);let walked=0;
 for(;walked<60&&forms.size<3;walked++){
  await page.waitForFunction(()=>{const event=window.bambi.sessionEvents,next=event.runtime?.compiled.at(-1);return next&&next.event.atMs>window.bambi.clock.time*1000&&next.speech.every(slot=>event.payloads.has(slot.payloadId));},null,{timeout:10000});
  const next=await page.evaluate(()=>{const next=window.bambi.sessionEvents.program.events.at(-1);window.bambi.clock.seek(next.atMs/1000+.01);window.bambi.playbackClock.seek(next.atMs/1000+.01);return next.id;});
  await page.waitForFunction(id=>window.bambi.sessionEvents.snapshot?.eventId===id,next);
  const form=await page.evaluate(()=>window.bambi.sessionEvents.snapshot.state.motifForm);
  if(form&&!forms.has(form)){
   forms.add(form);await page.waitForFunction(form=>document.querySelector('.event-motif').dataset.form===form,form);
   assert.equal(await page.locator('.event-figure svg').count(),1,'Each original motif has one live SVG');
   await page.locator('#stage').screenshot({path:`runtime/adaptive-${form}.png`});
  }
 }
 assert.deepEqual([...forms].sort(),['gears','heart','ring'],'Delivered sessions reach distinct original motif forms');
 await page.locator('#stage').hover();await page.click('#pause');
 await page.waitForFunction(()=>window.bambi.director.paused&&window.bambi.audio.context.state==='suspended');
 const pausedAt=await page.evaluate(()=>window.bambi.clock.time);await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.bambi.clock.time),pausedAt,'Adaptive rhythm and presentation share the paused clock');
 const adaptiveDirector={forms:[...forms],walkedEpisodes:walked,eventRenders,busyRendererRecovered:true,pausedClock:true,scope:'Accelerated native episode boundaries with silent speech fixtures; no subjective listening or physical devices.'};
 await page.evaluate(()=>window.bambi.hardStop(false));
 assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.active),false);
 // Exercise the real server path after the scheduling fixture, using the same
 // browser-generated event request and isolated local AI/TTS stubs.
 const eventRequest=eventRequests.find(request=>request.event.speech.mode==='narrate'&&!request.event.speech.fixedText&&!request.event.speech.requiredTrigger&&!request.event.fractionation&&!request.event.softReturn?.final);
 assert.ok(eventRequest,'Browser supplied a generated narration window');
 const browserCharacter=await page.evaluate(()=>({promptId:document.getElementById('prompt-template').value,persona:document.getElementById('persona').value,collar:document.getElementById('collar-enabled').checked,collarName:document.getElementById('collar-name').value,narrationStyle:document.getElementById('guided-style').value}));
 for(const [key,value] of Object.entries(browserCharacter))assert.deepEqual(eventRequest[key],value,`Event request retains ${key}`);
 const parity=[];
 for(const promptId of ['bambisleep-classic','gentle-induction','custom']){
  const character={promptId,persona:'A curious botanical storyteller.',username:'Explorer',selectedTriggers:['BAMBI SLEEP'],collar:true,collarName:'Shared collar fixture'};
  const response=await fetch(base+'/api/warm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...character,model:'cloud:cydonia-24b-v4.3',interaction:'reactive',speak:false,narration:false})});
  assert.equal(response.status,200,await response.text());
  const prepared=inferenceRequests.at(-1).messages[0].content;
  const marker='=== LANGUAGE & VOICE ===',characterText=prepared.slice(0,prepared.indexOf(marker));
  assert.ok(characterText.length>100,'Preparation received a complete character');
  const rendered=await fetch(base+'/api/events/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...eventRequest,...character,model:'cloud:cydonia-24b-v4.3'})});
  assert.equal(rendered.status,200,await rendered.text());
  const generated=inferenceRequests.at(-1).messages;
  assert.ok(generated[0].content.startsWith(characterText+marker),`Event generation uses the same ${promptId} character`);
  assert.ok(generated[0].content.includes('REAL LISTENER & CONVERSATION EVIDENCE'));
  assert.ok(generated[0].content.includes('EVENT OUTPUT CONTRACT'));
  assert.ok(generated[1].content.includes('FINAL OUTPUT CONTRACT'));
  parity.push(promptId);
 }
 adaptiveDirector.characterParity={characters:parity,browserSelectionPassed:true,realServerWarmAndEventPaths:true};
 assert.deepEqual(errors,[]);const report={scope:'Isolated in-memory database, local chat/silent-WAV speech stubs, real ONNX VAD with synthetic silence'+(realStreaming?', installed CPU streaming recognizer with a public upstream test recording':'')+'; headless browser with simulated hidden-page RAF suspension and replayed obsolete reply messages; no physical microphone, device commands, paid GPU or real Cydonia inference.',setup:true,speechWorker,syntheticMicrophoneStartMute:true,streamingRecognition,studioAudioExportImportPreview:true,mobileLayout:true,cloudChat:true,preparationFailureAndManualRetry:true,voicePlaybackTrace:true,memoryEditorAndClear:true,inlineComposer:true,speechPreservesHoverControls:true,newConversationRetainsMemories:true,stopRejectsLateReply:true,stopBeforeBegin:true,transportWithoutAnimationFrames:true,adaptiveDirector,errors};writeFileSync('runtime/high-impact-browser-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){
 mkdirSync('runtime',{recursive:true});writeFileSync('runtime/high-impact-browser-check.json',JSON.stringify({ok:false,error:String(error),errors,serverLog:logs.slice(-20000)},null,2));throw error;
}finally{
 await browser?.close();app.kill('SIGTERM');await Promise.race([once(app,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);if(app.exitCode===null)app.kill('SIGKILL');stub.closeAllConnections();await new Promise(resolve=>stub.close(resolve));rmSync(fixture,{recursive:true,force:true});
}
