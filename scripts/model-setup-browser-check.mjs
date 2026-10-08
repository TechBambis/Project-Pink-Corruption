// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Isolated real-server UI check; no large model download or inference process.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=mkdtempSync(join(tmpdir(),'bambi-onboarding-'));
const models=join(fixture,'models');mkdirSync(models);
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`;
const locationCalls=join(fixture,'location-calls.txt'),bootstrap=join(fixture,'bootstrap.mjs');
writeFileSync(bootstrap,`
 import {writeFileSync} from 'node:fs';
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
const server=spawn(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),bootstrap],{cwd:fixture,env:{...process.env,NODE_OPTIONS:'',BAMBI_PORT:String(port),BAMBI_DATABASE:join(fixture,'profile.sqlite'),BAMBI_DESKTOP_SMOKE:'0',BAMBI_DESKTOP_ALPHA:'1',BAMBI_MODELS_ROOT:models,BAMBI_LLM_URL:'http://127.0.0.1:1',BAMBI_TTS_URL:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe','ipc']});
let logs='',browser;server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
try{
 for(let attempt=0;attempt<100;attempt++){if(server.exitCode!==null)throw Error('Fixture startup failed: '+logs);try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 const catalog=await(await fetch(base+'/api/models/catalog')).json();assert.equal(catalog.alternatives.length,6);
 const blocked=await fetch(base+'/api/models/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'https://example.invalid/model'})});assert.equal(blocked.status,400);
 const unconfirmed=await fetch(base+'/api/models/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'bambi-qwen35-9b-defiant-fable:iq4_xs'})});assert.equal(unconfirmed.status,400);
 assert.equal((await(await fetch(base+'/api/models/setup')).json()).model,'bambi-qwen35-9b-hauhau:q4_k_m');
 browser=await chromium.launch({headless:true,...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{})});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(String(error)));
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
 const dialog=page.locator('#model-onboarding');await dialog.waitFor({state:'visible'});
 await page.getByRole('button',{name:'Choose a model',exact:true}).click();await page.locator('.model-choice').last().waitFor();assert.equal(await page.locator('.model-choice').count(),6);assert.equal(downloadRequests,0);
 await page.locator('.model-choice').filter({hasText:'Defiant Fable'}).click();await page.getByRole('button',{name:'Review download'}).click();
 const download=page.getByRole('button',{name:'Download and verify',exact:true});assert(await download.isDisabled());
 await page.getByRole('checkbox',{name:/I want to try/}).check();assert(await download.isEnabled());await Promise.all([page.waitForResponse(response=>response.url()===base+'/api/models/setup/install'),download.click()]);
 assert.equal(downloadRequests,1);
 assert.equal((await(await fetch(base+'/api/models/setup')).json()).model,'bambi-qwen35-9b-defiant-fable:iq4_xs');
 await page.getByRole('button',{name:'Return to companion'}).click();await dialog.waitFor({state:'hidden'});
 await page.reload();await page.locator('#local-models-open').waitFor({state:'attached'});assert(!(await dialog.isVisible()));
 await page.locator('[data-nav=extras]').click();await page.locator('#local-models-open').click();await dialog.waitFor({state:'visible'});
 await page.getByRole('button',{name:'Set up later',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.locator('#privacy-access-open').click();await privacy.waitFor({state:'visible'});assert(await privacy.locator('[name=localClock]').isChecked());assert(!existsSync(locationCalls));
 await privacy.locator('[name=approximateLocation]').check();await privacy.getByRole('button',{name:'Find approximate place',exact:true}).click();await privacy.locator('[data-place]').filter({hasText:'Berlin'}).waitFor();
 let savedAccess=await(await fetch(base+'/api/access')).json();assert.equal(savedAccess.place.city,'Berlin');assert.equal(savedAccess.place.ip,undefined);assert.equal(savedAccess.place.latitude,undefined);assert.equal(readFileSync(locationCalls,'utf8'),'1');
 assert.equal(await privacy.locator('[data-required]:checked:disabled').count(),3);assert.equal(savedAccess.choices.contextToCloud,true);
 await page.setViewportSize({width:390,height:844});assert(await privacy.evaluate(node=>node.scrollWidth<=node.clientWidth));await page.screenshot({path:join(root,'.runtime/privacy-access-preview.png')});
 await privacy.locator('[name=approximateLocation]').uncheck();await privacy.locator('[name=modelDownloads]').uncheck();await privacy.locator('[name=cloudAI]').uncheck();await privacy.locator('[name=devices]').uncheck();await privacy.getByRole('button',{name:'Save and continue',exact:true}).click();await privacy.waitFor({state:'hidden'});
 savedAccess=await(await fetch(base+'/api/access')).json();assert.equal(savedAccess.place,null);assert.equal(savedAccess.choices.contextToCloud,false);assert.equal(savedAccess.choices.cloudAI,false);assert.equal((await fetch(base+'/api/access/location',{method:'POST'})).status,403);assert.equal(readFileSync(locationCalls,'utf8'),'1');
 assert.equal((await fetch(base+'/api/models/setup/install',{method:'POST'})).status,403);
 let deviceRequests=0;await page.route('**/api/devices/scan',route=>{deviceRequests++;return route.fulfill({json:{devices:[]}});});
 await page.locator('[data-nav=devices]').click();await page.locator('#device-scan').click();await privacy.waitFor({state:'visible'});
 assert.equal(deviceRequests,0);assert(!(await privacy.locator('[name=devices]').isChecked()));assert.equal(await privacy.locator('[data-required]:checked:disabled').count(),3);
 await privacy.getByRole('button',{name:'Cancel',exact:true}).click();await privacy.waitFor({state:'hidden'});
 await page.locator('#device-scan').click();await privacy.waitFor({state:'visible'});await privacy.getByRole('button',{name:'Keep optional access off',exact:true}).click();await privacy.waitFor({state:'hidden'});
 assert(Object.values((await(await fetch(base+'/api/access')).json()).choices).every(value=>value===false));assert.equal(deviceRequests,0);
 await page.reload();await page.locator('#privacy-access-open').waitFor({state:'attached'});assert(!(await privacy.isVisible()));
 await page.goto(base+'/setup');await page.getByRole('button',{name:'Choose a model',exact:true}).click();await page.locator('.model-choice').last().waitFor();assert.equal(await page.locator('.model-choice').count(),6);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:join(root,'.runtime/model-setup-preview.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Passed: preselected first-run choices with fail-closed access, checked disabled required functions, one cloud switch, on-demand device access, saved permissions, mocked IP lookup with coarse-only storage, revocation and deletion, catalog, arbitrary-download rejection, first-run wizard, explicit experimental opt-in/download, saved model, dismissal persistence, settings reopen, Setup page, mobile layout and no browser errors.');
}finally{
 await browser?.close();server.kill('SIGTERM');await Promise.race([once(server,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);if(server.exitCode===null)server.kill('SIGKILL');rmSync(fixture,{recursive:true,force:true});
}
