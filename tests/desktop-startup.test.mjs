// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFunction} from 'node:vm';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,lstatSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),source=readFileSync(new URL('../apps/desktop/main.cjs',import.meta.url),'utf8');
const marker='Bambi Local private desktop profile v1\n';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'Bambi startup '));t.after(()=>rmSync(root,{recursive:true,force:true}));const data=join(root,'profile');mkdirSync(data);return {root,data};}
function startup(data,{ownsLock=true,secureStatus=0}={}){
 const events=[],app={commandLine:{hasSwitch:()=>false},enableSandbox(){},getVersion:()=> '0.1.0-smoke.1',setName(){},
  setPath:name=>events.push('path:'+name),requestSingleInstanceLock:()=>{events.push('lock');return ownsLock;},exit:code=>events.push('exit:'+code),quit:()=>events.push('quit'),on(){},
  whenReady:()=>{events.push('ready');return {then:()=>({catch(){}})};}};
 const modules={electron:{app,dialog:{showErrorBox:()=>events.push('error')}},
  'node:child_process':{spawn:()=>{events.push('backend');},spawnSync:()=>{events.push('secure');return {status:secureStatus,stderr:'Public fixture rejection'};}},
  'node:fs':{lstatSync,readFileSync,mkdirSync:()=>events.push('mkdir')},
  './runtime-environment.cjs':{runtimeEnvironment:()=>{events.push('runtime');return {TMPDIR:join(data,'tmp')};}},
  './permission-policy.cjs':{permissionHandlers:()=>({})}};
 const process={platform:'win32',argv:['app','--bambi-user-data='+data],env:{SystemRoot:'C:\\Windows'},resourcesPath:join(data,'resources'),umask(){}};
 compileFunction(source,['require','process','__dirname'])(name=>modules[name]??require(name),process,data);
 return events;
}
test('a marked Windows duplicate exits before native preparation and private runtime writes',t=>{
 const {data}=fixture(t);writeFileSync(join(data,'.bambi-desktop-profile'),marker);
 assert.deepEqual(startup(data,{ownsLock:false}),['path:userData','lock','exit:0']);
});
test('the existing Windows profile owner validates native security before starting its runtime',t=>{
 const {data}=fixture(t);writeFileSync(join(data,'.bambi-desktop-profile'),marker);const events=startup(data);
 assert.equal(events.filter(event=>event==='lock').length,1);assert(events.indexOf('lock')<events.indexOf('secure'));assert(events.indexOf('secure')<events.indexOf('runtime'));assert(events.includes('ready'));
 const rejected=startup(data,{secureStatus:1});assert(rejected.includes('exit:64'));assert(!rejected.includes('runtime'));assert(!rejected.includes('ready'));assert(!rejected.includes('mkdir'));
});
test('missing and malformed Windows markers require native validation before the ownership lock',t=>{
 const {data}=fixture(t);
 for(const value of [undefined,'Unrelated public fixture']){
  if(value!==undefined)writeFileSync(join(data,'.bambi-desktop-profile'),value);
  const events=startup(data);assert(events.indexOf('secure')<events.indexOf('lock'));
  const rejected=startup(data,{secureStatus:1});assert(!rejected.includes('lock'));assert(!rejected.includes('runtime'));
 }
});
test('a linked Windows profile never takes the early marked-profile ownership path',t=>{
 const {root,data}=fixture(t);writeFileSync(join(data,'.bambi-desktop-profile'),marker);const linked=join(root,'linked');symlinkSync(data,linked,process.platform==='win32'?'junction':'dir');
 const events=startup(linked,{secureStatus:1});assert(events.includes('secure'));assert(!events.includes('lock'));assert(!events.includes('runtime'));
});
