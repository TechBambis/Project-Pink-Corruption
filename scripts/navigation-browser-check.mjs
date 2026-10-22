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
const reactUI=process.env.BAMBI_BROWSER_UI==='react';
const streamingFixture=join(root,'.runtime/streaming-speech/test.wav');
if(realStreaming&&!existsSync(streamingFixture))throw Error('Streaming integration needs the public test WAV at .runtime/streaming-speech/test.wav. See docs/STREAMING_SPEECH.md.');
const wav=Buffer.alloc(44+32000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
const stub=createServer(async(req,res)=>{
 const parts=[];for await(const part of req)parts.push(part);const body=JSON.parse(Buffer.concat(parts).toString()||'{}');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'Cydonia-24B-v4.3'}]}));return;}
 if(req.url==='/v1/audio/voices'){res.end(JSON.stringify({voices:['af_heart','af_sarah']}));return;}
 if(req.url==='/lab/render'){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
 if(req.url==='/dev/captioned_speech'){res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({audio:wav.toString('base64'),audio_format:'wav',text:body.input,spoken_seconds:1,timestamps:body.input.split(' ').map((word,i,all)=>({word,start_time:i/all.length,end_time:(i+1)/all.length}))})+'\n');return;}
 if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:JSON.stringify(body.messages)}));return;}
 if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:Array(Math.ceil(body.content.length/4)).fill(1)}));return;}
 if(!body.stream){res.end(JSON.stringify({choices:[{message:{content:'{"action":"adapt"}'}}]}));return;}
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:body.messages?.some(message=>message.content.includes('=== EVENT OUTPUT CONTRACT ==='))?'The color is green.':'[owner] The color is green.\n'}}]})+'\n\ndata: [DONE]\n\n');
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');const stubPort=stub.address().port;
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`,errors=[];let browser,logs='';
// A separate working directory excludes private .env files, recordings and caches.
const fixture=mkdtempSync(join(tmpdir(),'bambi-browser-check-'));
for(const name of ['packages','presets','voices','apps','docs','dist','config','node_modules'])
 if(existsSync(join(root,name)))symlinkSync(join(root,name),join(fixture,name),process.platform==='win32'?'junction':'dir');
if(realStreaming){mkdirSync(join(fixture,'.runtime'),{recursive:true});for(const name of ['streaming-stt-venv','streaming-speech'])symlinkSync(join(root,'.runtime',name),join(fixture,'.runtime',name),'dir');}
writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
// Native preparation/cleanup must never resolve a symlink to the real lifecycle owner.
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
let auditPage;
try{
 let ready=false;for(let attempt=0;attempt<100;attempt++){if(app.exitCode!==null)throw Error('Fixture server failed: '+logs);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'Fixture server started');
 // This independent feature check uses an explicitly preconfigured fixture. First-run consent has its own browser check.
 assert.equal((await fetch(base+'/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({microphone:true,devices:true,modelDownloads:false,onlineMedia:false,cloudAI:true,localClock:false,approximateLocation:false,contextToCloud:false})})).status,200);
 browser=await chromium.launch({...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{}),headless:true});
 const page=auditPage=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(String(error)));
 const narrationRequests=[];
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/events/render'))narrationRequests.push(request.postDataJSON());});
 page.on('requestfailed',req=>console.error('REQUEST FAILED',req.url(),req.failure()?.errorText));
 page.on('response',res=>{if(res.status()>=400)console.error('HTTP ERROR',res.status(),res.url());});
 // Model warming is covered separately; this check never invokes an installed local model.
 let warmCalls=0,failWarm=false;
 await page.route('**/api/warm',route=>{warmCalls++;return route.fulfill(failWarm?{status:503,json:{error:'Fixture preparation failed'}}:{json:{ok:true}});});
 if(!realStreaming)await page.routeWebSocket('**/ws/speech',socket=>{socket.send(JSON.stringify({type:'ready'}));socket.onMessage(raw=>{if(typeof raw!=='string')return;const command=JSON.parse(raw);if(command.type==='start')socket.send(JSON.stringify({type:'partial',id:command.id,text:'My live provisional words'}));if(command.type==='finish')socket.send(JSON.stringify({type:'final',id:command.id,text:'My final microphone words because'}));});});


 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(base+(reactUI?'/?ui=react':'/'));
 await page.waitForFunction(()=>window.bambi&&[...document.getElementById('model').options].some(option=>option.value==='cloud:cydonia-24b-v4.3'));
 // Never let evolving product defaults route this isolated check to a real local model.
 const fixtureModelSave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings.model==='cloud:cydonia-24b-v4.3'&&response.ok());
 await page.evaluate(()=>{const model=document.getElementById('model');model.value='cloud:cydonia-24b-v4.3';model.dispatchEvent(new Event('input',{bubbles:true}));});
 await fixtureModelSave;
 // Q8 UI contract only: native worker switching is tested separately with isolated children.
 let cacheEnabled=false,failCache=false,holdCache=null;
 let dflashEnabled=false,failDflash=false,holdDflash=null;const dflashRequests=[];
 const cacheRequests=[];
 await page.route('**/api/health',async route=>{const response=await route.fetch();const data=await response.json();data.kvCache={supported:true,model:'bambi-qwen35-9b-hauhau:q4_k_m',enabled:cacheEnabled};data.dflash={supported:true,model:'bambi-qwen35-4b-hauhau:q4_k_m',enabled:dflashEnabled};data.models=[...new Set([...(data.models||[]),'bambi-qwen35-9b-hauhau:q4_k_m','bambi-qwen35-4b-hauhau:q4_k_m','bambi-qwen35-4b-hauhau-mtp-experiment:q4_k_m','bambi-qwen35-4b-hauhau-mtp-baseline:q4_k_m'])];await route.fulfill({response,json:data});});
 await page.route('**/api/preferences',async route=>{if(route.request().method()!=='GET'){await route.continue();return;}const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),'q8-kv-cache':cacheEnabled,'dflash-4b':dflashEnabled}});});
 await page.route('**/api/runtime/kv-cache',async route=>{const data=route.request().postDataJSON();cacheRequests.push(data);if(holdCache)await holdCache;if(failCache){await route.fulfill({status:503,json:{error:'Fixture cache preparation failed'}});return;}cacheEnabled=data.enabled;await route.fulfill({json:{ok:true,enabled:cacheEnabled,supported:true}});});
 await page.route('**/api/runtime/dflash',async route=>{const data=route.request().postDataJSON();dflashRequests.push(data);if(holdDflash)await holdDflash;if(failDflash){await route.fulfill({status:503,json:{error:'Fixture DFlash preparation failed'}});return;}dflashEnabled=data.enabled;await route.fulfill({json:{ok:true,enabled:dflashEnabled,supported:true}});});
 await page.locator('[data-nav="voice"]').click();
 await page.locator('#ai-advanced-settings summary').click();
 const q8ModelSave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings.model==='bambi-qwen35-9b-hauhau:q4_k_m'&&response.ok());
 await page.evaluate(()=>{const select=document.getElementById('model');if(![...select.options].some(o=>o.value==='bambi-qwen35-9b-hauhau:q4_k_m'))select.add(new Option('Hauhau 9B','bambi-qwen35-9b-hauhau:q4_k_m'));select.value='bambi-qwen35-9b-hauhau:q4_k_m';select.dispatchEvent(new Event('input',{bubbles:true}));});
 await q8ModelSave;
 await page.waitForFunction(()=>!document.getElementById('q8-kv-cache').disabled);
 assert.equal(await page.locator('#q8-kv-cache').isChecked(),false,'Q8 defaults off');
 let releaseCache;holdCache=new Promise(resolve=>{releaseCache=resolve;});
 await page.locator('#q8-kv-cache').check();
 await page.waitForFunction(()=>document.getElementById('q8-kv-cache').disabled&&document.getElementById('q8-kv-status').textContent.startsWith('Preparing'));
 releaseCache();holdCache=null;
 await page.waitForFunction(()=>!document.getElementById('q8-kv-cache').disabled&&document.getElementById('q8-kv-status').textContent.startsWith('On'));
 await page.reload();
 await page.waitForFunction(()=>document.getElementById('q8-kv-cache').checked);
 await page.locator('[data-nav="voice"]').click();
 if(!await page.locator('#q8-kv-cache').isVisible())await page.locator('#ai-advanced-settings summary').click();
 await page.waitForFunction(()=>!document.getElementById('q8-kv-cache').disabled);
 failCache=true;await page.locator('#q8-kv-cache').uncheck();
 await page.waitForFunction(()=>!document.getElementById('q8-kv-cache').disabled&&document.getElementById('q8-kv-cache').checked);
 assert.match(await page.locator('#notice').textContent(),/Fixture cache preparation failed/);
 failCache=false;await page.locator('#q8-kv-cache').uncheck();
 await page.waitForFunction(()=>!document.getElementById('q8-kv-cache').disabled&&document.getElementById('q8-kv-status').textContent.startsWith('Off'));
 assert.deepEqual(cacheRequests.map(r=>r.enabled),[true,false,false]);
 assert(cacheRequests.every(r=>r.model==='bambi-qwen35-9b-hauhau:q4_k_m'));
 await page.evaluate(()=>{const model=document.getElementById('model');model.value='cloud:cydonia-24b-v4.3';model.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>document.getElementById('q8-kv-cache').disabled);
 // Installed 4B is an ordinary model choice; DFlash remains a separate opt-in.
 const fourBModelSave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings.model==='bambi-qwen35-4b-hauhau:q4_k_m'&&response.ok());
 await page.locator('#model').selectOption('bambi-qwen35-4b-hauhau:q4_k_m');
 await page.locator('#model').dispatchEvent('input');
 await fourBModelSave;
 await page.waitForFunction(()=>!document.getElementById('dflash-4b').disabled);
 assert.match(await page.locator('#model option:checked').textContent(),/4B.*Experimental/);
 assert.equal(await page.locator('#dflash-4b').isChecked(),false);
 assert.equal(await page.locator('#q8-kv-cache').isDisabled(),true);
 let releaseDflash;holdDflash=new Promise(resolve=>{releaseDflash=resolve;});
 await page.locator('#dflash-4b').check();
 await page.waitForFunction(()=>document.getElementById('dflash-4b').disabled&&document.getElementById('dflash-status').textContent.startsWith('Preparing'));
 releaseDflash();holdDflash=null;
 await page.waitForFunction(()=>!document.getElementById('dflash-4b').disabled&&document.getElementById('dflash-status').textContent.startsWith('On'));
 await page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings.model==='bambi-qwen35-4b-hauhau:q4_k_m'&&response.ok());
 await page.reload();
 await page.waitForFunction(()=>document.getElementById('dflash-4b').checked&&document.getElementById('model').value==='bambi-qwen35-4b-hauhau:q4_k_m');
 await page.locator('[data-nav="voice"]').click();
 if(!await page.locator('#dflash-4b').isVisible())await page.locator('#ai-advanced-settings summary').click();
 failDflash=true;await page.locator('#dflash-4b').uncheck();
 await page.waitForFunction(()=>!document.getElementById('dflash-4b').disabled&&document.getElementById('dflash-4b').checked);
 assert.match(await page.locator('#notice').textContent(),/Fixture DFlash preparation failed/);
 failDflash=false;await page.locator('#dflash-4b').uncheck();
 await page.waitForFunction(()=>!document.getElementById('dflash-4b').disabled&&document.getElementById('dflash-status').textContent.startsWith('Off'));
 assert.deepEqual(dflashRequests.map(r=>r.enabled),[true,false,false]);
 assert(dflashRequests.every(r=>r.model==='bambi-qwen35-4b-hauhau:q4_k_m'));
 // MTP is a pair of explicit model choices; neither changes the selected personality.
 const originalCharacter=await page.locator('#prompt-template').inputValue();
 for(const alias of ['bambi-qwen35-4b-hauhau-mtp-experiment:q4_k_m','bambi-qwen35-4b-hauhau-mtp-baseline:q4_k_m']){
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/preferences')&&r.request().method()==='PUT'&&r.request().postDataJSON().settings.model===alias&&r.ok());
  await page.locator('#model').selectOption(alias);await page.locator('#model').dispatchEvent('input');await saved;
  assert.equal(await page.locator('#prompt-template').inputValue(),originalCharacter);
  assert.equal(await page.locator('#dflash-4b').isDisabled(),true,'DFlash does not apply to the MTP export');
  await page.reload();await page.waitForFunction(alias=>window.bambi&&document.getElementById('model').value===alias,alias);
  assert.equal(await page.locator('#prompt-template').inputValue(),originalCharacter);
  await page.locator('[data-nav="voice"]').click();
  if(!await page.locator('#model').isVisible())await page.locator('#ai-advanced-settings summary').click();
 }
 await page.locator('#model').selectOption('bambi-qwen35-9b-hauhau:q4_k_m');await page.locator('#model').dispatchEvent('input');
 await page.waitForFunction(()=>document.getElementById('dflash-4b').disabled);
 await page.locator('#model').selectOption('cloud:cydonia-24b-v4.3');await page.locator('#model').dispatchEvent('input');
 await page.unroute('**/api/runtime/dflash');
 await page.unroute('**/api/runtime/kv-cache');await page.unroute('**/api/health');await page.unroute('**/api/preferences');
 const invalidCache=await fetch(base+'/api/runtime/kv-cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,model:'cloud:cydonia-24b-v4.3'})});assert.equal(invalidCache.status,400);
 const invalidDflash=await fetch(base+'/api/runtime/dflash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,model:'bambi-qwen35-9b-hauhau:q4_k_m'})});assert.equal(invalidDflash.status,400);
 const originalPreferences=await (await fetch(base+'/api/preferences')).json();
 await page.waitForFunction(()=>document.getElementById('settings-save-status').dataset.state==='saved');
 const originalSnapshot=await (await fetch(base+'/api/settings')).json();
 const ordinarySave=await fetch(base+'/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:originalSnapshot.revision,settings:{...originalSnapshot.settings,'q8-kv-cache':true,'dflash-4b':true}})});assert.equal(ordinarySave.status,200,await ordinarySave.text());
 assert.equal((await (await fetch(base+'/api/preferences')).json())['q8-kv-cache'],false,'Ordinary preference saves cannot bypass runtime preparation');
 assert.equal((await (await fetch(base+'/api/preferences')).json())['dflash-4b'],false,'Ordinary preference saves cannot bypass DFlash preparation');
 await page.reload();await page.waitForFunction(()=>window.bambi);
 await page.locator('[data-nav="session"]').click();

 const output=join(root,reactUI?'.runtime/react-navigation-preview':'.runtime/navigation-preview');mkdirSync(output,{recursive:true});
 const report={renderer:reactUI?'react':'existing',scope:'Fresh isolated profile; simulated AI and voice, no private recordings or physical devices.',checks:[],errors};
 const check=(name)=>{report.checks.push(name);};
 check('Q8 defaults off, locks while preparing, survives reload, rolls back on failure and can be switched off; other models disable it. Simulated runtime only.');
 check('MTP on/off choices persist across reload without changing character; DFlash is unavailable for that export. Simulated runtime only.');
 check('4B can be selected and restored across reload; DFlash defaults off, locks, rolls back and switches off; switching back to 9B disables DFlash. Simulated runtime only.');
 const state=()=>page.evaluate(()=>({mode:document.getElementById('mode').value,narration:document.getElementById('narration-enabled').checked,events:document.getElementById('session-events').checked,style:document.getElementById('conversation-style').value,voice:document.getElementById('voice').value,master:document.getElementById('master').value,active:window.bambi.director.active}));
 assert.equal((await state()).narration,true);assert.equal((await state()).events,true);
 assert.equal(await page.locator('#duration').inputValue(),'unlimited');
 assert.deepEqual(await page.locator('[data-nav]').evaluateAll(nodes=>nodes.map(node=>node.dataset.nav)),['session','files','voice','visuals','sound','devices','extras']);
 assert.equal(await page.locator('#session-flow-settings').evaluate(node=>node.open),false);
 assert.equal(await page.locator('#session-direction-settings').isVisible(),true);
 assert.equal(await page.locator('.experience-bar').count(),0);
 assert.equal(await page.locator('#experience-choices [aria-pressed="true"]').locator('span').innerText(),'Interactive session');
 assert.equal((await state()).active,false);
 assert.ok((await page.locator('#stage').boundingBox()).y<30,'Picture starts at the top without a header');
 check('Fresh profile defaults to Guided without autoplay; header removed; navigation ordered by priority.');
 for(const id of ['scene','visual-opacity','adaptive-delivery','tick-enabled','dual-voice','device-phase-defaults'])
  assert.equal(await page.locator('#'+id).isDisabled(),true,id+' is owned by Guided');
 assert.equal(await page.locator('#spiral-style').isDisabled(),false);
 assert.equal(await page.locator('#persona').isDisabled(),true);
 assert.equal(await page.locator('#guided-style').isDisabled(),false);
 assert.equal(await page.locator('#guided-style').inputValue(),await page.locator('#persona').inputValue(),'The previous Guided tone is preserved');
 assert.match(await page.locator('#scene-unavailable').innerText(),/Guided events/);
 assert.equal(await page.locator('#device-vib-max').isDisabled(),false);
 check('Guided explains inactive legacy controls while retaining spiral style and device limits.');
 const openSetup=async()=>{await page.locator('[data-nav="session"]').click();await page.locator('#session-basics').scrollIntoViewIfNeeded();};
 const choose=async choice=>{await openSetup();await page.locator('#experience-choices [data-experience="'+choice+'"]').click();};
 const originalRegie=await page.locator('#direction-ai-regie').isChecked();
 await choose('solo');
 const lockedDraft=await page.evaluate(async()=>{
  const ui=window.bambi.ui,before=ui.chat.getSnapshot();
  ui.setDraft('This must not enter an autonomous session');await ui.submitDraft();
  return {allowed:before.inputAllowed,unchanged:ui.chat.getSnapshot()===before,draft:document.getElementById('chat-input').value};
 });
 assert.deepEqual(lockedDraft,{allowed:false,unchanged:true,draft:''});
 await choose('guided');
 // Solo enables AI planning as a saved preference. Restore the fixture's
 // deterministic journey setting before its existing Guided qualification.
 await page.evaluate(checked=>{const input=document.getElementById('direction-ai-regie');input.checked=checked;input.dispatchEvent(new Event('input',{bubbles:true}));},originalRegie);
 check('The shared UI interface rejects draft edits and submission when autonomous sessions own the input.');
 await page.screenshot({path:join(output,'desktop-first.png')});
 await page.locator('[data-nav="visuals"]').click();
 await page.locator('#visual-basics').scrollIntoViewIfNeeded();
 await page.screenshot({path:join(output,'desktop-guided-availability.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Availability descriptions fit the settings panel');
 await page.evaluate(()=>{window.bambi.ui.setVoice('af_sarah');window.bambi.ui.setVolume(.41);});
 await choose('guided');
 assert.deepEqual(await state(),{mode:'conversation',narration:true,events:true,style:'reactive',voice:'af_sarah',master:'0.41',active:false});
 await page.locator('[data-nav="voice"]').click();
 await page.locator('#guided-narration-style-settings summary').click();
 const guidedStyle='Quiet and precise.',chatPersonality='Curious and playful.';
 await page.locator('#guided-style').fill(guidedStyle);
 await page.screenshot({path:join(output,'desktop-guided-narration-style.png')});
 await page.locator('#guided-narration-style-settings summary').click();
 await page.locator('[data-nav="voice"]').click();
 await page.locator('#chat-personality-settings summary').click();
 await page.locator('#prompt-template').selectOption('custom');
 assert.equal(await page.locator('#persona').isDisabled(),false);
 await page.locator('#persona').fill(chatPersonality);
 const personalitySave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings.persona===chatPersonality&&response.request().postDataJSON().settings['guided-style']===guidedStyle&&response.ok());
 await page.locator('#prompt-template').selectOption('bambisleep-classic');
 await personalitySave;
 assert.equal(await page.locator('#persona').isDisabled(),true);
 assert.equal(await page.locator('#persona').inputValue(),chatPersonality);
 assert.equal(await page.locator('#guided-style').inputValue(),guidedStyle);
 await page.screenshot({path:join(output,'desktop-chat-personality.png')});
 check('Chat personality and Guided narration style are independent; built-in personalities disable only custom chat text.');
 const englishSave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings['prompt-template']==='english-conversation'&&response.ok());
 await page.locator('#prompt-template').selectOption('english-conversation');await englishSave;
 assert.match(await page.locator('#prompt-description').innerText(),/arguments.*corrections/);
 assert.equal(await page.locator('#persona').isDisabled(),true);
 await page.reload();await page.waitForFunction(()=>document.getElementById('prompt-template').value==='english-conversation');
 await page.locator('[data-nav="voice"]').click();
 if(!await page.locator('#prompt-template').isVisible())await page.locator('#chat-personality-settings summary').click();
 assert.equal(await page.locator('#persona').inputValue(),chatPersonality);
 const classicSave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings['prompt-template']==='bambisleep-classic'&&response.ok());
 await page.locator('#prompt-template').selectOption('bambisleep-classic');await classicSave;
 check('English Conversation is selectable and persists after reload without replacing custom personality text.');
 await openSetup();
 await page.waitForFunction(()=>document.getElementById('session-launch').getBoundingClientRect().bottom<innerHeight);
 assert.equal(await page.locator('#session-direction-settings').isVisible(),true);
 await page.locator('#direction-details summary').click();
 await page.locator('#session-direction').selectOption('reference-contrast');
 assert.equal(await page.locator('#direction-contrast').inputValue(),'90');
 assert.equal(await page.locator('#direction-repetition').inputValue(),'65');
 assert.ok((await page.locator('#direction-influence').innerText()).includes('Tom Tame'));
 assert.equal((await state()).voice,'af_sarah');assert.equal((await state()).master,'0.41');
 await page.locator('#direction-motifs').selectOption('heart');
 await page.locator('#direction-mindwipe').uncheck();
 assert.equal(await page.locator('#session-direction').inputValue(),'custom');
 const directionSave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings['direction-motifs']==='heart'&&response.request().postDataJSON().settings['direction-mindwipe']===false&&response.ok());
 await page.locator('#direction-rhythm').selectOption('slow');await directionSave;
 await page.reload();await page.waitForFunction(()=>window.bambi&&document.getElementById('direction-motifs').value==='heart');
 await page.waitForFunction(()=>window.bambi.ui.audio.getSnapshot().volume===.41&&window.bambi.ui.audio.getSnapshot().voice==='af_sarah');
 assert.equal(await page.locator('#master').inputValue(),'0.41','Restored volume reaches the rendered control');
 assert.equal(await page.locator('#session-voice-name').innerText(),await page.locator('#voice option:checked').innerText(),'The voice summary follows the restored runtime state');
 assert.equal(await page.locator('#guided-style').inputValue(),guidedStyle);
 assert.equal(await page.locator('#persona').inputValue(),chatPersonality);
 assert.equal(await page.locator('#direction-mindwipe').isChecked(),false);assert.equal(await page.locator('#session-direction').inputValue(),'custom');
 await openSetup();
 check('Session styles apply component values without changing voice/mix; Custom preserves motif and mechanism choices across reload.');
 await page.screenshot({path:join(output,'desktop-guided-setup.png')});
 await page.locator('#session-launch').click();
 await page.waitForFunction(()=>window.bambi.director.active&&window.bambi.sessionEvents.active);
 assert.ok(narrationRequests.length,'Native event narration was requested');
 assert.equal(narrationRequests[0].narrationStyle,guidedStyle,'Event speech receives its independent Guided style');
 assert.equal(narrationRequests[0].persona,chatPersonality,'Character personality remains separate from narration delivery');
 assert.equal(await page.evaluate(()=>window.bambi.director.unlimited&&window.bambi.sessionEvents.program.continuous),true);
 assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.program.events[0].baseline.motifForm),'heart');
 assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.program.events[0].speech.delivery),'settle');
 const initialDirectionProgram=await page.evaluate(()=>window.bambi.sessionEvents.program);
 const committedDirectionEvent=await page.evaluate(()=>window.bambi.sessionEvents.program.events[0]);
 await page.locator('#direction-details summary').click();
 await page.locator('#session-direction').selectOption('driving');
 await page.locator('#direction-motifs').selectOption('ring');
 assert.deepEqual(await page.evaluate(()=>window.bambi.sessionEvents.program.events[0]),committedDirectionEvent);
 check('Saved direction reaches the actual engine; live edits leave already committed episode boundaries intact.');
 for(const seconds of [1201,2401,86500]){
  await page.evaluate(seconds=>{window.bambi.clock.seek(seconds);window.bambi.playbackClock.seek(seconds);},seconds);
  await page.waitForFunction(seconds=>window.bambi.sessionEvents.program.events.some(event=>event.atMs>=seconds*1000),seconds);
  assert.equal(await page.evaluate(()=>window.bambi.director.active&&window.bambi.clock.running&&!window.bambi.sessionEvents.snapshot.complete),true);
 }
 await page.locator('#stage').hover();await page.locator('#pause').click();
 await page.waitForFunction(()=>window.bambi.director.paused&&window.bambi.audio.context.state==='suspended');
 assert.equal(await page.evaluate(()=>window.bambi.ui.session.getSnapshot().paused),true);
 assert.equal(await page.evaluate(()=>window.bambi.ui.getSnapshot().state),'paused');
 const unlimitedPaused=await page.evaluate(()=>window.bambi.clock.time);await page.waitForTimeout(120);
 assert.equal(await page.evaluate(()=>window.bambi.clock.time),unlimitedPaused);
 await page.locator('#pause').click();await page.waitForFunction(()=>window.bambi.clock.running);
 assert.equal(await page.evaluate(()=>window.bambi.ui.session.getSnapshot().paused),false);
 assert.equal(await page.evaluate(()=>window.bambi.ui.session.getSnapshot().unlimited),true);
 check('Unlimited remains active after 20/40 minutes and beyond 24 hours; Pause and Resume preserve the monotonic clock.');
 if(reactUI){
  const owner=await page.evaluateHandle(()=>window.bambi);
  for(const view of ['voice','files','session']){
   await page.locator('[data-nav="'+view+'"]').click();
   await page.waitForFunction(view=>document.getElementById('app').dataset.view===view,view);
   assert.equal(await page.evaluate(owner=>window.bambi===owner,owner),true,'Navigation retains the runtime owner');
   assert.equal(await page.evaluate(()=>window.bambi.director.active&&window.bambi.clock.running),true);
   assert.equal(await page.locator('#persistent-stop').isVisible(),true,'Stop stays reachable in every section');
   assert.match(new URL(page.url()).hash,new RegExp('^#/'+view));
  }
  await page.goBack();await page.waitForFunction(()=>document.getElementById('app').dataset.view==='files');
  await page.goForward();await page.waitForFunction(()=>document.getElementById('app').dataset.view==='session');
  assert.equal(await page.evaluate(owner=>window.bambi===owner,owner),true);
  await owner.dispose();
  check('React routes and browser Back/Forward retain the running player and its single runtime owner.');
 }
 await page.evaluate(()=>window.navigationFixtureProgram=window.bambi.sessionEvents.program);
 await choose('guided');
 assert.equal(await page.evaluate(()=>window.bambi.director.active&&window.bambi.sessionEvents.program===window.navigationFixtureProgram),true);
 check('Guided entry preserves custom voice/mix, starts the adaptive director and can be reselected without restarting.');
 // Choosing Library from session settings ends live work before switching.
 await choose('files');
 await page.waitForFunction(()=>document.getElementById('heading-files').getBoundingClientRect().bottom<innerHeight);
 assert.equal((await state()).active,false);assert.equal((await state()).mode,'local');
 assert.equal(await page.locator('#session-duration-control').isVisible(),false);
 assert.equal(await page.locator('#session-direction-settings').isVisible(),false);
 assert.equal(await page.locator('#session-intensity-control').isVisible(),false);
 assert.equal(await page.locator('#session-flow-settings').isVisible(),false);
 assert.equal(await page.locator('#view-files').isVisible(),true);
 await page.screenshot({path:join(output,'desktop-library.png'),fullPage:true});
 check('Library opens the collection, ends live work and hides unrelated AI controls.');
 await page.locator('#files').setInputFiles({name:'availability-fixture.wav',mimeType:'audio/wav',buffer:wav});
 await page.waitForFunction(()=>document.getElementById('media-name').textContent==='availability-fixture.wav');
 for(const id of ['trigger-sound','brainwave-enabled','background-drone','bus-effects','duration'])
  assert.equal(await page.locator('#'+id).isDisabled(),true,id+' is inactive for original audio');
 assert.equal(await page.locator('#bus-session').isDisabled(),false);
 assert.equal(await page.locator('#subtitles').isDisabled(),false);
 check('Selected recordings disable extra audio and retain original media volume and captions.');
 await choose('conversation');
 assert.equal((await state()).narration,false);assert.equal((await state()).events,false);assert.equal((await state()).style,'situational');
 assert.equal((await state()).voice,'af_sarah');assert.equal((await state()).master,'0.41');
 check('Chat restores conversation mode without resetting voice or volume.');
 await page.evaluate(()=>{
  document.getElementById('reduced').checked=false;
  document.getElementById('phase-visuals').checked=false;
  document.getElementById('voice2').value='';
  document.getElementById('voice-mix').value='0';
  document.getElementById('scene').value='Spiral Focus';
  document.getElementById('scene').dispatchEvent(new Event('input',{bubbles:true}));
 });
 assert.equal(await page.locator('#motion').isDisabled(),true);
 assert.equal(await page.locator('#spiral-speed').isDisabled(),false);
 assert.equal(await page.locator('#voice-mix').isDisabled(),true);
 await page.evaluate(()=>{
  document.getElementById('voice-mix').disabled=true;
  document.getElementById('voice2').value='af_sarah';
  document.getElementById('voice2').dispatchEvent(new Event('input',{bubbles:true}));
 });
 assert.equal(await page.locator('#voice-mix').isDisabled(),true,'A control-owned disabled state is preserved');
 assert.equal(await page.locator('#voice-mix').inputValue(),'0','The stored zero blend is preserved');
 await page.evaluate(()=>{document.getElementById('voice-mix').disabled=false;});
 assert.equal(await page.locator('#voice-mix').isDisabled(),false);
 await page.evaluate(()=>{
  document.getElementById('reduced').checked=true;
  document.getElementById('reduced').dispatchEvent(new Event('input',{bubbles:true}));
 });
 assert.equal(await page.locator('#spiral-speed').isDisabled(),true);
 await page.evaluate(()=>{
  document.getElementById('reduced').checked=false;
  document.getElementById('reduced').dispatchEvent(new Event('input',{bubbles:true}));
 });
 assert.equal(await page.locator('#spiral-speed').isDisabled(),false);
 check('Dependencies restore controls without overwriting zero values or control-owned locks; gentle motion disables animated speed.');
 assert.equal(await page.locator('#duration').inputValue(),'unlimited','Original-file mode preserves the AI duration preference');
 const finiteSave=page.waitForResponse(response=>response.url().endsWith('/api/preferences')&&response.request().method()==='PUT'&&response.request().postDataJSON().settings.duration==='300'&&response.ok());
 await page.evaluate(()=>{document.getElementById('duration').value='300';document.getElementById('duration').dispatchEvent(new Event('input',{bubbles:true}));});
 await page.evaluate(()=>window.bambi.startSession());await page.waitForFunction(()=>window.bambi.director.active);
 await page.evaluate(()=>window.bambi.clock.seek(301));await page.waitForFunction(()=>window.bambi.director.state==='FINISHED');
 assert.equal(await page.evaluate(()=>window.bambi.clock.running),false);
 await finiteSave;const persisted=await(await fetch(base+'/api/preferences')).json();assert.equal(persisted.duration,'300');assert.equal(persisted['duration-version'],1);
 await page.reload();await page.waitForFunction(()=>window.bambi&&document.getElementById('duration').value==='300');
 check('Deliberately chosen finite duration still ends the session and survives reload.');
 // Tabs must show the destination even from the initial picture, and keyboard focus follows.
 await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 await page.locator('[data-nav="voice"]').focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.activeElement.id==='heading-voice');
 const heading=await page.locator('#heading-voice').boundingBox();assert.ok(heading.y>=0&&heading.y+heading.height<900);
 for(const view of ['session','files','voice','visuals','sound','devices','extras']){
  await page.locator('[data-nav="'+view+'"]').click();
  await page.waitForFunction(view=>document.activeElement.id==='heading-'+view,view);
  const bounds=await page.locator('#heading-'+view).boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<900,view+' heading visible');
 }
 check('All desktop tabs reveal their destination; keyboard activation focuses its heading.');
 await choose('guided');
 await openSetup();
 await page.locator('#session-flow-settings summary').click();
 // Keep a Node-side copy across the saved-preference reload, with the original first entry.
 const imported={...initialDirectionProgram,continuous:undefined,events:[committedDirectionEvent]};
 await page.locator('#event-program-file').setInputFiles({name:'fixture-program.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
 await page.waitForFunction(()=>document.getElementById('direction-controls').disabled);
 assert.equal(await page.locator('#session-direction').isDisabled(),true);
 await page.locator('#event-program-clear').click();
 assert.equal(await page.locator('#session-direction').isDisabled(),false);
 check('Imported authored programs disable style edits; returning to adaptive direction restores them.');
 // Legacy profiles are represented, not migrated into a different engine or reset mix.
 await page.route('**/api/settings',async route=>{const response=await route.fetch(),snapshot=await response.json();return route.fulfill({json:{...snapshot,settings:{mode:'conversation','narration-enabled':true,'session-events':false,voice:'af_sarah',master:'0.41',persona:'Legacy gentle style.','guided-style':'Legacy gentle style.'}}});});
 await page.evaluate(()=>localStorage.removeItem('bambi-profile'));
 await page.reload();await page.waitForFunction(()=>window.bambi&&document.getElementById('narration-enabled').checked);
 assert.equal(await page.locator('#guided-style').inputValue(),'Legacy gentle style.');
 assert.equal(await page.locator('#persona').inputValue(),'Legacy gentle style.');
 assert.equal((await state()).events,false);assert.equal((await state()).voice,'af_sarah');assert.equal((await state()).master,'0.41');
 assert.equal(await page.locator('#experience-choices [aria-pressed="true"]').locator('span').innerText(),'Interactive session');
 await choose('guided');assert.equal((await state()).events,true);assert.equal((await state()).active,false);
 assert.equal((await state()).voice,'af_sarah');assert.equal((await state()).master,'0.41');
 check('Legacy profile retains settings on reload; explicit Guided selection enables the director without resetting voice/mix.');
 await page.setViewportSize({width:390,height:844});
 await choose('conversation');
 await page.screenshot({path:join(output,'mobile-first.png')});
 for(const view of ['session','files','voice','visuals','sound','devices','extras']){
  await page.locator('[data-nav="'+view+'"]').click();
  await page.waitForFunction(view=>document.activeElement.id==='heading-'+view,view);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,view+' mobile overflow');
  const bounds=await page.locator('#heading-'+view).boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<844,view+' mobile heading visible');
  await page.screenshot({path:join(output,'mobile-'+view+'.png')});
 }
 check('Seven views fit 390px without overflow and reveal their mobile headings.');
 await choose('guided');
 await openSetup();
 await page.locator('#direction-details summary').click();
 await page.locator('#direction-theme').selectOption('imagination');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Expanded direction controls fit mobile');
 await page.screenshot({path:join(output,'mobile-direction.png')});
 check('Expanded direction controls fit mobile; narrative preference edits become Custom.');
 assert.deepEqual(errors,[]);writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({output,...report},null,2));
} catch(error){console.error(error);console.error(logs.slice(-1500));console.error(JSON.stringify({errors,page:auditPage?await auditPage.evaluate(()=>({url:location.href,exported:!!window.bambi,connection:document.getElementById('connection')?.textContent,notice:document.getElementById('notice')?.textContent,text:document.body.innerText.slice(0,2500)})):null}));process.exitCode=1;}
finally {await browser?.close();app.kill('SIGTERM');await new Promise(resolve=>stub.close(resolve));rmSync(fixture,{recursive:true,force:true});}
