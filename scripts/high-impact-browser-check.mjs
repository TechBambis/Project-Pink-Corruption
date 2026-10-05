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

const wav=Buffer.alloc(44+32000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
const stub=createServer(async(req,res)=>{
 const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'Cydonia-24B-v4.3'}]}));return;}
 if(req.url==='/v1/audio/voices'){res.end(JSON.stringify({voices:['af_heart']}));return;}
 if(req.url==='/lab/render'){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
 if(req.url==='/dev/captioned_speech'){res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({audio:wav.toString('base64'),audio_format:'wav',text:body.input,spoken_seconds:1,timestamps:body.input.split(' ').map((word,i,all)=>({word,start_time:i/all.length,end_time:(i+1)/all.length}))})+'\n');return;}
 if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:JSON.stringify(body.messages)}));return;}
 if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:Array(Math.ceil(body.content.length/4)).fill(1)}));return;}
 if(!body.stream){res.end(JSON.stringify({choices:[{message:{content:'{"action":"adapt"}'}}]}));return;}
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'The color is green.'}}]})+'\n\ndata: [DONE]\n\n');
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');const stubPort=stub.address().port;
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`,errors=[];let browser,logs='';
// A separate working directory excludes private .env files, recordings and caches.
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=mkdtempSync(join(tmpdir(),'bambi-browser-check-'));
for(const name of ['packages','presets','voices','apps','docs','dist','config','scripts','node_modules'])
 if(existsSync(join(root,name)))symlinkSync(join(root,name),join(fixture,name),process.platform==='win32'?'junction':'dir');
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
 browser=await chromium.launch({...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{}),headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(String(error)));
 // Model warming is covered separately; this check never invokes an installed local model.
 await page.route('**/api/warm',route=>route.fulfill({json:{ok:true}}));
 await page.goto(base+'/setup');await page.waitForFunction(()=>document.getElementById('readiness').textContent.includes('Cloud AI: ready'));
 await page.goto(base+'/studio');await page.selectOption('#kind','caption');await page.fill('#text','A quiet test moment.');await page.click('#add');await page.waitForFunction(()=>document.querySelector('#cues')?.textContent.includes('A quiet test moment.'));
 await page.selectOption('#kind','speech');await page.fill('#time','2');await page.fill('#text','A rendered fixture passage.');await page.click('#add');await page.waitForFunction(()=>document.querySelector('#cues')?.textContent.includes('A rendered fixture passage.'));
 const downloadPromise=page.waitForEvent('download');await page.click('#export');const download=await downloadPromise;assert.equal(download.suggestedFilename(),'session.bambi.json');
 const path=await download.path();assert.equal(JSON.parse(readFileSync(path,'utf8')).assets.length,1);await page.setInputFiles('#import',path);await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Package opened'));
 await page.click('#preview');await page.waitForFunction(()=>document.getElementById('caption').textContent==='A quiet test moment.');await page.click('#stop');assert.equal(await page.locator('#clock').textContent(),'00:00');
 mkdirSync('runtime',{recursive:true});await page.screenshot({path:'runtime/session-studio-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'runtime/session-studio-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});await page.goto(base+'/');await page.waitForFunction(()=>!!window.bambi&&[...document.getElementById('model').options].some(option=>option.value==='cloud:cydonia-24b-v4.3')&&document.getElementById('connection').textContent==='Connected locally');
 // Settings panels are intentionally collapsed; configure through the same change events.
 await page.evaluate(()=>{for(const [id,value] of [['model','cloud:cydonia-24b-v4.3'],['mode','conversation'],['ai-mode','text']]){const select=document.getElementById(id);select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}});
 await page.evaluate(async()=>{await fetch('/api/memory/facts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'color',value:'green'})});await window.bambi.ask('What color did I choose?');});
 try{await page.waitForFunction(()=>document.querySelector('#messages')?.textContent.includes('The color is green.'));}catch(error){console.error(await page.evaluate(()=>({status:document.getElementById('ai-status').textContent,model:document.getElementById('model').value,notices:[...document.querySelectorAll('[role="status"]')].map(node=>node.textContent),messages:document.getElementById('messages').textContent})));throw error;}
 const memory=await(await fetch(base+'/api/memory')).json();assert.equal(memory.facts[0].value,'green');assert.ok(memory.turns.some(turn=>turn.role==='assistant'&&turn.content.includes('green')));
 await page.evaluate(()=>{document.getElementById('ai-mode').value='voice';document.getElementById('ai-mode').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('master').value='0';document.getElementById('master').dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>window.bambi.ask('Tell me my color in one sentence.'));
 await page.waitForFunction(async()=>{const report=await(await fetch('/api/diagnostics/replies')).json();return report.replies.some(reply=>reply.stages['playback-start']!==undefined&&reply.status==='done');});
 await page.click('#memory');await page.waitForSelector('#memory-dialog[open]');await page.fill('#memory-key','color');await page.fill('#memory-value','blue');await page.click('#memory-form button[type=submit]');await page.waitForFunction(()=>document.getElementById('memory-content').textContent.includes('color: blue'));
 await page.click('#forget');await page.waitForFunction(()=>!document.getElementById('memory-content').textContent.includes('color:'));assert.deepEqual((await(await fetch(base+'/api/memory')).json()).facts,[]);await page.click('#close-memory');
 const health=await(await fetch(base+'/api/health')).json();assert.equal(health.protocolVersion,1);assert.equal(health.modelConnections['cloud:cydonia-24b-v4.3'].context,32768);assert.ok(!JSON.stringify(health).includes('fixture-key'));
 assert.deepEqual(errors,[]);const report={scope:'Isolated in-memory database, local inference/silent-WAV speech stubs, headless browser; no physical microphone, device commands, paid GPU or real Cydonia inference.',setup:true,studioAudioExportImportPreview:true,mobileLayout:true,cloudChat:true,voicePlaybackTrace:true,memoryEditorAndClear:true,errors};writeFileSync('runtime/high-impact-browser-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
 await browser?.close();app.kill('SIGTERM');await Promise.race([once(app,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);if(app.exitCode===null)app.kill('SIGKILL');stub.closeAllConnections();await new Promise(resolve=>stub.close(resolve));rmSync(fixture,{recursive:true,force:true});
}
