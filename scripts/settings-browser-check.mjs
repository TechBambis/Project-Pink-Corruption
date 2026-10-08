// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Actual browser/server settings checks with isolated profiles, ports and simulated services.
import {createServer} from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {settingsDefaults,settingsRegistry} from '../packages/settings/index.ts';
import {createSettingsFile} from '../packages/settings/transfer.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=mkdtempSync(join(tmpdir(),'bambi-settings-browser-'));
const evidence=join(root,'.runtime/settings-evidence');mkdirSync(evidence,{recursive:true});
const report={scope:'Isolated real server and Chromium; no AI model downloads, inference, microphone capture or physical devices. Baseline server executable → feature server, same private profile.',checks:[],errors:[]};
const check=text=>{report.checks.push(text);console.log('PASS '+text);};
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(done=>reservation.close(done));
const base=`http://127.0.0.1:${port}`,database=join(fixture,'profile.sqlite'),models=join(fixture,'models');mkdirSync(models);writeFileSync(join(models,'retained-fixture.gguf'),'isolated model fixture, never loaded');
for(const name of ['apps','packages','config','scripts','presets','voices','docs','dist','assets','node_modules'])if(existsSync(join(root,name)))symlinkSync(join(root,name),join(fixture,name),process.platform==='win32'?'junction':'dir');
writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^BAMBI_|^OLLAMA_|^NODE_OPTIONS$/.test(key)));
const environment={...inherited,BAMBI_PORT:String(port),BAMBI_DATABASE:database,BAMBI_MODELS_ROOT:models,BAMBI_LLM_URL:'http://127.0.0.1:1',BAMBI_TTS_URL:'http://127.0.0.1:1',BAMBI_CLOUD_URL:'',BAMBI_CLOUD_API_KEY:'',BAMBI_INSTANCE_TOKEN:'settings-fixture-owned-ipc'};
let server,browser,auditPage,logs='';
const request=async(path,method='GET',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const get=async(path)=>{const response=await request(path);assert(response.ok,path);return response.json();};
const launch=async(source,alpha=false)=>{
 const bootstrap=join(fixture,'bootstrap.mjs');writeFileSync(bootstrap,`
  import dgram from 'node:dgram';import {EventEmitter} from 'node:events';
  dgram.createSocket=()=>{const socket=new EventEmitter();socket.bind=(_p,_h,callback)=>callback?.();socket.unref=()=>socket;socket.send=()=>{};socket.close=()=>{};return socket;};
  globalThis.fetch=async()=>new Response('{}',{status:503});
  await import(${JSON.stringify(pathToFileURL(join(source,'apps/server/index.ts')).href)});
 `);
 server=spawn(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),bootstrap],{cwd:fixture,env:{...environment,BAMBI_DESKTOP_ALPHA:alpha?'1':'0'},stdio:['ignore','pipe','pipe','ipc']});logs='';server.stdout.on('data',data=>logs+=data);server.stderr.on('data',data=>logs+=data);
 for(let attempt=0;attempt<100;attempt++){if(server.exitCode!==null)throw Error('Settings fixture startup failed: '+logs);try{if((await request('/api/health')).ok)return;}catch{}await new Promise(done=>setTimeout(done,100));}throw Error('Settings server timeout: '+logs);
};
const stop=async()=>{if(server&&server.exitCode===null){const closed=once(server,'close');server.kill('SIGTERM');await closed;}server=null;};
try{
 // Run the verified pre-feature source executable, then replace it while retaining private data.
 const baseline=join(fixture,'baseline');mkdirSync(baseline);const archive=join(fixture,'baseline.tar');
 execFileSync('git',['archive','58b4887','--output',archive],{cwd:root});execFileSync('tar',['-xf',archive,'-C',baseline]);symlinkSync(join(root,'node_modules'),join(baseline,'node_modules'),process.platform==='win32'?'junction':'dir');
 await launch(baseline);
 const old={...settingsDefaults(),master:'0.31',persona:'Retained personal text',duration:'600','duration-version':1,'dialogue-version':1,'visuals-version':2};
 assert.equal((await request('/api/preferences','PUT',old)).status,200);
 await stop();
 const db=new DatabaseSync(database);const oldProfile=JSON.parse(db.prepare("SELECT value FROM preferences WHERE key='profile'").get().value);delete oldProfile['sampling-version'];oldProfile.speed='0.91';db.prepare("UPDATE preferences SET value=? WHERE key='profile'").run(JSON.stringify(oldProfile));db.prepare("INSERT INTO turns(role,content,profile_id,conversation_id) VALUES('user','Retained update history','default','legacy')").run();
 db.prepare('INSERT OR REPLACE INTO preferences VALUES(?,?)').run('model-sources',JSON.stringify({sources:[{path:models,kind:'folder'}]}));db.close();
 const modelBytes=readFileSync(join(models,'retained-fixture.gguf'));
 await launch(root,true);
 const upgraded=await get('/api/settings');assert.equal(upgraded.settings.master,'0.31');assert.equal(upgraded.settings.persona,'Retained personal text');assert.equal(upgraded.settings.duration,'600');assert.equal(upgraded.settings.speed,'0.91','Startup migration preserves explicit legacy voice speed');
 assert((await get('/api/memory/export')).turns.some(turn=>turn.content==='Retained update history'));assert.deepEqual(readFileSync(join(models,'retained-fixture.gguf')),modelBytes);
 const upgradedDB=new DatabaseSync(database);assert.equal(JSON.parse(upgradedDB.prepare("SELECT value FROM preferences WHERE key='model-sources'").get().value).sources[0].path,models);upgradedDB.close();
 check('New source executable retains settings, model files/references and history from baseline 58b4887 in the same profile');
 const choices={microphone:false,devices:false,modelDownloads:false,onlineMedia:false,cloudAI:false,localClock:false,approximateLocation:false,contextToCloud:false};assert.equal((await request('/api/access','PUT',choices)).status,200);await request('/api/models/onboarding','POST',{});
 const before=await get('/api/settings');assert.equal((await request('/api/preferences','PUT',{revision:before.revision,settings:{master:'2'}})).status,400);assert.deepEqual(await get('/api/settings'),before);
 assert.equal((await request('/api/preferences','PUT',{master:'.4'})).status,400);assert.equal((await request('/api/preferences','PUT',{revision:99,settings:{master:'.4'}})).status,409);
 check('HTTP API rejects invalid ranges, unversioned writes and stale revisions without changing storage');
 browser=await chromium.launch({headless:true,...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{})});const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});const page=auditPage=await context.newPage();
 page.on('pageerror',error=>report.errors.push(String(error)));
 const forbidden=[],dangerousCommands=[];
 const watchEffects=p=>{
  p.on('request',req=>{if(req.method()==='POST'&&/\/(warm|transcribe|events\/render|tts|devices\/(connect|scan)|models\/setup\/install|desktop\/setup\/(install|import))$/.test(new URL(req.url()).pathname))forbidden.push(req.url());});
  p.on('websocket',socket=>socket.on('framesent',event=>{try{const message=JSON.parse(String(event.payload));if(['chat','device-command','device-test'].includes(message.type)||message.type==='device-config'&&message.settings?.enabled)dangerousCommands.push(message);}catch{}}));
 };watchEffects(page);
 const ready=async(p=page)=>{await p.waitForFunction(()=>window.bambi);await p.locator('#settings-save-status[data-state="saved"]').waitFor({state:'attached'});};
 const edit=async(id,value,p=page)=>p.evaluate(({id,value})=>{const field=document.getElementById(id);if(typeof value==='boolean')field.checked=value;else field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));},{id,value});
 await page.goto(base);await ready();await page.locator('[data-nav=extras]').click();assert.equal(await page.locator('#persona').inputValue(),'Retained personal text');
 // Fail the actual preference PUT, then reopen the same browser profile.
 let fail=true;await page.route('**/api/preferences',route=>route.request().method()==='PUT'&&fail?route.fulfill({status:503,json:{error:'Simulated disk failure'}}):route.continue());
 await edit('master','0.22');await page.locator('#settings-save-status[data-state="error"]').waitFor({state:'visible'});
 assert.equal((await get('/api/settings')).settings.master,'0.31');await page.reload();await page.waitForFunction(()=>window.bambi);await page.locator('[data-nav=extras]').click();assert.equal(await page.locator('#master').inputValue(),'0.22');
 await page.locator('#settings-save-status[data-state="error"]').waitFor({state:'visible'});fail=false;await page.locator('#settings-retry').click();await ready();assert.equal((await get('/api/settings')).settings.master,'0.22');
 check('Failed HTTP save is visible; reopening preserves the unsaved local value and explicit retry commits it');
 // A second tab changes another field, then both change the same field.
 const second=await context.newPage();watchEffects(second);second.on('pageerror',error=>report.errors.push(String(error)));await second.goto(base);await ready(second);
 await edit('master','0.24');await ready();await edit('speed','0.89',second);await ready(second);assert.equal((await get('/api/settings')).settings.master,'0.24');assert.equal((await get('/api/settings')).settings.speed,'0.89');
 await edit('master','0.27',second);await ready(second);await edit('master','0.26');await page.locator('#settings-save-status[data-state="conflict"]').waitFor({state:'visible'});assert.equal((await get('/api/settings')).settings.master,'0.27');await page.locator('#settings-keep-draft').click();await ready();assert.equal((await get('/api/settings')).settings.master,'0.26');await second.close();
 check('Two real browser tabs merge disjoint changes and expose overlapping changes for explicit resolution');
 // Export must include the most recent edit, even inside the debounce window.
 await edit('persona','Personal export text');await edit('guided-style','Personal guided direction');await edit('master','0.28');await page.locator('#settings-export').click();await page.locator('#settings-transfer-dialog').waitFor({state:'visible'});
 assert(await page.locator('#settings-section-personal').isChecked());assert(!(await page.locator('#settings-section-machine').isChecked()));assert((await page.locator('#settings-transfer-preview').textContent()).includes('Personal export text'));
 const downloadPromise=page.waitForEvent('download');await page.locator('#settings-transfer-confirm').click();const download=await downloadPromise;const exported=JSON.parse(readFileSync(await download.path(),'utf8'));
 assert.equal(exported.sections.audio.master,'0.28');assert.equal(exported.sections.personal.persona,'Personal export text');assert.equal(exported.version,1);assert.equal(exported.sections.machine,undefined);
 check('Personal export previews sensitive text and flushes the latest debounced change before downloading');
 const snapshotBefore=await get('/api/settings');
 const imported=createSettingsFile({...snapshotBefore.settings,master:'0.19',speed:'0.92',persona:'Imported private text','spiral-depth':'0.57'},'settings','Windows personal file',['audio','personal','visuals']);
 const upload=async(file,name='transfer.bambi-settings.json')=>page.locator('#settings-import-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
 await upload(imported);await page.locator('#settings-transfer-dialog').waitFor({state:'visible'});assert((await page.locator('#settings-transfer-preview').textContent()).includes('Imported private text'));await page.locator('#settings-transfer-cancel').click();assert.deepEqual(await get('/api/settings'),snapshotBefore);
 await upload(imported);await page.locator('#settings-section-personal').uncheck();await page.locator('#settings-section-visuals').uncheck();
 // Exercise stopping an active deterministic session without running inference or audio.
 await page.evaluate(()=>{window.bambi.director.ready();window.bambi.director.start();});assert(await page.evaluate(()=>window.bambi.director.active));await page.locator('#settings-transfer-confirm').click();await page.locator('#settings-transfer-dialog').waitFor({state:'hidden'});
 const selected=await get('/api/settings');assert.equal(selected.settings.master,'0.19');assert.equal(selected.settings.persona,snapshotBefore.settings.persona);assert.equal(selected.settings['spiral-depth'],snapshotBefore.settings['spiral-depth']);assert(!(await page.evaluate(()=>window.bambi.director.active)));assert.equal(await page.locator('#device-enabled').isChecked(),false);
 assert.equal((await get('/api/access')).choices.microphone,false);assert.deepEqual((await get('/api/access')).choices,choices);assert.equal(forbidden.length,0);assert.equal(dangerousCommands.length,0);
 await page.locator('#settings-undo').click();await page.locator('#settings-transfer-status').filter({hasText:'restored to before'}).waitFor();assert.deepEqual((await get('/api/settings')).settings,snapshotBefore.settings);
 check('Import previews changes, cancellation writes nothing, selected sections preserve other values, active session stops, and undo restores atomically');
 // Unknown resources are shown, not inserted as arbitrary options or downloaded.
 const missing=createSettingsFile({...snapshotBefore.settings,model:'missing-linux-model:q4',voice:'custom_missing_voice',master:'0.17'},'preset','Linux recipe',['session','audio']);
 await upload(missing);await page.locator('#settings-requirements').filter({hasText:'missing-linux-model:q4'}).waitFor();await page.locator('#settings-transfer-confirm').click();await page.locator('#settings-transfer-dialog').waitFor({state:'hidden'});assert.equal((await get('/api/settings')).settings.model,snapshotBefore.settings.model);assert.equal((await get('/api/settings')).settings.voice,snapshotBefore.settings.voice);assert.equal(await page.locator('#model option[value="missing-linux-model:q4"]').count(),0);assert.equal(forbidden.length,0);
 check('Missing cross-machine model is explained and preserved without replacement, arbitrary options or downloads');
 // Bad/future formats and machine identities in shareable presets fail before writes.
 for(const file of [{...imported,version:99},{...imported,sections:{audio:{master:'3'}}},{...missing,sections:{machine:{'device-address':'AA:BB:CC:DD:EE:FF'}}},{...missing,sections:{session:{model:'C:\\models\\model.gguf'}}}]){
  const before=await get('/api/settings');await upload(file);await page.locator('#settings-transfer-status').filter({hasText:'Import rejected'}).waitFor();assert.deepEqual(await get('/api/settings'),before);assert(!(await page.locator('#settings-transfer-dialog').isVisible()));
 }
 const legacy={format:'bambi-settings',version:0,kind:'settings',name:'Legacy file',preferences:{master:'.23'}};await upload(legacy);await page.locator('#settings-transfer-dialog').waitFor({state:'visible'});await page.locator('#settings-transfer-confirm').click();await page.locator('#settings-transfer-dialog').waitFor({state:'hidden'});assert.equal((await get('/api/settings')).settings.master,'0.23');
 check('Known legacy file migrates; future versions, invalid ranges, paths and preset machine fields reject without writes');
 await page.locator('#preset-save').click();assert(!(await page.locator('#settings-section-personal').isChecked()));assert.equal(await page.locator('#settings-section-machine').count(),0);await page.locator('#settings-file-name').fill('Quiet evening');await page.locator('#settings-transfer-confirm').click();await page.locator('#settings-transfer-dialog').waitFor({state:'hidden'});
 const presets=await get('/api/settings/presets');assert.equal(presets.length,1);assert.equal(presets[0].name,'Quiet evening');assert.equal(presets[0].sections.personal,undefined);assert.equal(presets[0].sections.machine,undefined);assert(!JSON.stringify(presets).includes('Personal export text'));
 await page.locator('#settings-presets').selectOption('Quiet evening');await page.locator('#preset-apply').click();await page.locator('#settings-transfer-dialog').waitFor({state:'visible'});await page.locator('#settings-transfer-cancel').click();
 await page.reload();await ready();await page.locator('[data-nav=extras]').click();await page.locator('#settings-presets option[value="Quiet evening"]').waitFor({state:'attached'});
 await page.locator('#preset-share').click();const presetDownload=page.waitForEvent('download');await page.locator('#settings-transfer-confirm').click();assert((await presetDownload).suggestedFilename().endsWith('.bambi-preset.json'));
 check('Named presets persist across reload, apply through preview, and share portable files with personal text off');
 // Duplicate import retries preserve their original undo point.
 const current=await get('/api/settings'),operation={revision:current.revision,requestId:crypto.randomUUID(),file:createSettingsFile({...current.settings,master:'.21'},'settings','Duplicate',['audio']),sections:['audio']};
 assert.equal((await request('/api/settings/import','POST',operation)).status,200);const onceImported=await get('/api/settings');assert.equal((await request('/api/settings/import','POST',operation)).status,200);assert.deepEqual(await get('/api/settings'),onceImported);assert.equal((await request('/api/settings/undo','POST',{revision:onceImported.revision})).status,200);assert.equal((await get('/api/settings')).settings.master,current.settings.master);
 check('A duplicate import request is idempotent and does not replace the undo point');
 await page.reload();await ready();await page.locator('[data-nav=extras]').click();await page.screenshot({path:join(evidence,'settings-desktop.png')});
 await page.locator('#settings-export').click();await page.locator('#settings-transfer-dialog').waitFor({state:'visible'});await page.screenshot({path:join(evidence,'settings-export-preview.png')});await page.setViewportSize({width:390,height:844});assert(await page.locator('#settings-transfer-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth));await page.screenshot({path:join(evidence,'settings-mobile-preview.png')});await page.locator('#settings-transfer-cancel').click();
 // A new server database and browser profile model a transfer to a fresh installation.
 await context.close();await stop();environment.BAMBI_DATABASE=join(fixture,'fresh-profile.sqlite');await launch(root,true);await request('/api/access','PUT',choices);await request('/api/models/onboarding','POST',{});
 const freshContext=await browser.newContext();const fresh=await freshContext.newPage();watchEffects(fresh);fresh.on('pageerror',error=>report.errors.push(String(error)));await fresh.goto(base);await ready(fresh);await fresh.locator('[data-nav=extras]').click();await fresh.locator('#settings-import-file').setInputFiles({name:'personal.bambi-settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await fresh.locator('#settings-transfer-dialog').waitFor({state:'visible'});await fresh.locator('#settings-transfer-confirm').click();await fresh.locator('#settings-transfer-dialog').waitFor({state:'hidden'});
 const restored=await get('/api/settings');for(const values of Object.values(exported.sections))for(const [id,value] of Object.entries(values))assert.equal(restored.settings[id],value,'Fresh profile restores '+id);
 check('A fresh server database and browser profile restore every exported ordinary field');
 // Exercise every transferable field through the UI with non-default values wherever supported.
 const candidates=await fresh.evaluate(defaults=>Object.fromEntries(Object.entries(defaults).map(([id,current])=>{
  const control=document.getElementById(id);let candidate=current;
  if(typeof current==='boolean')candidate=!current;
  else if(control.tagName==='SELECT')candidate=[...control.options].find(option=>option.value!==String(current)&&!option.disabled)?.value??current;
  else if(control.type==='range'||control.type==='number')candidate=String(Number(current)===Number(control.max)?Number(control.min):Number(control.max));
  else if(control.type==='color')candidate=current==='#123456'?'#654321':'#123456';
  else if(['persona','guided-style','bambi-name','collar-name'].includes(id))candidate='Transfer fixture – café '+id;
  else if(id==='device-address')candidate='AA:BB:CC:DD:EE:FF';
  else if(id==='device-write-char')candidate='0000fff1-0000-1000-8000-00805f9b34fb';
  else if(id==='trigger-selection')candidate=JSON.stringify(['Fixture trigger']);
  else if(id==='trigger-timing-config'){const config=JSON.parse(String(current));config.enabled=!config.enabled;candidate=JSON.stringify(config);}
  return [id,candidate];
 })),settingsDefaults());
 const varied=settingsDefaults();for(const [id,field] of Object.entries(settingsRegistry))if(field.transfer){const result=field.schema.safeParse(candidates[id]);if(result.success)varied[id]=result.data;}
 assert(Object.entries(varied).filter(([id,value])=>value!==settingsDefaults()[id]).length>100,'More than 100 ordinary fields use non-default values');
 const variedFile=createSettingsFile(varied,'settings','All ordinary fields',['audio','visuals','triggers','session','personal','machine']);
 await fresh.locator('#settings-import-file').setInputFiles({name:'all-fields.bambi-settings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(variedFile))});await fresh.locator('#settings-transfer-dialog').waitFor({state:'visible'});await fresh.locator('#settings-transfer-confirm').click();await fresh.locator('#settings-transfer-dialog').waitFor({state:'hidden'});
 await fresh.locator('#settings-export').click();await fresh.locator('#settings-transfer-dialog').waitFor({state:'visible'});await fresh.locator('#settings-section-machine').check();const variedDownload=fresh.waitForEvent('download');await fresh.locator('#settings-transfer-confirm').click();const reexported=JSON.parse(readFileSync(await(await variedDownload).path(),'utf8'));
 for(const values of Object.values(variedFile.sections))for(const [id,value] of Object.entries(values))assert.equal(reexported.sections[settingsRegistry[id].section][id],value,'Import → UI → export preserves '+id);
 assert.equal((await get('/api/settings')).settings['device-auto-connect'],false);assert.deepEqual((await get('/api/access')).choices,choices);
 check('Every transferable field survives import → UI → export, including more than 100 non-default choices and optional machine settings');
 // The existing Voice Lab also participates in the revision-aware contract.
 const lab=await freshContext.newPage();watchEffects(lab);lab.on('pageerror',error=>report.errors.push(String(error)));
 const labPreset=JSON.parse(readFileSync(join(root,'presets/audio/bambi_local_clean.json'),'utf8'));
 await lab.route('**/api/voice-lab/catalog',route=>route.fulfill({json:{presets:{bambi_local_clean:labPreset},voices:['af_heart','af_sarah'],calibrationText:'Local fixture'}}));
 await lab.route('**/api/voice-lab/comparison',route=>route.fulfill({json:{candidates:[]}}));
 await lab.goto(base+'/voice-lab.html');await lab.locator('#use-preset').waitFor({state:'visible'});await lab.waitForFunction(()=>!document.getElementById('use-preset').disabled&&document.getElementById('runtime').textContent.includes('fully local'));
 await lab.locator('#voice').selectOption('af_sarah');await lab.locator('#speed').fill('0.93');await lab.locator('#use-preset').click();await lab.locator('#status').filter({hasText:'Voice, blend, speed and preset saved'}).waitFor();assert.equal((await get('/api/settings')).settings.voice,'af_sarah');assert.equal((await get('/api/settings')).settings.speed,'0.93');
 await lab.route('**/api/preferences',async route=>{const current=await get('/api/settings');assert.equal((await request('/api/preferences','PUT',{revision:current.revision,settings:{...current.settings,master:'0.32'}})).status,200);await route.continue();});
 await lab.locator('#speed').fill('0.94');await lab.locator('#use-preset').click();await lab.locator('#status').filter({hasText:'Settings changed in another window'}).waitFor();assert.equal((await get('/api/settings')).settings.speed,'0.93');assert.equal(await lab.locator('#speed').inputValue(),'0.94');assert.equal((await get('/api/settings')).settings.master,'0.32');await freshContext.close();
 check('Voice Lab saves acknowledge revisions and expose concurrent changes while retaining edited voice choices');
 assert.equal(forbidden.length,0);assert.equal(dangerousCommands.length,0);assert.deepEqual(report.errors,[]);
 check('Desktop/mobile previews fit the viewport and all browser checks finish without script errors or active service requests');
 writeFileSync(join(evidence,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
}catch(error){if(auditPage){console.error(await auditPage.locator('#settings-save-status').textContent().catch(()=>''));console.error(await auditPage.locator('#settings-transfer-status').textContent().catch(()=>''));await auditPage.screenshot({path:join(evidence,'settings-failure.png')}).catch(()=>{});}console.error(report.errors);throw error;}finally{await browser?.close();await stop();rmSync(fixture,{recursive:true,force:true});}
