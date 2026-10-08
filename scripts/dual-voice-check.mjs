// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

// Production server/client with deterministic inference and WAV fixtures.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtempSync,symlinkSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url)),requests=[];
function wav(spoken,pause){
 const rate=24000,frames=Math.ceil((spoken+pause)*rate),bytes=Buffer.alloc(44+frames*2);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
 for(let i=0;i<spoken*rate;i++)bytes.writeInt16LE(Math.round(Math.sin(2*Math.PI*220*i/rate)*1000),44+i*2);
 return bytes.toString('base64');
}
const stub=createServer(async(req,res)=>{
 const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'fixture'}]}));return;}
 if(req.url==='/v1/audio/voices'){res.end(JSON.stringify({voices:['af_heart','af_bella','bambi_classic']}));return;}
 if(req.url==='/dev/captioned_speech'){
  requests.push(body);const background=body.voice==='af_bella',text=body.input.replace(/\[[^\]]*\]/g,'').trim(),spoken=background?.6:.3,pause=background?0:1.5;
  res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({audio:wav(spoken,pause),audio_format:'wav',text,spoken_seconds:spoken,pause_ms:pause*1000,timestamps:text.split(' ').map((word,i,all)=>({word,start_time:i/all.length*spoken,end_time:(i+1)/all.length*spoken}))})+'\n');return;
 }
 if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:JSON.stringify(body.messages)}));return;}
 if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:Array(Math.ceil(body.content.length/4)).fill(1)}));return;}
 res.setHeader('Content-Type','text/event-stream');
 const content='[turn:guide] [owner] Rest here. [pause:long] [bambi:…so warm…] [owner] Stay here. [pause:long] [bambi] I feel soft. [owner] Rest.';
 for(const text of content){res.write('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n');}
 res.end('data: [DONE]\n\n');
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');const stubPort=stub.address().port;
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const fixture=mkdtempSync(join(tmpdir(),'bambi-dual-voice-'));
for(const name of ['packages','presets','voices','apps','docs','dist','config','scripts','node_modules'])symlinkSync(join(root,name),join(fixture,name),'dir');
writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
writeFileSync(join(fixture,'bootstrap.mjs'),`
 import dgram from 'node:dgram';import {EventEmitter} from 'node:events';
 dgram.createSocket=()=>{const socket=new EventEmitter();socket.bind=(_p,_h,callback)=>callback?.();socket.unref=()=>socket;socket.send=()=>{};socket.close=()=>{};return socket;};
 await import(${JSON.stringify(new URL('../apps/server/index.ts',import.meta.url).href)});
`);
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^BAMBI_|^OLLAMA_/.test(key)));
const app=spawn(process.execPath,['--import','tsx','bootstrap.mjs'],{cwd:fixture,env:{...inherited,BAMBI_PORT:String(port),BAMBI_DATABASE:':memory:',BAMBI_TTS_URL:`http://127.0.0.1:${stubPort}`,BAMBI_CLOUD_URL:`http://127.0.0.1:${stubPort}`,BAMBI_CLOUD_MODEL:'fixture',BAMBI_CLOUD_CONTEXT:'32768',BAMBI_CLOUD_KIND:'llama.cpp',BAMBI_CLOUD_DEFAULT:'true',BAMBI_CLOUD_API_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});
let logs='',browser;app.stdout.on('data',data=>logs+=data);app.stderr.on('data',data=>logs+=data);
const base=`http://127.0.0.1:${port}`,errors=[],events=[];
try{
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(app.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'Fixture server started');
 browser=await chromium.launch({headless:true,...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(String(error)));
 page.on('websocket',socket=>socket.on('framereceived',frame=>{try{events.push(JSON.parse(String(frame.payload)));}catch{}}));
 await page.route('**/api/warm',route=>route.fulfill({json:{ok:true}}));
 await page.addInitScript(()=>localStorage.setItem('bambi-profile',JSON.stringify({'dialogue-version':1,'conversation-style':'situational','narration-enabled':false,'session-events':false,'mode':'conversation','ai-mode':'voice','voice':'bambi_classic','audio-preset':'bambi_classic','model':'cloud:cydonia-24b-v4.3','master':0,'voice-echoes':true})));
 await page.goto(base+'/');await page.waitForFunction(()=>!!window.bambi&&document.getElementById('connection').textContent==='Connected locally');
 assert.equal(await page.locator('#dual-voice').isChecked(),false);
 await page.evaluate(()=>{location.hash='voice';document.getElementById('voice-blend-settings').open=true;});
 await page.evaluate(()=>{const select=document.getElementById('model');select.value='cloud:cydonia-24b-v4.3';select.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('#dual-voice').check();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('bambi-profile'))['dual-voice']===true);
 mkdirSync(join(root,'runtime'),{recursive:true});await page.screenshot({path:join(root,'runtime/dual-voice-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(root,'runtime/dual-voice-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 await page.evaluate(async()=>{
  await window.bambi.startSession();window.fixtureVoices=[];
  const engine=window.bambi.audio,original=engine.playVoice.bind(engine);
  engine.playVoice=(bytes,start,end,trigger,script)=>{const before=engine.dualGapStart,queueBefore=engine.voicesEnd,now=engine.context.currentTime;return original(bytes,(at,duration,word)=>{window.fixtureVoices.push({track:script?.voiceTrack,start:at,duration,spoken:script?.spokenSeconds,scheduledFromPast:at<now+.034});start(at,duration,word);},end,trigger,script);};
  await window.bambi.ask('Dual voice fixture.',true);
 });
 try{await page.waitForFunction(()=>window.fixtureVoices.length===5,{timeout:10000});}catch(error){console.error(JSON.stringify({voices:await page.evaluate(()=>window.fixtureVoices),status:await page.locator('#ai-status').textContent(),notices:await page.locator('[role=alert],.notice-banner').allTextContents(),events:events.map(e=>({type:e.type,text:e.text,notice:e.text,track:e.voice_track})),requests:requests.map(r=>({input:r.input,voice:r.voice,speed:r.speed}))}));throw error;}await page.waitForFunction(()=>window.bambi.audio.voiceSources.size===0);await page.waitForFunction(()=>document.getElementById('ai-status').textContent==='Your Bambi companion');
 const voices=await page.evaluate(()=>window.fixtureVoices);
 assert.deepEqual(voices.map(v=>v.track.speaker),['owner','bambi','owner','bambi','owner']);
 assert.deepEqual(voices.filter(v=>v.track.speaker==='bambi').map(v=>[v.track.gainDb,v.track.pan]),[[-14,-.3],[-14,.3]]);
 for(let i=1;i<voices.length;i++){assert.ok(voices[i].start>=voices[i-1].start+voices[i-1].spoken-.002,'Spoken tracks do not overlap');if(voices[i].track.speaker==='owner')assert.ok(voices[i].start>=voices[i-1].start+voices[i-1].spoken+.2-.002,'Owner waits for room tail');assert.equal(voices[i].scheduledFromPast,false,'Every fragment is scheduled ahead on the audio clock');}
 assert.ok(voices[1].start>=voices[0].start+voices[0].spoken-.002,'The voices never speak at once');assert.ok(voices[1].start<=voices[0].start+voices[0].duration+.15,'Late background speech begins directly after the reserved pause');
 assert.ok(events.some(e=>e.type==='done'&&e.audioComplete)||await page.locator('#ai-status').textContent()==='Your Bambi companion');assert.ok(requests.every(r=>!r.input.includes('[owner')&&!r.input.includes('[bambi')));
 await page.locator('#dual-voice').uncheck();
 const before=events.length;await page.evaluate(()=>window.bambi.ask('Dual voice fixture.',true));
 await page.waitForFunction(()=>window.fixtureVoices.length===8);await page.waitForFunction(()=>window.bambi.audio.voiceSources.size===0);
 assert.ok(events.slice(before).filter(e=>e.type==='audio').every(e=>!e.voice_track&&e.text!=='so warm'&&e.text!=='I feel soft.'));
 await page.locator('#dual-voice').check();await page.evaluate(()=>window.bambi.ask('Dual voice fixture.',true));
 await page.waitForFunction(()=>window.fixtureVoices.length>=10);await page.evaluate(()=>window.bambi.hardStop());
 assert.equal(await page.evaluate(()=>window.bambi.audio.voiceSources.size),0);assert.equal(await page.evaluate(()=>window.bambi.audio.dualVoiceCleanup.size),0);
 const profile=await(await fetch(base+'/api/preferences')).json();assert.equal(typeof profile['dual-voice'],'boolean');assert.deepEqual(errors,[]);
 const report={ok:true,voices,ttsRequests:requests.length,errors};writeFileSync(join(root,'runtime/dual-voice-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();app.kill('SIGTERM');await once(app,'exit').catch(()=>{});await new Promise(resolve=>stub.close(resolve));rmSync(fixture,{recursive:true,force:true});}
