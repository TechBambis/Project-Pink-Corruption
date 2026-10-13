// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {once} from 'node:events';

const root=fileURLToPath(new URL('../',import.meta.url)),realStreaming=process.env.BAMBI_BROWSER_STREAMING==='1';
const streamingFixture=join(root,'.runtime/streaming-speech/test.wav');
if(realStreaming&&!existsSync(streamingFixture))throw Error('Streaming integration needs the public test WAV at .runtime/streaming-speech/test.wav. See docs/LOCAL_AUDIO.md#microphone-recognition.');
const wav=Buffer.alloc(44+32000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
// Allow a realistic display window for each word on the two-core CI runner.
const captionSeconds=2,captionWav=Buffer.alloc(44+32000*captionSeconds);wav.copy(captionWav,0,0,44);captionWav.writeUInt32LE(captionWav.length-8,4);captionWav.writeUInt32LE(captionWav.length-44,40);
const raceWav=Buffer.alloc(44+8000);wav.copy(raceWav,0,0,44);raceWav.writeUInt32LE(raceWav.length-8,4);raceWav.writeUInt32LE(raceWav.length-44,40);
const inferenceRequests=[];
const voiceLabRenders=[];
const nativeMossUrl=process.env.BAMBI_BROWSER_MOSS_URL;
let nativeMossToken;
if(nativeMossUrl){
 const target=new URL(nativeMossUrl);assert.equal(target.protocol,'http:');assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/');assert.equal(target.search,'');assert.equal(target.username,'');assert.equal(target.password,'');
 nativeMossToken=readFileSync(process.env.BAMBI_BROWSER_MOSS_TOKEN_FILE,'utf8').trim();assert.match(nativeMossToken,/^[a-f0-9]{64}$/);
}
async function forwardNativeMoss(path,body,res){
 const controller=new AbortController();res.on('close',()=>controller.abort());
 try{
  const response=await fetch(new URL(path,nativeMossUrl),{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json','X-Bambi-TTS-Token':nativeMossToken},body:JSON.stringify(body)});
  res.statusCode=response.status;
  for(const key of ['content-type','x-audio-duration','x-render-seconds','x-audio-peak','x-audio-provider'])if(response.headers.has(key))res.setHeader(key,response.headers.get(key));
  for await(const bytes of response.body){if(!res.write(bytes))await once(res,'drain');}res.end();
 }catch(error){if(!controller.signal.aborted){res.destroy();throw error;}}
}
let publicOutputRelease;
const waitPublicOutput=()=>new Promise(resolve=>{const timer=setTimeout(finish,10000);function finish(){clearTimeout(timer);if(publicOutputRelease===finish)publicOutputRelease=undefined;resolve();}publicOutputRelease=finish;});
const stub=createServer(async(req,res)=>{
 const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'Cydonia-24B-v4.3'}]}));return;}
 if(req.url==='/v1/audio/voices'){res.end(JSON.stringify({voices:['af_heart','moss_doll_q8']}));return;}
 if(req.url==='/lab/catalog'){res.end(JSON.stringify({voices:['af_heart','af_bella'],presets:Object.fromEntries(['bambi_local_clean','bambi_classic','bambi_classic_deep','bambi_voice_test'].map(id=>[id,JSON.parse(readFileSync(join(root,'presets/audio',id+'.json'),'utf8'))])),calibrationText:'A public comparison.',providers:{kokoro:{label:'Kokoro',available:true,voices:['af_heart','af_bella'],voiceBlending:true},supertonic3:{label:'Supertonic 3',available:true,voices:['F1','F2','F3','F4','F5'],voiceBlending:false},moss:{label:'MOSS reference',available:true,voices:['moss_doll_q8'],voiceBlending:false,wordTimings:false,maxTextLength:1000,labOnly:false},qwen3:{label:'Qwen VoiceDesign',available:true,voices:['doll','brat','tease','custom'],voiceBlending:false,instructions:{doll:'Original adult doll voice.',brat:'Original adult bratty voice.',tease:'Original adult teasing voice.'}}}}));return;}
 if(req.url==='/lab/render'){voiceLabRenders.push(body);if(nativeMossUrl&&body.provider==='moss'){await forwardNativeMoss('/lab/render',body,res);return;}if(body.text==='Delayed public comparison.')await new Promise(resolve=>setTimeout(resolve,1500));res.setHeader('Content-Type','audio/wav');res.setHeader('X-Audio-Duration','1');res.setHeader('X-Render-Seconds','.1');res.setHeader('X-Audio-Peak','.2');res.setHeader('X-Audio-Provider',body.provider??'kokoro');res.end(wav);return;}
 if(req.url==='/dev/captioned_speech'){
  if(body.provider==='moss'){
   if(nativeMossUrl){await forwardNativeMoss('/dev/captioned_speech',body,res);return;}
   res.setHeader('Content-Type','application/x-ndjson');
   if(body.whole_utterance||body.trigger){res.end(JSON.stringify({audio:captionWav.toString('base64'),audio_format:'wav',text:body.input,spoken_seconds:captionSeconds,timestamps:[],history_mode:'complete'})+'\n');return;}
   const id=crypto.randomUUID();
   for(let i=0;i<4;i++)res.write(JSON.stringify({audio:raceWav.toString('base64'),audio_format:'wav',text:i===3?body.input:'',spoken_seconds:.25,timestamps:[],stream:{id,final:i===3,index:i,offset:i*12000,samples:12000,sampleRate:48000,channels:2},history_mode:'complete'})+'\n');
   res.end();return;
  }
  const race=body.input.includes('public race'),seconds=race?.25:captionSeconds;
  if(body.input.includes('delayed public race'))await new Promise(resolve=>setTimeout(resolve,250));
  res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({audio:(race?raceWav:captionWav).toString('base64'),audio_format:'wav',text:body.input,spoken_seconds:seconds,timestamps:body.input.split(' ').map((word,i,all)=>({word,start_time:seconds*i/all.length,end_time:seconds*(i+1)/all.length}))})+'\n');return;}

 if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:JSON.stringify(body.messages)}));return;}
 if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:Array(Math.ceil(body.content.length/4)).fill(1)}));return;}
 if(!body.stream){res.end(JSON.stringify({choices:[{message:{content:'{"action":"adapt"}'}}]}));return;}
 if(req.url==='/v1/chat/completions')inferenceRequests.push(body);
 if(body.messages?.at(-1)?.content==='Public native cancellation fixture.'){
  res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'There is no hurry to decide, so take a moment to think and tell me which option feels more comfortable before we choose the next step together in a calm and steady voice.'}}]})+'\n\ndata: [DONE]\n\n');return;
 }
 if(body.messages?.at(-1)?.content==='Public early clause fixture.'){
  res.setHeader('Content-Type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{content:'I understand what you need, '}}]})+'\n\n');
  await waitPublicOutput();
  res.end('data: '+JSON.stringify({choices:[{delta:{content:'and I will explain the reason clearly. '}}]})+'\n\ndata: [DONE]\n\n');return;
 }
 if(/^Public live race \d+\.$/.test(body.messages?.at(-1)?.content??'')){
  res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'The delayed public race is ready. The next public race follows.'}}]})+'\n\ndata: [DONE]\n\n');return;
 }
 if(body.messages?.at(-1)?.content==='Public live scheduling fixture.'){
  res.setHeader('Content-Type','text/event-stream');
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'The first public thought is complete. '}}]})+'\n\n');
  await new Promise(resolve=>setTimeout(resolve,75));
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'The next public thought follows calmly. '}}]})+'\n\n');
  await waitPublicOutput();
  res.end('data: [DONE]\n\n');return;
 }
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'The color is green.'}}]})+'\n\ndata: [DONE]\n\n');
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');const stubPort=stub.address().port;
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`,errors=[];let browser,logs='';
// A separate working directory excludes private .env files, recordings and caches.
const fixture=mkdtempSync(join(tmpdir(),'bambi-browser-check-'));
for(const name of ['packages','presets','voices','apps','docs','config','node_modules'])
 if(existsSync(join(root,name)))symlinkSync(join(root,name),join(fixture,name),process.platform==='win32'?'junction':'dir');
mkdirSync(join(fixture,'dist'),{recursive:true});
cpSync(join(root,'dist/web'),join(fixture,'dist/web'),{recursive:true});
if(realStreaming){mkdirSync(join(fixture,'.runtime'),{recursive:true});for(const name of ['streaming-stt-venv','streaming-speech'])symlinkSync(join(root,'.runtime',name),join(fixture,'.runtime',name),'dir');}
writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
// All native commands belong to this fixture, including Stop and preparation.
mkdirSync(join(fixture,'scripts'),{recursive:true});
writeFileSync(join(fixture,'scripts/llama-runtime.py'),'print("Simulated native lifecycle")\n');
writeFileSync(join(fixture,'bootstrap.mjs'),`
 import dgram from 'node:dgram';
 import {EventEmitter} from 'node:events';
 dgram.createSocket=()=>{const socket=new EventEmitter();socket.bind=(_p,_h,callback)=>callback?.();socket.unref=()=>socket;socket.send=()=>{};socket.close=()=>{};return socket;};
 await import(${JSON.stringify(new URL('../apps/server/index.ts',import.meta.url).href)});
`);
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^BAMBI_|^OLLAMA_/.test(key)));
const app=spawn(process.execPath,['--import','tsx','bootstrap.mjs'],{cwd:fixture,env:{...inherited,BAMBI_PORT:String(port),BAMBI_DATABASE:':memory:',BAMBI_LLM_URL:`http://127.0.0.1:${stubPort}`,BAMBI_TTS_URL:`http://127.0.0.1:${stubPort}`,BAMBI_CLOUD_URL:`http://127.0.0.1:${stubPort}`,BAMBI_CLOUD_MODEL:'Cydonia-24B-v4.3',BAMBI_CLOUD_CONTEXT:'32768',BAMBI_CLOUD_KIND:'llama.cpp',BAMBI_CLOUD_API_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});
app.stdout.on('data',data=>logs+=data);app.stderr.on('data',data=>logs+=data);
try{
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(app.exitCode!==null)throw Error('Fixture server failed: '+logs);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'Fixture server started');
 // This independent feature check uses an explicitly preconfigured fixture. First-run consent has its own browser check.
 assert.equal((await fetch(base+'/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({microphone:true,devices:true,modelDownloads:false,onlineMedia:false,cloudAI:true,localClock:false,approximateLocation:false,contextToCloud:false})})).status,200);
 browser=await chromium.launch({...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{}),headless:true});
 // Permit only the isolated synthetic microphone and local stub AI used by this fixture.
 const accessResponse=await fetch(base+'/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({microphone:true,devices:false,modelDownloads:false,onlineMedia:false,cloudAI:true,localClock:false,approximateLocation:false,contextToCloud:false})});assert.equal(accessResponse.status,200);
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.stack??String(error)));
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
   socket.onMessage(raw=>{server.send(raw);const data=JSON.parse(String(raw));if(data.type==='playback-start'&&publicOutputRelease){const release=publicOutputRelease;setTimeout(release,250);}});
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
  const OriginalSocket=window.WebSocket;window.fixtureRequests=[];window.fixtureBegins=[];window.fixtureDones=[];window.fixtureSpeechResults=[];window.fixtureSpeechFinishes=[];window.fixtureOutgoing=[];window.fixtureIncoming=[];
  window.WebSocket=class extends OriginalSocket{
   constructor(...args){super(...args);const speech=String(args[0]).endsWith('/ws/speech');if(speech)window.fixtureSpeechSocket=this;else window.fixtureSocket=this;this.addEventListener('message',event=>{const data=JSON.parse(event.data);if(!speech)window.fixtureIncoming.push({type:data.type,id:data.id,seq:data.seq,text:data.text,atMs:performance.now()});if(speech)window.fixtureSpeechResults.push({...data,at:performance.now()});else if(data.type==='begin')window.fixtureBegins.push(data);else if(data.type==='done')window.fixtureDones.push(data);});}
   send(raw){if(typeof raw==='string'){const data=JSON.parse(raw);window.fixtureOutgoing.push({...data,atMs:performance.now()});if(data.type==='chat')window.fixtureRequests.push(data);if(data.type==='finish')window.fixtureSpeechFinishes.push({...data,at:performance.now()});}super.send(raw);}
  };
 });
 await page.goto(base+'/setup');await page.waitForFunction(()=>document.getElementById('readiness').textContent.includes('Cloud AI: ready'));
 // Use the built worker and real local ONNX model with synthetic silence. No microphone or recording.
 const mainAsset=readFileSync(join(fixture,'dist/web/index.html'),'utf8').match(/src="([^\"]*\/main-[^\"]+\.js)"/)[1];
 const workerAsset=readFileSync(join(fixture,'dist/web',mainAsset),'utf8').match(/\/assets\/detector-worker-[\w-]+\.js/)[0];
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
 await page.waitForFunction(()=>document.getElementById('word').textContent===''&&document.getElementById('mic').dataset.activity==='idle');
 // Regression: ready next audio must be scheduled while the first source plays.
 await page.evaluate(()=>{
  window.fixtureLiveSchedule=[];
  const engine=window.bambi.audio,original=engine.playVoice.bind(engine);
  engine.playVoice=(bytes,start,end,...rest)=>original(bytes,(at,duration,word)=>{
   window.fixtureLiveSchedule.push({text:rest[1]?.text,stream:rest[1]?.stream,at,duration,scheduledAt:engine.context.currentTime,wallMs:performance.now()});start(at,duration,word);
  },()=>{window.fixtureLiveSchedule.push({ended:true,wallMs:performance.now()});end();},...rest);
 });
 await page.evaluate(()=>window.bambi.ask('Public live scheduling fixture.'));
 await page.waitForFunction(()=>window.fixtureLiveSchedule.filter(item=>!item.ended).length>=2);
 const liveSchedule=await page.evaluate(()=>window.fixtureLiveSchedule);
 mkdirSync(join(root,'runtime/live-voice-audit'),{recursive:true});
 writeFileSync(join(root,'runtime/live-voice-audit',process.env.BAMBI_LIVE_LABEL||'browser-current')+'.json',JSON.stringify({evidence:'Simulated inference and silent WAV; real browser WebAudio scheduling, no physical output',schedule:liveSchedule},null,2));
 const scheduled=liveSchedule.filter(item=>!item.ended);
 assert.ok(scheduled[1].scheduledAt<scheduled[0].at+scheduled[0].duration-.2,'Next WAV schedules before the first finishes: '+JSON.stringify(liveSchedule));
 assert.ok(!liveSchedule.slice(0,liveSchedule.indexOf(scheduled[1])).some(item=>item.ended),'Preplanning must precede completion ACK');
 await page.waitForFunction(()=>window.fixtureDones.some(d=>d.requestId===window.fixtureRequests.at(-1)?.requestId));
 const liveId=await page.evaluate(()=>window.fixtureBegins.findLast(b=>b.requestId===window.fixtureRequests.at(-1)?.requestId)?.id);
 const liveTraces=await(await fetch(base+'/api/diagnostics/replies')).json(),liveTrace=liveTraces.replies.find(r=>r.id===liveId);
 writeFileSync(join(root,'runtime/live-voice-audit/browser-after.json'),JSON.stringify({evidence:'Production server/browser with simulated inference and silent WAV; output-clock estimates',trace:liveTrace,schedule:liveSchedule},null,2));
 assert.ok(liveTrace.stages['playback-start']<liveTrace.stages.generated,'First output overlaps the still-open generation stream: '+JSON.stringify(liveTrace.stages));
 await page.evaluate(()=>window.bambi.ask('Public early clause fixture.'));
 await page.waitForFunction(()=>window.fixtureDones.some(d=>d.requestId===window.fixtureRequests.at(-1)?.requestId));
 const earlyId=await page.evaluate(()=>window.fixtureBegins.findLast(b=>b.requestId===window.fixtureRequests.at(-1)?.requestId)?.id);
 const earlyTraces=await(await fetch(base+'/api/diagnostics/replies')).json(),earlyTrace=earlyTraces.replies.find(r=>r.id===earlyId);
 assert.ok(earlyTrace.stages['playback-start']<earlyTrace.stages.generated,'A complete comma clause plays before the remainder is generated');
 // Boundary adaptation must cancel the already scheduled, unheard second phrase.
 // Isolate the boundary race from inference admission for the listening planner.
 await page.route('**/api/listen',route=>route.fulfill({json:{action:'adapt'}}));
 await page.evaluate(()=>{document.getElementById('conversation-policy').value='adapt';});
 await page.evaluate(()=>{window.fixtureLiveSchedule=[];window.fixtureOutgoing=[];window.fixtureIncoming=[];window.fixtureClockSchedule=[];const scheduler=window.bambi.playbackClock,original=scheduler.schedule.bind(scheduler);scheduler.schedule=e=>{window.fixtureClockSchedule.push(e);original(e);};});
 await page.evaluate(()=>window.bambi.ask('Public live scheduling fixture.'));
 await page.waitForFunction(()=>window.fixtureLiveSchedule.filter(e=>!e.ended).length>=2&&window.fixtureOutgoing.some(e=>e.type==='playback-start'));
 const obsolete=await page.evaluate(()=>window.fixtureIncoming.find(e=>e.type==='begin').id);
 await page.evaluate(()=>window.bambi.ask('Public correction replacement.'));
 await page.waitForFunction(()=>window.fixtureRequests.at(-1)?.text==='Public correction replacement.');
 const oldOutput=await page.evaluate(id=>window.fixtureOutgoing.filter(e=>e.id===id),obsolete);
 writeFileSync(join(root,'runtime/live-voice-audit/boundary-current.json'),JSON.stringify(await page.evaluate(()=>({events:window.fixtureOutgoing,schedule:window.fixtureClockSchedule,audio:window.fixtureLiveSchedule})),null,2));
 assert.equal(oldOutput.filter(e=>e.type==='playback-start').length,1,'Unheard preplanned successor never emits output evidence');
 assert.ok(oldOutput.some(e=>e.type==='ack'&&e.played===false),'Unheard successor is released as discarded');
 await page.waitForFunction(async()=>{const memory=await(await fetch('/api/memory/export')).json();return memory.turns.some(t=>t.role==='user'&&t.content==='Public correction replacement.');});
 const adaptedMemory=await(await fetch(base+'/api/memory/export')).json();
 const interrupted=adaptedMemory.turns.filter(t=>t.role==='assistant'&&t.interruption==='interrupted').at(-1);
 assert.ok(interrupted?.content.includes('first public thought'));assert.ok(!interrupted.content.includes('next public thought'));
 await page.waitForFunction(()=>window.fixtureDones.some(d=>d.requestId===window.fixtureRequests.at(-1)?.requestId));
 await page.unroute('**/api/listen');
 // MOSS's unaligned packets share one contiguous WebAudio utterance and credit
 // history only once its final packet has reached the output clock.
 await page.evaluate(()=>{window.fixtureLiveSchedule=[];document.getElementById('voice').value='moss_doll_q8';document.getElementById('voice').dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.locator('#voice2').isDisabled(),true);assert.equal(await page.locator('#speed').isDisabled(),true);
 await page.evaluate(()=>window.bambi.ask('Public reference playback fixture.'));
 await page.waitForFunction(()=>window.fixtureLiveSchedule.filter(item=>item.stream).some(item=>item.stream.final));
 const nativeSchedule=await page.evaluate(()=>window.fixtureLiveSchedule.filter(item=>item.stream));
 const nativeOutput=await page.evaluate(()=>window.bambi.audio.nativeSpeechOutput().filter(item=>item.id===window.fixtureLiveSchedule.find(item=>item.stream)?.stream.id));
 assert.equal(nativeOutput.length,nativeSchedule.length);assert.ok(nativeOutput.every(window=>window.gapSeconds===0),'Native sink records no unplanned scheduling gaps');
 assert.ok(nativeSchedule.length>=2);assert.ok(nativeSchedule.slice(0,-1).every(item=>item.text===''));assert.equal(nativeSchedule.at(-1).stream.final,true);
 for(let i=1;i<nativeSchedule.length;i++)assert.ok(Math.abs(nativeSchedule[i].at-nativeSchedule[i-1].at-nativeSchedule[i-1].duration)<.00001,'Native packets meet at their sample boundary');
 await page.waitForFunction(()=>window.fixtureDones.some(d=>d.requestId===window.fixtureRequests.at(-1)?.requestId));
 // Immediate interruption drops native PCM already queued for future output.
 await page.evaluate(()=>{window.fixtureLiveSchedule=[];window.fixtureOutgoing=[];document.getElementById('conversation-policy').value='interrupt';document.getElementById('conversation-policy').dispatchEvent(new Event('change',{bubbles:true}));});
 await page.evaluate(()=>window.bambi.ask('Public native cancellation fixture.'));
 await page.waitForFunction(()=>window.fixtureLiveSchedule.some(e=>e.stream)&&window.fixtureOutgoing.some(e=>e.type==='playback-start'));
 const nativeOldId=await page.evaluate(()=>window.fixtureBegins.at(-1).id);
 const nativeStop=await page.evaluate(async()=>{
  const engine=window.bambi.audio,original=engine.stopVoice.bind(engine);let stop;
  engine.stopVoice=(...args)=>{const time=engine.context.currentTime,count=engine.voiceSources.size;original(...args);if(count&&!stop)stop={sourceCount:count,remainingSources:engine.voiceSources.size,streamCleared:engine.nativeVoiceStream===undefined,scheduledFadeSeconds:.035,atMs:performance.now()};};
  try{await window.bambi.ask('Public native recovery fixture.');return stop;}finally{engine.stopVoice=original;}
 });
 assert.ok(nativeStop.sourceCount>0);assert.equal(nativeStop.remainingSources,0);assert.equal(nativeStop.streamCleared,true);
 await page.waitForFunction(()=>window.fixtureRequests.at(-1)?.text==='Public native recovery fixture.');
 await page.waitForFunction(()=>window.fixtureDones.some(d=>d.requestId===window.fixtureRequests.at(-1)?.requestId));
 const nativeOldEvents=await page.evaluate(id=>window.fixtureOutgoing.filter(e=>e.id===id||e.playback?.id===id),nativeOldId);
 const interruptedNative=nativeOldEvents.find(e=>e.type==='interrupt');assert.ok(interruptedNative);assert.deepEqual(interruptedNative.playback.chunks,[],'Incomplete native text receives no estimated word credit');
 assert.ok(nativeOldEvents.some(e=>e.type==='ack'&&e.played===false));
 assert.ok(!nativeOldEvents.some(e=>e.type==='playback-start'&&e.atMs>nativeStop.atMs));
 const nativeMemory=await(await fetch(base+'/api/memory/export')).json();assert.ok(!nativeMemory.turns.some(t=>t.role==='assistant'&&t.content.includes('which option feels more comfortable')));
 const nativeRecovery=await page.evaluate(()=>window.fixtureLiveSchedule.filter(e=>e.stream).findLast(e=>e.stream.final));assert.ok(nativeRecovery?.text.includes('green'));
 writeFileSync(join(root,'runtime/live-voice-audit/moss-browser-fixture.json'),JSON.stringify({scope:nativeMossUrl?'Real app/browser and registered native MOSS PCM, simulated local LLM; no 9B load, human voice-quality or physical-output qualification':'Real app/browser, simulated silent native packets, no voice-quality or physical-output claim',schedule:nativeSchedule,outputWindows:nativeOutput,cancellation:{scope:'Software scheduling and conservative history only; no audible-stop percentile claim',stop:nativeStop,discardedAcks:nativeOldEvents.filter(e=>e.type==='ack'&&!e.played).length,lateStarts:0,unfinishedHistoryChars:0,recoveryCompleted:true}},null,2));
 await page.evaluate(()=>{document.getElementById('voice').value='af_heart';document.getElementById('voice').dispatchEvent(new Event('input',{bubbles:true}));});
 // Explicit Pause freezes output evidence and buffer seconds; Resume releases it.
 await page.evaluate(()=>{window.fixtureOutgoing=[];window.fixtureLiveSchedule=[];});
 await page.evaluate(()=>window.bambi.ask('Public live scheduling fixture.'));
 await page.waitForFunction(()=>window.fixtureOutgoing.some(e=>e.type==='playback-start'));
 await page.evaluate(()=>document.getElementById('pause').click());
 await page.waitForFunction(()=>window.bambi.director.paused&&window.bambi.audio.context.state==='suspended');
 const pauseAcks=await page.evaluate(()=>window.fixtureOutgoing.filter(e=>e.type==='ack'&&e.played).length);
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>window.fixtureOutgoing.filter(e=>e.type==='ack'&&e.played).length),pauseAcks,'Suspended audio cannot commit unheard text');
 assert.equal(await page.evaluate(()=>window.fixtureOutgoing.findLast(e=>e.type==='playback-buffer')?.running),false);
 await page.evaluate(()=>document.getElementById('pause').click());
 await page.waitForFunction(()=>window.fixtureDones.some(d=>d.requestId===window.fixtureRequests.at(-1)?.requestId));
 if(process.argv.includes('--live-races')){
  const races=[];
  for(let episode=0;episode<100;episode++){
   const phase=episode%5;
   await page.evaluate(()=>{window.fixtureOutgoing=[];window.fixtureIncoming=[];window.fixtureLiveSchedule=[];});
   await page.evaluate(i=>window.bambi.ask(`Public live race ${i}.`),episode);
   if(phase===1)await page.waitForFunction(()=>window.fixtureIncoming.some(e=>e.type==='begin'));
   if(phase===2)await page.waitForFunction(()=>window.fixtureLiveSchedule.some(e=>!e.ended));
   if(phase===3){await page.waitForFunction(()=>window.fixtureOutgoing.some(e=>e.type==='playback-start'));await page.waitForTimeout(35);}
   if(phase===4){await page.waitForFunction(()=>window.fixtureOutgoing.some(e=>e.type==='playback-start'));await page.waitForTimeout(275);}
   const stopped=await page.evaluate(()=>{const id=window.fixtureIncoming.find(e=>e.type==='begin')?.id;window.bambi.hardStop();return {id,atMs:performance.now(),text:document.getElementById('composer-reply').textContent};});
   await page.waitForTimeout(30);
   const stale=await page.evaluate(({id,atMs})=>({ack:window.fixtureOutgoing.filter(e=>e.type==='ack'&&e.id===id&&e.played&&e.atMs>atMs),started:window.fixtureOutgoing.filter(e=>e.type==='playback-start'&&e.id===id&&e.atMs>atMs),running:window.bambi.director.active,caption:document.getElementById('word').textContent}),stopped);
   assert.deepEqual(stale.ack,[]);assert.deepEqual(stale.started,[]);assert.equal(stale.running,false);assert.equal(stale.caption,'');
   races.push({episode,phase:['before-begin','before-first-WAV','before-output-cue','mid-word','tail'][phase],discardedAfterStop:true});
  }
  // A follow-on reply must remain audible/schedulable after all old queues were cancelled.
  await page.evaluate(()=>window.bambi.ask('Public live scheduling fixture.'));
  await page.waitForFunction(()=>window.fixtureLiveSchedule.filter(e=>!e.ended&&e.text?.includes('public thought')).length>=2);
  await page.waitForFunction(()=>window.fixtureDones.some(d=>d.requestId===window.fixtureRequests.at(-1)?.requestId));
  writeFileSync(join(root,'runtime/live-voice-audit/browser-races.json'),JSON.stringify({evidence:'Production browser/server with simulated text and WAV; no physical devices',episodes:races,followOnReply:true},null,2));
 }
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
 // The reveal class precedes the dock's CSS visibility transition. Check the
 // rendered controls while the long speech fixture is still playing.
 await page.locator('#chat-form').waitFor({state:'visible',timeout:5000});
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
 let streamingRecognition=null,listenerResponseCapture=null;
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
  // A spoken response belongs to its authored window, including a capture that
  // finishes after that window. Exercise the actual microphone callbacks.
  await page.evaluate(async()=>{
   const state={activeLayers:[],foreground:null,density:{intensity:0,effectDensity:0,speechDensity:0,audioDensity:0,visualDensity:0},visualState:'black',narrationState:'paused',ambientState:'silent',scene:'Spiral Focus'};
   const transition={kind:'hard_cut',durationMs:0,subtitle:'clear'};
   const event={id:'response-fixture',type:'silence',phase:'induction',atMs:0,timing:{prepMs:0,activeMs:1000,returnMs:0},state,baseline:state,speech:{mode:'silent',targetMs:0,instruction:''},audio:[],visual:[],haptics:[],entry:transition,exit:transition};
   await window.bambi.sessionEvents.prepare(5000,.2,new AbortController().signal,{version:1,durationMs:5000,baseline:state,motifs:[],events:[event],responseWindows:[{fromMs:0,toMs:1000}]});
   window.responseClock={time:window.bambi.clock.time,running:window.bambi.clock.running};window.bambi.clock.seek(0);window.bambi.sessionEvents.start();
   window.responseBefore={requests:window.fixtureRequests.length,results:window.fixtureSpeechResults.length};
   window.responseCommands=[];window.responseSend=window.fixtureSocket.send;
   window.fixtureSocket.send=function(raw){if(typeof raw==='string')window.responseCommands.push(JSON.parse(raw).type);return window.responseSend.call(this,raw);};
   const worker=window.fixtureWorkerInstances.at(-1);worker.onmessage({data:{type:'event',epoch:worker.fixture.epoch,event:{msg:'SPEECH_REAL_START'}}});
   worker.onmessage({data:{type:'event',epoch:worker.fixture.epoch,event:{msg:'FRAME_PROCESSED',frame:new Float32Array(512),probs:{isSpeech:1,notSpeech:0}}}});
   window.bambi.clock.seek(2);
  });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.active&&window.bambi.sessionEvents.overrideUntilMs===0),true,'Speaking in the response window does not interrupt the event owner');
  await page.evaluate(()=>{const worker=window.fixtureWorkerInstances.at(-1);worker.onmessage({data:{type:'event',epoch:worker.fixture.epoch,event:{msg:'SPEECH_END',audio:new Float32Array(16000)}}});});
  await page.waitForTimeout(250);
  listenerResponseCapture=await page.evaluate(()=>({noChat:window.fixtureRequests.length===window.responseBefore.requests,noRecognition:window.fixtureSpeechResults.length===window.responseBefore.results,noInterrupt:!window.responseCommands.includes('interrupt'),finishesOutsideWindow:!window.bambi.sessionEvents.listenerResponseAt(window.bambi.clock.time*1000)}));
  assert.deepEqual(listenerResponseCapture,{noChat:true,noRecognition:true,noInterrupt:true,finishesOutsideWindow:true});
  await page.evaluate(()=>{window.fixtureSocket.send=window.responseSend;window.bambi.sessionEvents.stop();window.bambi.clock.seek(window.responseClock.time);if(window.responseClock.running)window.bambi.clock.start();});
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
 for(const promptId of ['bambisleep-classic','gentle-induction','english-conversation','custom']){
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
 // Voice Lab shares the real proxy, with public synthetic WAVs and no profile writes.
 const lab=await browser.newPage();lab.on('pageerror',error=>errors.push(String(error)));
 await lab.route('**/api/preferences',route=>route.fulfill({json:{voice:'af_heart',speed:'0.78','audio-preset':'bambi_local_clean','dual-voice':true,'background-drone':false,'background-noise':false}}));
 await lab.goto(base+'/voice-lab');await lab.waitForFunction(()=>!document.getElementById('provider').disabled);
 await lab.click('#session-voice');await lab.waitForFunction(()=>document.getElementById('pitch').value==='-2');
 await lab.fill('#text','A public comparison.');await lab.click('#render-a');await lab.waitForFunction(()=>!document.getElementById('download-a').hidden);
 assert.equal(voiceLabRenders.at(-1).provider,'kokoro');assert.equal(voiceLabRenders.at(-1).overrides.pitchSemitones,-2);
 const firstAudio=await lab.locator('#audio-a').getAttribute('src');
 await lab.locator('details summary').click();
 const blend=await lab.locator('#config').inputValue();await lab.fill('#config',JSON.stringify({...JSON.parse(blend),voice:'af_heart:0.6 + af_bella:0.4'}));await lab.click('#apply-config');
 assert.equal(await lab.locator('#voice').inputValue(),'af_heart');assert.equal(await lab.locator('#voice2').inputValue(),'af_bella');assert.equal(await lab.locator('#weight').inputValue(),'0.4');
 await lab.selectOption('#provider','supertonic3');await lab.selectOption('#voice','F3');await lab.selectOption('#quality','4');await lab.click('#soft-bright');
 assert.equal(await lab.locator('#voice2').isDisabled(),true);assert.equal(await lab.locator('#use-preset').isDisabled(),true);
 await lab.click('#render-b');await lab.waitForFunction(()=>!document.getElementById('download-b').hidden);
 assert.equal(voiceLabRenders.at(-1).provider,'supertonic3');assert.equal(voiceLabRenders.at(-1).steps,4);
 assert.equal(voiceLabRenders.at(-1).seed,41);assert.equal(voiceLabRenders.at(-1).phraseMode,'sentences');
 assert.equal(voiceLabRenders.at(-1).overrides.voice,'F3');assert.equal(voiceLabRenders.at(-1).overrides.pitchSemitones,1.5);
 assert.ok((await lab.locator('#label-b').textContent()).includes('Supertonic 3 / F3 / 4 steps'));
 await lab.selectOption('#provider','kokoro');assert.equal(await lab.locator('#pitch').inputValue(),'-2');
 assert.equal(await lab.locator('#voice').inputValue(),'af_heart');assert.equal(await lab.locator('#use-preset').isDisabled(),false);
 assert.equal(await lab.locator('#audio-a').getAttribute('src'),firstAudio);
 await lab.selectOption('#provider','supertonic3');assert.equal(await lab.locator('#voice').inputValue(),'F3');assert.equal(await lab.locator('#quality').inputValue(),'4');
 await lab.fill('#text','Keep my own words.');await lab.selectOption('#attitude','brat');await lab.click('#apply-attitude');
 assert.equal(await lab.locator('#text').inputValue(),'Keep my own words.');assert.equal(await lab.locator('#speed').inputValue(),'1.08');assert.equal(await lab.locator('#processing').isChecked(),false);
 await lab.click('#audition-text');assert.ok((await lab.locator('#text').inputValue()).includes('<sigh>'));
 await lab.click('#new-take');await lab.uncheck('#sentence-delivery');
 await lab.selectOption('#provider','kokoro');assert.equal(await lab.locator('#expression-controls').isVisible(),false);
 await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);await lab.click('#render-b');await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);
 assert.ok(!voiceLabRenders.at(-1).text.includes('<sigh>'));assert.equal(voiceLabRenders.at(-1).phraseMode,undefined);
 await lab.selectOption('#provider','supertonic3');assert.equal(await lab.locator('#take-seed').inputValue(),'42');assert.equal(await lab.locator('#sentence-delivery').isChecked(),false);assert.equal(await lab.locator('#attitude').inputValue(),'brat');
 await lab.click('#render-b');await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);
 assert.equal(voiceLabRenders.at(-1).seed,42);assert.equal(voiceLabRenders.at(-1).phraseMode,'clauses');assert.ok(voiceLabRenders.at(-1).text.includes('<sigh>'));
 assert.ok((await lab.locator('#label-b').textContent()).includes('take 42 / clauses'));
 const originalWords=await lab.locator('#text').inputValue();await lab.click('#natural-baseline');
 assert.equal(await lab.locator('#text').inputValue(),originalWords);assert.equal(await lab.locator('#voice').inputValue(),'F3');assert.equal(await lab.locator('#pitch').inputValue(),'0');assert.equal(await lab.locator('#native-expressions').isChecked(),false);
 await lab.click('#render-b');await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);
 assert.ok(!voiceLabRenders.at(-1).text.includes('<sigh>'));assert.equal(voiceLabRenders.at(-1).overrides.sampleRate,44100);assert.equal(voiceLabRenders.at(-1).steps,10);
 await lab.selectOption('#expression-test','laugh');await lab.click('#load-expression-test');
 assert.equal(await lab.locator('#native-expressions').isChecked(),true);assert.ok((await lab.locator('#text').inputValue()).includes('<laugh> <laugh>!'));
 await lab.selectOption('#provider','qwen3');assert.equal(await lab.locator('#qwen-controls').isVisible(),true);
 assert.equal(await lab.locator('#speed').inputValue(),'1');assert.equal(await lab.locator('#speed').isDisabled(),true);
 assert.equal(await lab.locator('#pitch').inputValue(),'0');assert.equal(await lab.locator('#voice2').isDisabled(),true);
 assert.equal(await lab.locator('#use-preset').isDisabled(),true);assert.equal(await lab.locator('#left-layer').isDisabled(),true);
 await lab.selectOption('#voice','brat');assert.equal(await lab.locator('#qwen-instruct').inputValue(),'Original adult bratty voice.');
 await lab.click('#qwen-audition-text');assert.ok(!(await lab.locator('#text').inputValue()).includes('<sigh>'));
 await lab.fill('#qwen-instruct','Adult feminine voice, girly and sarcastic, lively intonation.');
 assert.equal(await lab.locator('#voice').inputValue(),'custom');await lab.click('#qwen-new-take');await lab.selectOption('#qwen-backend','CPU');
 await lab.click('#render-b');await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);
 assert.equal(voiceLabRenders.at(-1).provider,'qwen3');assert.equal(voiceLabRenders.at(-1).seed,42);
 assert.equal(voiceLabRenders.at(-1).backend,'CPU');assert.equal(voiceLabRenders.at(-1).phraseMode,'passage');
 assert.equal(voiceLabRenders.at(-1).instruct,'Adult feminine voice, girly and sarcastic, lively intonation.');
 assert.equal(voiceLabRenders.at(-1).overrides.voice,'custom');assert.equal(voiceLabRenders.at(-1).overrides.speed,1);
 assert.ok((await lab.locator('#label-b').textContent()).includes('Qwen VoiceDesign / custom / take 42 / CPU'));
 await lab.selectOption('#provider','kokoro');assert.equal(await lab.locator('#pitch').inputValue(),'-2');
 await lab.selectOption('#provider','supertonic3');assert.equal(await lab.locator('#voice').inputValue(),'F3');
 await lab.selectOption('#provider','qwen3');assert.equal(await lab.locator('#qwen-seed').inputValue(),'42');
 assert.equal(await lab.locator('#qwen-instruct').inputValue(),'Adult feminine voice, girly and sarcastic, lively intonation.');
 assert.equal(await lab.locator('#qwen-backend').inputValue(),'CPU');assert.equal(await lab.locator('#audio-a').getAttribute('src'),firstAudio);
 assert.equal(await lab.locator('#qwen-delivery').inputValue(),'passage');
 await lab.selectOption('#qwen-delivery','sentences');await lab.click('#render-b');await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);
 assert.equal(voiceLabRenders.at(-1).phraseMode,'sentences');
 await lab.selectOption('#provider','supertonic3');await lab.selectOption('#provider','qwen3');
 assert.equal(await lab.locator('#qwen-delivery').inputValue(),'sentences');
 await lab.selectOption('#qwen-delivery','passage');
 await lab.selectOption('#provider','moss');
 assert.equal(await lab.locator('#voice').inputValue(),'moss_doll_q8');
 for(const id of ['voice2','speed','pitch','processing','left-layer'])assert.equal(await lab.locator('#'+id).isDisabled(),true);
 assert.equal(await lab.locator('#use-preset').isDisabled(),false);
 await lab.fill('#text','A public reference comparison.');await lab.fill('#moss-seed','42');await lab.click('#render-b');await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);
 assert.equal(voiceLabRenders.at(-1).provider,'moss');assert.equal(voiceLabRenders.at(-1).seed,42);
 assert.equal(voiceLabRenders.at(-1).overrides.sampleRate,48000);assert.equal(voiceLabRenders.at(-1).overrides.processing.enabled,false);
 assert.equal(voiceLabRenders.at(-1).overrides.layers.left_voice.voice,'moss_doll_q8');
 assert.ok((await lab.locator('#label-b').textContent()).includes('take 42'));
 await lab.selectOption('#provider','qwen3');
 // Each A/B label belongs to the immutable request, even if controls change.
 await lab.fill('#text','Delayed public comparison.');await lab.click('#render-b');
 await lab.selectOption('#provider','kokoro');await lab.waitForFunction(()=>!document.getElementById('render-b').disabled);
 assert.ok((await lab.locator('#label-b').textContent()).includes('Qwen VoiceDesign / custom / take 42 / CPU'));
 await lab.waitForFunction(()=>!document.getElementById('render-a').disabled);
 await lab.fill('#text','Delayed public comparison.');const count=voiceLabRenders.length;await lab.click('#render-a');
 for(let i=0;i<30&&voiceLabRenders.length===count;i++)await lab.waitForTimeout(50);
 assert.ok(voiceLabRenders.length>count);await lab.click('#cancel');await lab.waitForFunction(()=>document.getElementById('cancel').hidden);
 await lab.waitForTimeout(1600);assert.equal(await lab.locator('#audio-a').getAttribute('src'),firstAudio);
 assert.ok((await lab.locator('#status').textContent()).includes('canceled'));await lab.close();
 assert.deepEqual(errors,[]);const report={nativeMoss:!!nativeMossUrl,scope:'Isolated in-memory database, local chat/silent-WAV speech stubs, real ONNX VAD with synthetic silence'+(realStreaming?', installed CPU streaming recognizer with a public upstream test recording':'')+'; headless browser with simulated hidden-page RAF suspension and replayed obsolete reply messages; no physical microphone, device commands, paid GPU or real Cydonia inference.',setup:true,speechWorker,syntheticMicrophoneStartMute:true,streamingRecognition,listenerResponseCapture,studioAudioExportImportPreview:true,mobileLayout:true,cloudChat:true,preparationFailureAndManualRetry:true,voicePlaybackTrace:true,memoryEditorAndClear:true,inlineComposer:true,speechPreservesHoverControls:true,newConversationRetainsMemories:true,stopRejectsLateReply:true,stopBeforeBegin:true,transportWithoutAnimationFrames:true,adaptiveDirector,errors};writeFileSync('runtime/high-impact-browser-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){
 mkdirSync('runtime',{recursive:true});writeFileSync('runtime/high-impact-browser-check.json',JSON.stringify({ok:false,error:String(error),errors,serverLog:logs.slice(-20000)},null,2));throw error;
}finally{
 await browser?.close();app.kill('SIGTERM');await Promise.race([once(app,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);if(app.exitCode===null)app.kill('SIGKILL');stub.closeAllConnections();await new Promise(resolve=>stub.close(resolve));rmSync(fixture,{recursive:true,force:true});
}
