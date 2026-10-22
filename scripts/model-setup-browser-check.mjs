// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Isolated real-server UI check; no large model download or inference process.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync,openSync,ftruncateSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=mkdtempSync(join(tmpdir(),'bambi-onboarding-'));
const models=join(fixture,'models');mkdirSync(models);
const pins=JSON.parse(readFileSync(join(root,'config/local-model-catalog.json'),'utf8')),fable=pins.find(pin=>pin.alias.includes('defiant-fable'));
const sourceFolder=join(fixture,'another-model-repository');mkdirSync(sourceFolder);const sourceFile=join(sourceFolder,'renamed-model.gguf'),fd=openSync(sourceFile,'w');ftruncateSync(fd,fable.bytes);closeSync(fd); // Sparse catalog-size fixture; it is never imported as real model weights.
const instance='isolated-onboarding-fixture';
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`;
const locationCalls=join(fixture,'location-calls.txt'),bootstrap=join(fixture,'bootstrap.mjs');
writeFileSync(bootstrap,`
 import {writeFileSync} from 'node:fs';
 import os from 'node:os';
 // UI transfer states use a representative RAM fixture; real memory guards are covered in recommendation tests.
 os.totalmem=()=>32*1024**3;os.freemem=()=>24*1024**3;
 const fetchReal=globalThis.fetch;let calls=0;
 globalThis.fetch=(url,options)=>{
  if(String(url)==='https://get.geojs.io/v1/ip/geo.json'){
   writeFileSync(${JSON.stringify(locationCalls)},String(++calls));
   return Promise.resolve(new Response(JSON.stringify({city:'Berlin',region:'Berlin',country:'Germany',ip:'198.51.100.8',latitude:'52.52',longitude:'13.40'})));
  }
  return fetchReal(url,options);
 };
 await import(${JSON.stringify(pathToFileURL(join(root,'apps/server/index.ts')).href)});
`);
const server=spawn(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),bootstrap],{cwd:fixture,env:{...process.env,NODE_OPTIONS:'',BAMBI_PORT:String(port),BAMBI_DATABASE:join(fixture,'profile.sqlite'),BAMBI_DESKTOP_SMOKE:'0',BAMBI_DESKTOP_ALPHA:'1',BAMBI_MODELS_ROOT:models,BAMBI_INSTANCE_TOKEN:instance,BAMBI_LLM_URL:'http://127.0.0.1:1',BAMBI_TTS_URL:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe','ipc']});
let logs='',browser,smokeServer;server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
try{
 for(let attempt=0;attempt<100;attempt++){if(server.exitCode!==null)throw Error('Fixture startup failed: '+logs);try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 const catalog=await(await fetch(base+'/api/models/catalog')).json();assert.equal(catalog.alternatives.length,JSON.parse(readFileSync(join(root,'config/local-model-catalog.json'),'utf8')).length);assert.equal(catalog.hardware.ramTotal,32*1024**3);
 const blocked=await fetch(base+'/api/models/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'https://example.invalid/model'})});assert.equal(blocked.status,400);
 const unconfirmed=await fetch(base+'/api/models/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'bambi-qwen35-9b-defiant-fable:iq4_xs'})});assert.equal(unconfirmed.status,400);
 assert.equal((await(await fetch(base+'/api/models/setup')).json()).model,'bambi-qwen35-9b-hauhau:q4_k_m');
 for(const tryAnyway of [true,false]){const response=await fetch(base+'/api/models/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'bambi-qwen35-9b-hauhau:q4_k_m',tryAnyway})});assert.equal(response.status,200);assert.equal((await(await fetch(base+'/api/models/setup')).json()).tryAnyway,tryAnyway);}
 assert.equal((await fetch(base+'/api/models/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'bambi-qwen35-9b-hauhau:q4_k_m',tryAnyway:'true'})})).status,400);
 for(const [body,expected] of [[{model:'bambi-qwen35-9b-hauhau:q4_k_m',models:['bambi-qwen36-35b-hauhau:iq3_m'],speech:false},'Confirm each experimental'],[{model:'bambi-qwen35-9b-hauhau:q4_k_m',models:['bambi-qwen35-9b-hauhau:q4_k_m','bambi-qwen35-9b-hauhau:q4_k_m'],speech:false},'Choose each model once']]){const response=await fetch(base+'/api/models/calibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,400);assert((await response.json()).error.includes(expected));assert.equal((await(await fetch(base+'/api/models/setup')).json()).model,'bambi-qwen35-9b-hauhau:q4_k_m');}

 browser=await chromium.launch({headless:true,...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{})});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.exposeFunction('fixtureChooseSource',async kind=>{const response=await fetch(base+'/api/desktop/setup/sources',{method:'POST',headers:{'Content-Type':'application/json','x-bambi-instance':instance},body:JSON.stringify({path:kind==='file'?sourceFile:sourceFolder,kind})});assert.equal(response.status,200);return response.json();});
 await page.addInitScript(()=>{window.bambiDesktop={chooseModelSource:kind=>window.fixtureChooseSource(kind)};});
 assert.equal((await fetch(base+'/api/desktop/setup/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:sourceFolder,kind:'folder'})})).status,403);
 let liveState=null,statusFailure=false,importRequests=0,waitFirstCatalog=true,releaseCatalog,compactHost=false,trialRestore=false,comparisonFiles=false;const catalogGate=new Promise(resolve=>{releaseCatalog=resolve;});
 await page.route('**/api/models/setup',route=>statusFailure?route.fulfill({status:503,json:{error:'Fixture status disconnected'}}):liveState?route.fulfill({json:liveState}):route.continue());
 await page.route('**/api/models/catalog*',async route=>{const response=await route.fetch(),result=await response.json();if(liveState)result.setup=liveState;if(comparisonFiles)for(const model of result.alternatives)if(['bambi-qwen35-9b-hauhau:q4_k_m','bambi-qwen36-35b-hauhau:iq3_m'].includes(model.id)){model.availableForComparison=true;if(model.id==='bambi-qwen36-35b-hauhau:iq3_m')model.memoryFit='too-large';}if(compactHost){result.hardware={...result.hardware,ramTotal:7.7*1024**3,ramAvailable:6*1024**3,gpus:[{name:'Intel Iris Xe fixture',memoryTotal:128*1024**2,memoryFree:null,sharedMemoryTotal:4*1024**3,source:'windows-dxgi'}]};result.reserveBytes=2.5*1024**3;for(const model of result.alternatives)model.memoryFit=['bambi-qwen35-2b-hauhau:q4_k_m','bambi-qwen35-4b-hauhau:q4_k_m'].includes(model.id)?'fits':'too-large';result.recommended=result.alternatives.find(model=>model.id==='bambi-qwen35-2b-hauhau:q4_k_m');result.setup=trialRestore?result.setup:null;}if(waitFirstCatalog){waitFirstCatalog=false;await catalogGate;}await route.fulfill({response,json:result});});
 await page.route('**/api/desktop/setup/import',route=>{importRequests++;liveState={...liveState,phase:'partial',operation:'import',completed:fable.bytes,remainingBytes:100e6,verified:false,stage:'complete',asset:undefined};return route.fulfill({json:{ok:true}});});
 let downloadRequests=0;await page.route('**/api/models/setup/install',route=>{downloadRequests++;return route.fulfill({json:{ok:true}});});
 const accessBefore=await(await fetch(base+'/api/access')).json();assert.equal(accessBefore.configured,false);
 assert.deepEqual(accessBefore.choices,{microphone:true,devices:true,modelDownloads:true,onlineMedia:true,cloudAI:true,localClock:false,approximateLocation:false,contextToCloud:true});
 for(const endpoint of ['/api/models/setup/install','/api/desktop/setup/install','/api/access/location','/api/transcribe'])assert.equal((await fetch(base+endpoint,{method:'POST'})).status,403);
 await page.goto(base);const privacy=page.locator('#privacy-access');await privacy.waitFor({state:'visible'});assert.equal(await privacy.locator('.privacy-choices input:checked').count(),5);assert(!existsSync(locationCalls));
 assert.equal(await privacy.locator('[name=contextToCloud]').count(),0);assert.equal(await privacy.locator('[data-required]:checked:disabled').count(),3);
 assert(!(await privacy.locator('[name=localClock]').isChecked()));assert(!(await privacy.locator('[name=approximateLocation]').isChecked()));assert.equal(downloadRequests,0);
 await privacy.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:join(root,'.runtime/privacy-defaults-desktop.png')});
 await page.setViewportSize({width:390,height:844});await privacy.evaluate(node=>{node.scrollTop=0;});assert(await privacy.evaluate(node=>node.scrollWidth<=node.clientWidth));await page.screenshot({path:join(root,'.runtime/privacy-defaults-mobile.png')});await page.setViewportSize({width:1280,height:900});
 await privacy.locator('[name=modelDownloads]').check();await privacy.locator('[name=localClock]').check();await privacy.getByRole('button',{name:'Save and continue',exact:true}).click();await privacy.waitFor({state:'hidden'});
 const dialog=page.locator('#model-onboarding');await dialog.waitFor({state:'visible'});await dialog.locator('.model-loading').waitFor({state:'visible'});assert(await dialog.locator('[data-next]').isDisabled());assert(await dialog.locator('[data-finish]').isDisabled());assert.equal(downloadRequests,0);releaseCatalog();await dialog.locator('.model-loading').waitFor({state:'hidden'});
 assert(await dialog.locator('[data-quick-setup]').isEnabled());await dialog.locator('[data-quick-setup]').click();assert(await dialog.locator('[data-pane="2"]').isVisible());assert.equal(downloadRequests,0,'Reviewing the recommended download never starts a transfer');await page.getByRole('button',{name:'1. Your computer',exact:true}).click();
 await page.getByRole('button',{name:'Choose a model',exact:true}).click();await page.locator('.model-choice').last().waitFor();assert.equal(await page.locator('.model-choice').count(),catalog.alternatives.length);assert.equal(downloadRequests,0);
 await page.locator('.model-choice').filter({has:page.locator('input[value="bambi-qwen35-9b-defiant-fable:iq4_xs"]')}).click();await page.getByRole('button',{name:'Review download'}).click();
 const download=page.getByRole('button',{name:'Download and verify',exact:true});assert(await download.isDisabled());
 await page.locator('.model-blocked').filter({hasText:'experimental model confirmation'}).waitFor({state:'visible'});
 await page.getByRole('checkbox',{name:/I want to try/}).check();assert(await download.isEnabled());await Promise.all([page.waitForResponse(response=>response.url()===base+'/api/models/setup/install'),download.click()]);
 assert.equal(downloadRequests,1);
 assert.equal((await(await fetch(base+'/api/models/setup')).json()).model,fable.alias);
 liveState={model:fable.alias,phase:'downloading',operation:'download',stage:'transferring',completed:2e9,total:fable.bytes+100e6,verified:false,asset:'community/'+fable.file,assetIndex:1,assetCount:4,updatedAt:Date.now()};
 await page.locator('#setup-progress').filter({hasText:'Downloading your model'}).waitFor();await page.locator('.model-progress-detail').filter({hasText:'2.00 GB'}).waitFor();assert(await page.locator('#setup-cancel').isEnabled());
 await page.setViewportSize({width:390,height:844});assert(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth));await page.screenshot({path:join(root,'.runtime/model-download-progress-mobile.png')});await page.setViewportSize({width:1280,height:900});
 liveState.updatedAt=Date.now()-40000;await page.locator('.model-progress-detail').filter({hasText:'No new data'}).waitFor();
 statusFailure=true;await page.locator('.model-connection').waitFor({state:'visible'});assert((await page.locator('#setup-bar').getAttribute('value'))!=='0');assert(await download.isDisabled());
 statusFailure=false;liveState={...liveState,phase:'verifying',stage:'checking-file',assetCompleted:3e9,assetTotal:fable.bytes,updatedAt:Date.now()};await page.locator('#setup-progress').filter({hasText:'Checking model files'}).waitFor();await page.locator('.model-connection').waitFor({state:'hidden'});
 liveState={...liveState,phase:'failed',error:'Fixture connection interrupted',stage:'complete'};await page.locator('#setup-progress').filter({hasText:'Setup needs attention'}).waitFor();assert(await page.getByRole('button',{name:'Retry download',exact:true}).isEnabled());
 await page.getByRole('button',{name:'Choose a model file',exact:true}).click();await page.locator('.model-source').filter({hasText:'renamed-model.gguf'}).waitFor();
 await page.getByRole('button',{name:'Add a model folder',exact:true}).click();assert.equal(await page.locator('.model-source').count(),2);
 await page.locator('.model-source').filter({hasText:'another-model-repository'}).getByRole('button',{name:'Import '+catalog.alternatives.find(model=>model.id===fable.alias).label,exact:true}).last().click();
 await page.locator('#setup-progress').filter({hasText:'voice files still needed'}).waitFor();assert.equal(importRequests,1);assert(await page.getByRole('button',{name:'Download remaining 100.0 MB',exact:true}).isEnabled());assert(await page.getByRole('button',{name:'Start local AI',exact:true}).isDisabled());
 await dialog.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:join(root,'.runtime/model-import-progress-desktop.png')});
 liveState={...liveState,phase:'downloading',operation:'download',stage:'transferring',completed:3e9,updatedAt:Date.now()};

 await page.getByRole('button',{name:'Return to companion'}).click();await dialog.waitFor({state:'hidden'});
 await page.reload();await page.locator('#local-models-open').waitFor({state:'attached'});assert(!(await dialog.isVisible()));
 await page.locator('[data-nav=extras]').click();await page.locator('#local-models-open').click();await dialog.waitFor({state:'visible'});
 await page.locator('#setup-progress').filter({hasText:'Downloading your model'}).waitFor();assert(await page.locator('[data-pane="2"]').isVisible());assert.equal(await page.locator('.model-source').count(),2);
 liveState=null;await page.locator('#setup-progress').filter({hasText:'Download has not started'}).waitFor();await page.getByRole('button',{name:'Return to companion',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.locator('#privacy-access-open').click();await privacy.waitFor({state:'visible'});assert(await privacy.locator('[name=localClock]').isChecked());assert(!existsSync(locationCalls));
 await privacy.locator('[name=approximateLocation]').check();await privacy.getByRole('button',{name:'Find approximate place',exact:true}).click();await privacy.locator('[data-place]').filter({hasText:'Berlin'}).waitFor();
 let savedAccess=await(await fetch(base+'/api/access')).json();assert.equal(savedAccess.place.city,'Berlin');assert.equal(savedAccess.place.ip,undefined);assert.equal(savedAccess.place.latitude,undefined);assert.equal(readFileSync(locationCalls,'utf8'),'1');
 assert.equal(await privacy.locator('[data-required]:checked:disabled').count(),3);assert.equal(savedAccess.choices.contextToCloud,true);
 await page.setViewportSize({width:390,height:844});assert(await privacy.evaluate(node=>node.scrollWidth<=node.clientWidth));await page.screenshot({path:join(root,'.runtime/privacy-access-preview.png')});
 await privacy.locator('[name=approximateLocation]').uncheck();await privacy.locator('[name=modelDownloads]').uncheck();await privacy.locator('[name=cloudAI]').uncheck();await privacy.locator('[name=devices]').uncheck();await privacy.getByRole('button',{name:'Save and continue',exact:true}).click();await privacy.waitFor({state:'hidden'});
 savedAccess=await(await fetch(base+'/api/access')).json();assert.equal(savedAccess.place,null);assert.equal(savedAccess.choices.contextToCloud,false);assert.equal(savedAccess.choices.cloudAI,false);assert.equal((await fetch(base+'/api/access/location',{method:'POST'})).status,403);assert.equal(readFileSync(locationCalls,'utf8'),'1');
 assert.equal((await fetch(base+'/api/models/setup/install',{method:'POST'})).status,403);
 let deviceRequests=0;await page.route('**/api/devices/scan',route=>{deviceRequests++;return route.fulfill({json:{devices:[]}});});
 await page.route('**/api/devices/connect',route=>{deviceRequests++;return route.fulfill({json:{ok:true}});});
 await page.locator('[data-nav=devices]').click();await page.locator('#device-scan').click();await privacy.waitFor({state:'visible'});
 assert.equal(deviceRequests,0);assert(!(await privacy.locator('[name=devices]').isChecked()));assert.equal(await privacy.locator('[data-required]:checked:disabled').count(),3);
 await privacy.getByRole('button',{name:'Cancel',exact:true}).click();await privacy.waitFor({state:'hidden'});
 await page.locator('#device-connect').click();await privacy.waitFor({state:'visible'});assert.equal(deviceRequests,0);
 await privacy.getByRole('button',{name:'Cancel',exact:true}).click();await privacy.waitFor({state:'hidden'});
 await page.locator('#device-enabled').click();await privacy.waitFor({state:'visible'});assert(!(await page.locator('#device-enabled').isChecked()));assert.equal(deviceRequests,0);
 await privacy.getByRole('button',{name:'Cancel',exact:true}).click();await privacy.waitFor({state:'hidden'});
 await page.locator('#device-scan').click();await privacy.waitFor({state:'visible'});await privacy.getByRole('button',{name:'Keep optional access off',exact:true}).click();await privacy.waitFor({state:'hidden'});
 assert(Object.values((await(await fetch(base+'/api/access')).json()).choices).every(value=>value===false));assert.equal(deviceRequests,0);
 await page.reload();await page.locator('#privacy-access-open').waitFor({state:'attached'});assert(!(await privacy.isVisible()));
 await page.goto(base+'/setup');await page.getByRole('button',{name:'Choose a model',exact:true}).click();await page.locator('.model-choice').last().waitFor();assert.equal(await page.locator('.model-choice').count(),catalog.alternatives.length);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:join(root,'.runtime/model-setup-preview.png'),fullPage:true});
 compactHost=true;await page.goto(base+'/setup');await page.locator('.model-hardware').filter({hasText:'shared RAM limit'}).waitFor();
 assert(await page.locator('.model-hardware').getByText('AI processing',{exact:true}).isVisible());
 await page.getByRole('button',{name:'Choose a model',exact:true}).click();assert(await page.locator('.model-choice input[value="bambi-qwen35-2b-hauhau:q4_k_m"]').isChecked());
 await page.locator('.model-choice input[value="bambi-qwen35-9b-hauhau:q4_k_m"]').check();await page.getByRole('button',{name:'Review download',exact:true}).click();
 assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isDisabled());await page.locator('.model-blocked').filter({hasText:'memory budget'}).waitFor({state:'visible'});
 await page.getByRole('button',{name:'2. Choose a model',exact:true}).click();await page.locator('.model-choice input[value="bambi-qwen35-4b-hauhau:q4_k_m"]').check();await page.getByRole('button',{name:'Review download',exact:true}).click();
 await page.getByRole('checkbox',{name:/I want to try/}).check();await page.getByRole('button',{name:'Privacy & access',exact:true}).click();await privacy.waitFor({state:'visible'});await privacy.locator('[name=modelDownloads]').check();await privacy.getByRole('button',{name:'Save and continue',exact:true}).click();await privacy.waitFor({state:'hidden'});
 assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isEnabled());assert(!(await page.locator('.model-blocked').isVisible()));
 await page.getByRole('button',{name:'2. Choose a model',exact:true}).click();await page.locator('.model-choice input[value="bambi-qwen35-9b-hauhau:q4_k_m"]').check();await page.getByRole('button',{name:'Review download',exact:true}).click();
 const trial=page.getByRole('checkbox',{name:/Try anyway if memory/});assert(!(await trial.isChecked()));assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isDisabled());
 await trial.check();assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isEnabled());await trial.uncheck();assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isDisabled());await trial.check();
 const beforeTrialDownload=downloadRequests;await page.getByRole('button',{name:'Download and verify',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-recheck]').disabled);assert.equal(downloadRequests,beforeTrialDownload+1);
 const trialState=await(await fetch(base+'/api/models/setup')).json();assert.equal(trialState.model,'bambi-qwen35-9b-hauhau:q4_k_m');assert.equal(trialState.tryAnyway,true);
 trialRestore=true;await page.reload();await page.locator('.model-hardware').filter({hasText:'shared RAM limit'}).waitFor();await page.getByRole('button',{name:'3. Install and start',exact:true}).click();assert(await page.locator('.model-choice input[value="bambi-qwen35-9b-hauhau:q4_k_m"]').isChecked());assert(await trial.isChecked());assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isEnabled());assert.equal(downloadRequests,beforeTrialDownload+1);
 await page.getByRole('button',{name:'2. Choose a model',exact:true}).click();await page.locator('.model-choice input[value="bambi-qwen35-4b-hauhau:q4_k_m"]').check();await page.getByRole('button',{name:'Review download',exact:true}).click();assert(!(await trial.isChecked()));assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isDisabled());
 await page.getByRole('checkbox',{name:/I want to try/}).check();assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isEnabled());
 await page.screenshot({path:join(root,'.runtime/model-setup-compact-preview.png'),fullPage:true});compactHost=false;
 // Performance UI fixture: no real model/service startup or downloads.
 let calibrationRequests=0,calibrationCancels=0,measurementRequests=0;
 const calibrationModel='bambi-qwen35-4b-hauhau:q4_k_m';
 liveState={model:calibrationModel,phase:'installed',verified:true,completed:0,total:0,remainingBytes:0,calibration:{phase:'idle',configuration:0,configurations:0,turn:0,stage:'idle'}};
 await page.route('**/api/models/calibration',route=>{
  if(!liveState)return route.continue();
  if(route.request().method()==='POST'){calibrationRequests++;const request=route.request().postDataJSON();if(request.models){assert.equal(request.model,calibrationModel);assert.deepEqual(new Set(request.models),new Set([calibrationModel,'bambi-qwen35-9b-hauhau:q4_k_m','bambi-qwen36-35b-hauhau:iq3_m']));assert(request.experimental.includes('bambi-qwen36-35b-hauhau:iq3_m'));assert(request.tryAnyway.includes('bambi-qwen36-35b-hauhau:iq3_m'));liveState.calibration={phase:'running',model:'bambi-qwen36-35b-hauhau:iq3_m',modelIndex:3,modelCount:3,configuration:5,configurations:8,turn:2,stage:'measuring-follow-up'};}else{assert.deepEqual(request,{model:calibrationModel,speech:true});liveState.calibration={phase:'running',model:calibrationModel,configuration:2,configurations:4,turn:3,stage:'measuring-follow-up'};}return route.fulfill({json:{ok:true}});}
  measurementRequests++;return route.fulfill({json:{...liveState.calibration,supported:true,measured:liveState.calibration.phase==='complete'?{firstTextMs:800,firstAudioMs:1500,tokensPerSecond:20,backend:'cpu',device:null,tuning:{accelerator:'cpu',threads:3,batchSize:128,microBatchSize:32},verdict:'responsive',scope:'text-and-synthesis-measured',quality:'unreviewed',createdAt:1}:null}});
 });
 await page.route('**/api/models/calibration/cancel',route=>{calibrationCancels++;liveState.calibration={...liveState.calibration,phase:'cancelled',error:'Performance test cancelled.'};return route.fulfill({json:{ok:true}});});
 await page.locator('.model-progress').filter({hasText:'ready to start'}).waitFor();
 await page.getByRole('button',{name:'Test performance',exact:true}).click();
 await page.locator('[data-calibration-status]').filter({hasText:'configuration 2 of 4'}).waitFor();assert.equal(calibrationRequests,1);
 assert(await page.getByRole('button',{name:'Start local AI',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'Test performance',exact:true}).isDisabled());
 assert(await page.locator('.model-choice input').first().isDisabled());assert(await page.getByRole('button',{name:'Cancel performance test',exact:true}).isEnabled());
 await page.getByRole('button',{name:'Cancel performance test',exact:true}).click();await page.locator('[data-calibration-status]').filter({hasText:'cancelled'}).waitFor();assert.equal(calibrationCancels,1);
 liveState.calibration={...liveState.calibration,phase:'complete',profile:{createdAt:1}};delete liveState.calibration.error;
 await page.locator('[data-calibration-status]').filter({hasText:'Measured on this PC: responsive'}).waitFor();
 assert((await page.locator('[data-calibration-status]').textContent()).includes('first generated audio 1.5 s'));
 const measuredBefore=measurementRequests;await page.waitForTimeout(2200);assert.equal(measurementRequests,measuredBefore);
 assert(await page.getByRole('button',{name:'Test performance',exact:true}).isEnabled());
 await page.screenshot({path:join(root,'.runtime/model-calibration-preview.png'),fullPage:true});
 comparisonFiles=true;await page.getByRole('button',{name:'1. Your computer',exact:true}).click();await page.getByRole('button',{name:'Check hardware again',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-recheck]').disabled);await page.getByRole('button',{name:'3. Install and start',exact:true}).click();
 for(const model of [calibrationModel,'bambi-qwen35-9b-hauhau:q4_k_m','bambi-qwen36-35b-hauhau:iq3_m'])await page.locator(`[data-compare-model="${model}"]`).check();
 assert(await page.locator('[data-compare-model="bambi-lfm25-1.2b:Q4_K_M"]').isDisabled());assert(await page.locator('[data-compare]').isDisabled());await page.locator('[data-compare-risk="bambi-qwen36-35b-hauhau:iq3_m"]').check();assert(await page.locator('[data-compare]').isEnabled());
 await page.getByRole('button',{name:'Compare chosen models',exact:true}).click();await page.locator('[data-calibration-status]').filter({hasText:'Model 3 of 3'}).waitFor();assert.equal(calibrationRequests,2);
 assert(await page.locator('[data-compare]').isDisabled());assert(await page.locator('[data-compare-model]').first().isDisabled());
 liveState.calibration={phase:'complete',model:calibrationModel,modelCount:3,configuration:8,configurations:8,turn:4,stage:'complete',profile:{createdAt:2},comparisons:[{model:'bambi-qwen35-9b-hauhau:q4_k_m',performance:null,error:'Insufficient memory fixture.'},{model:'bambi-qwen36-35b-hauhau:iq3_m',performance:{firstTextMs:500,firstAudioMs:1100,tokensPerSecond:80,backend:'cuda',device:'RTX 5090 fixture',verdict:'responsive',quality:'unreviewed'}}]};
 const gpuResult={backend:'cuda',cudaVersion:13,device:'RTX 5090 fixture',offloadedLayers:41,tuning:{accelerator:'auto',threads:6,batchSize:1024,microBatchSize:256},samples:Array.from({length:3},()=>({cold:false,firstTextMs:500,tokensPerSecond:80}))};
 liveState.calibration.profiles=[{model:'bambi-qwen36-35b-hauhau:iq3_m',createdAt:2,winner:2,results:[{...gpuResult,backend:'cpu',device:null,offloadedLayers:0,tuning:{accelerator:'cpu',threads:6,batchSize:512,microBatchSize:128}},{...gpuResult,cudaVersion:12},gpuResult]}];
 await page.locator('[data-comparison-results]').filter({hasText:'RTX 5090 fixture'}).waitFor();assert((await page.locator('[data-comparison-results]').textContent()).includes('Insufficient memory fixture.'));
 assert(await page.locator('.model-choice input[value="'+calibrationModel+'"]').isChecked());
 await page.getByText('CPU and GPU configurations',{exact:true}).click();assert((await page.locator('[data-comparison-results]').textContent()).includes('CUDA 12'));assert((await page.locator('[data-comparison-results]').textContent()).includes('CUDA 13'));await page.locator('[data-comparison-results]').filter({hasText:'41 layers on GPU'}).waitFor();assert(await page.locator('[data-comparison-results] details').getAttribute('open')!==null);await page.waitForTimeout(2200);assert(await page.locator('[data-comparison-results] details').getAttribute('open')!==null);

 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:join(root,'.runtime/model-comparison-preview.png'),fullPage:true});await page.setViewportSize({width:1280,height:900});liveState=null;

 const smokeReservation=createServer();smokeReservation.listen(0,'127.0.0.1');await once(smokeReservation,'listening');const smokePort=smokeReservation.address().port;await new Promise(resolve=>smokeReservation.close(resolve));const smokeBase=`http://127.0.0.1:${smokePort}`;
 smokeServer=spawn(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),bootstrap],{cwd:fixture,env:{...process.env,NODE_OPTIONS:'',BAMBI_PORT:String(smokePort),BAMBI_DATABASE:join(fixture,'smoke.sqlite'),BAMBI_DESKTOP_SMOKE:'1',BAMBI_DESKTOP_ALPHA:'0'},stdio:['ignore','pipe','pipe','ipc']});smokeServer.stdout.on('data',chunk=>logs+=chunk);smokeServer.stderr.on('data',chunk=>logs+=chunk);
 for(let attempt=0;attempt<100;attempt++){if(smokeServer.exitCode!==null)throw Error('Smoke fixture startup failed: '+logs);try{if((await fetch(smokeBase+'/api/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 const smokeCatalog=await(await fetch(smokeBase+'/api/models/catalog')).json();assert.equal(smokeCatalog.buildMode,'smoke');assert.equal(smokeCatalog.downloadsAvailable,false);assert.equal(smokeCatalog.setup,null);
 const smokeAccess=await(await fetch(smokeBase+'/api/access')).json();assert.equal((await fetch(smokeBase+'/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(smokeAccess.choices)})).status,200);
 await page.goto(smokeBase+'/setup');await page.locator('.model-unavailable').waitFor({state:'visible'});await page.getByRole('button',{name:'3. Install and start',exact:true}).click();assert(await page.getByRole('button',{name:'Download and verify',exact:true}).isDisabled());await page.locator('#setup-progress').filter({hasText:'unavailable in this build'}).waitFor();assert(!(await page.locator('.model-local').isVisible()));
 assert.deepEqual(errors,[]);console.log('Passed: preselected first-run choices with fail-closed access, checked disabled required functions, one cloud switch, on-demand device access, saved permissions, mocked IP lookup with coarse-only storage, revocation and deletion, catalog, arbitrary-download rejection, immediate post-consent wizard with loading guards, explicit experimental opt-in/download, per-model memory trial consent and reset, dynamic byte progress, stalled data, polling failure/recovery, native-chooser fixture, saved source folders, partial voice setup, active download reopening, saved model, dismissal persistence, settings reopen, Setup page, performance-test progress/cancellation/action exclusion/results without repeated measurement polling, all six comparison entries including 9B/35B, explicit experimental comparison consent, per-model results and unchanged selection, real-server rejection of duplicate/unconfirmed comparisons, explicit real-server smoke-build limitation, mobile layout and no browser errors.');
}finally{
 await browser?.close();if(smokeServer){smokeServer.kill('SIGTERM');await Promise.race([once(smokeServer,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);if(smokeServer.exitCode===null)smokeServer.kill('SIGKILL');}server.kill('SIGTERM');await Promise.race([once(server,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);if(server.exitCode===null)server.kill('SIGKILL');rmSync(fixture,{recursive:true,force:true});
}
