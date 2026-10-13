// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {shareCode,readShareCode,readProfileFile,decryptBackup} from '../packages/profiles/codec.ts';
import {portablePreferences} from '../packages/profiles/preferences.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=mkdtempSync(join(tmpdir(),'bambi-profiles-browser-'));
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(done=>reserve.close(done));
const base=`http://127.0.0.1:${port}`,errors=[],remote=[];let browser,app,auditPage,logs='';
writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
writeFileSync(join(fixture,'bootstrap.mjs'),`
 import dgram from 'node:dgram';import {EventEmitter} from 'node:events';
 dgram.createSocket=()=>{const socket=new EventEmitter();socket.bind=(_p,_h,cb)=>cb?.();socket.unref=()=>socket;socket.send=()=>{};socket.close=()=>{};return socket;};
 const {Store}=await import(${JSON.stringify(new URL('../packages/storage/index.ts',import.meta.url).href)});
 const {deniedAccess}=await import(${JSON.stringify(new URL('../packages/safety/access.ts',import.meta.url).href)});
 const store=new Store('fixture.sqlite');store.set('profile',{mode:'local','ai-mode':'off',model:'fixture-model',speed:'0.9','sampling-version':1,'prompt-template':'bambisleep-classic','bambi-name':'Private fixture','persona':'Private custom text','narration-enabled':false,'device-address':'fixture-address'});
 store.set('privacy-access',{version:1,configured:true,choices:deniedAccess,place:null});store.beginConversation();const turn=store.addTurn('user','Private fixture message');store.saveMemory('fixture','private value',turn);
 store.db.prepare('INSERT INTO media VALUES(?,?)').run('fixture.wav',JSON.stringify({id:'fixture.wav',favorite:true,notes:'Private fixture note',tags:'test'}));store.db.close();
 await import(${JSON.stringify(new URL('../apps/server/index.ts',import.meta.url).href)});
`);
const env={...process.env,BAMBI_PORT:String(port),BAMBI_DATABASE:join(fixture,'fixture.sqlite'),BAMBI_DESKTOP_SMOKE:'1'};delete env.BAMBI_DESKTOP_ALPHA;
try{
 app=spawn(process.execPath,['--import',join(root,'node_modules/tsx/dist/loader.mjs'),join(fixture,'bootstrap.mjs')],{cwd:fixture,env,stdio:['ignore','pipe','pipe','ipc']});app.stdout.on('data',data=>logs+=data);app.stderr.on('data',data=>logs+=data);
 for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/preferences')).ok)break;}catch{}await new Promise(done=>setTimeout(done,100));}
 browser=await chromium.launch({headless:true,...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});
 await context.route('**/*',route=>{if(!route.request().url().startsWith(base+'/')&&!/^(blob:|data:)/.test(route.request().url())){remote.push(route.request().url());return route.abort();}return route.continue();});
 const page=auditPage=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const ready=async()=>{await page.waitForFunction(()=>document.getElementById('connection')?.textContent==='Connected locally');await page.waitForTimeout(850);};
 const open=async()=>{await page.locator('[data-nav=extras]').click();await page.locator('#profiles-open').click();await page.waitForFunction(()=>document.getElementById('profiles-dialog').getAttribute('aria-busy')!=='true');};
 await page.goto(base);await ready();await open();
 const migrated=await(await fetch(base+'/api/preferences')).json();assert.equal(migrated.speed,'0.9');assert.equal(migrated.model,'fixture-model');assert.equal(migrated['sampling-version'],2);
 await page.locator('#profiles-generate').click();await page.waitForFunction(()=>document.getElementById('profiles-code-output').value.startsWith('BAMBI1.'));
 const code=await page.locator('#profiles-code-output').inputValue(),decoded=await readShareCode(code);
 assert.equal(decoded.settings.speed,'0.9');assert.equal(decoded.settings.persona,undefined);assert.equal(decoded.settings.model,undefined);assert.equal(decoded.settings['bambi-name'],undefined);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('bambi-profile')));for(const [key,value] of Object.entries(portablePreferences(saved)))assert.equal(decoded.settings[key],value,key);
 await page.locator('#profiles-copy').click();await page.waitForFunction(()=>document.getElementById('profiles-status').textContent.includes('copied'));assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),code);
 let downloading=page.waitForEvent('download');await page.locator('#profiles-export').click();let download=await downloading;const profileText=readFileSync(await download.path(),'utf8');assert.deepEqual((await readProfileFile(profileText)).settings,decoded.settings);
 await page.locator('summary').filter({hasText:'Keep my settings'}).click();downloading=page.waitForEvent('download');await page.locator('#profiles-export-personal').click();download=await downloading;const personal=await readProfileFile(readFileSync(await download.path(),'utf8'));assert.equal(personal.kind,'personal');assert.equal(personal.settings['bambi-name'],'Private fixture');assert.equal(personal.settings.persona,'Private custom text');
 await page.locator('#profiles-personal-text').check();await page.locator('#profiles-generate').click();await page.waitForFunction(()=>document.getElementById('profiles-code-output').value.startsWith('BAMBI1.'));assert.equal((await readShareCode(await page.locator('#profiles-code-output').inputValue())).settings.persona,'Private custom text');await page.locator('#profiles-personal-text').uncheck();assert.equal(await page.locator('#profiles-code-output').inputValue(),'');
 await page.locator('#profiles-code-input').fill(code);await page.locator('#profiles-read-code').click();await page.locator('#profiles-preview').waitFor({state:'visible'});
 const apply=page.locator('#profiles-apply');assert(await apply.isEnabled());
 await page.setViewportSize({width:390,height:844});assert(await page.locator('#profiles-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth));
 mkdirSync(join(root,'.runtime'),{recursive:true});await page.screenshot({path:join(root,'.runtime/profiles-preview.png')});
 await page.locator('#profiles-code-input').fill('BAMBI1.damaged');assert(await apply.isDisabled());await page.locator('#profiles-read-code').click();await page.waitForFunction(()=>document.getElementById('profiles-dialog').getAttribute('aria-busy')!=='true');assert(await apply.isDisabled());assert.equal((await(await fetch(base+'/api/preferences')).json()).speed,'0.9');
 // Shared presets change only selected groups, preserve privacy/model, reload all windows.
 const other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));await other.goto(base);await other.waitForFunction(()=>document.getElementById('connection')?.textContent==='Connected locally');
 const originalTag=(await fetch(base+'/api/library')).headers.get('etag');const originalRevision=(await(await fetch(base+'/api/settings')).json()).revision;
 const changedCode=await shareCode({...decoded,settings:{...decoded.settings,speed:'1.1',scene:'Soft Pink'}});
 await page.locator('#profiles-code-input').fill(changedCode);await page.locator('#profiles-read-code').click();await page.locator('#profiles-preview').waitFor({state:'visible'});
 for(const checkbox of await page.locator('[data-profile-group]').all())await checkbox.setChecked(await checkbox.getAttribute('data-profile-group')==='Voice & sound');
 await Promise.all([page.waitForEvent('domcontentloaded'),other.waitForEvent('domcontentloaded'),apply.click()]);await ready();
 const imported=await(await fetch(base+'/api/preferences')).json();assert.equal(imported.model,'fixture-model');assert.equal(imported.speed,'1.1');assert.equal(imported.scene,decoded.settings.scene);assert.equal(imported['bambi-name'],'Private fixture');assert.equal((await(await fetch(base+'/api/access')).json()).choices.devices,false);
 const stale=await fetch(base+'/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':originalTag},body:JSON.stringify({revision:originalRevision,settings:{speed:'1'}})});assert.equal(stale.status,409);
 const staleLibrary=await fetch(base+'/api/library',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':originalTag},body:'[]'});assert.equal(staleLibrary.status,409);
 await other.close();await open();
 // Password-protected backups contain selected private data, with opt-in replacement.
 await page.locator('summary').filter({hasText:'Encrypted personal backup'}).click();
 await page.locator('#profiles-backup-memory').check();await page.locator('#profiles-backup-library').check();await page.locator('#profiles-password').fill('fixture password');await page.locator('#profiles-password-confirm').fill('fixture password');
 downloading=page.waitForEvent('download');await page.locator('#profiles-backup').click();download=await downloading;const backupText=readFileSync(await download.path(),'utf8'),backup=await decryptBackup(backupText,'fixture password');assert.equal(backup.memory.turns[0].content,'Private fixture message');assert.equal(backup.library[0].notes,'Private fixture note');
 assert.equal((await fetch(base+'/api/memory/facts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'fixture',value:'changed value'})})).status,200);
 const backupTag=(await fetch(base+'/api/library')).headers.get('etag');assert.equal((await fetch(base+'/api/library',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':backupTag},body:JSON.stringify([{id:'fixture.wav',favorite:false,notes:'changed note',tags:'changed'}])})).status,200);
 await page.locator('#profiles-restore-password').fill('wrong password');await page.locator('#profiles-file').setInputFiles({name:'fixture.bambi-backup.json',mimeType:'application/json',buffer:Buffer.from(backupText)});await page.waitForFunction(()=>document.getElementById('profiles-status').textContent.includes('Incorrect password'));assert(await apply.isDisabled());
 await page.locator('#profiles-restore-password').fill('fixture password');await page.locator('#profiles-read-file').click();await page.locator('#profiles-preview').waitFor({state:'visible'});assert(!await page.locator('#profiles-restore-memory').isChecked());assert(!await page.locator('#profiles-restore-library').isChecked());
 await page.locator('#profiles-restore-memory').check();await page.locator('#profiles-restore-library').check();await Promise.all([page.waitForEvent('domcontentloaded'),apply.click()]);await ready();
 assert.equal((await(await fetch(base+'/api/memory')).json()).facts[0].value,'private value');assert.equal((await(await fetch(base+'/api/library')).json())[0].notes,'Private fixture note');
 await open();await page.locator('summary').filter({hasText:'Recover an earlier profile'}).click();assert(await page.locator('#profiles-recovery-list button').count()>=2);
 await page.locator('#profiles-recovery-list button').first().click();await page.locator('#profiles-preview').waitFor({state:'visible'});
 await page.locator('#profiles-close').click();assert.equal(await page.locator('#profiles-restore-password').inputValue(),'');
 // Direct callers are held to the same schema and request-size boundary.
 for(const document of [{...decoded,version:2},{...decoded,settings:{'privacy-access':true}},{...decoded,settings:{speed:'99'}}]){const response=await fetch(base+'/api/profiles/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document,groups:['Voice & sound']})});assert.equal(response.status,400);}
 assert.equal((await fetch(base+'/api/profiles/import',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(17*1024*1024)+'{}'})).status,413);
 assert.equal((await fetch(base+'/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:' '.repeat(129*1024)+'{}'})).status,413);
 assert.equal((await(await fetch(base+'/api/preferences')).json()).speed,'1.1');
 const foreign=await fetch(base+'/api/profiles/backup',{headers:{Origin:'https://foreign.example'}});assert.equal(foreign.status,403);
 assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);console.log(`Offline profile browser check passed: code (${code.length} characters), clipboard, files, encryption, preview, mobile layout, restore, recovery, two-window reload and stale-save protection.`);
} catch(error){console.error(logs.slice(-5000));console.error('Browser status:',await auditPage?.locator('#profiles-status').textContent().catch(()=>''));console.error('Browser errors:',errors);throw error;}
finally{await browser?.close();if(app&&app.exitCode===null){const stopped=once(app,'exit');app.kill('SIGTERM');await stopped;}rmSync(fixture,{recursive:true,force:true});}
