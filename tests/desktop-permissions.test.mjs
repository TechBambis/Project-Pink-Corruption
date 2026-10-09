// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {permissionHandlers}=createRequire(import.meta.url)('../apps/desktop/permission-policy.cjs');
const origin='http://127.0.0.1:19699',contents={getURL:()=>origin+'/'};
const audio={isMainFrame:true,mediaTypes:['audio']};
const ask=(handlers,who=contents,type='media',details=audio)=>new Promise(resolve=>handlers.request(who,type,resolve,details));
test('desktop microphone requests recheck current consent and fail closed on backend errors',async()=>{
 let enabled=false;const handlers=permissionHandlers({alpha:true,origin,ownedContents:()=>contents,readAccess:async()=>({configured:true,choices:{microphone:enabled}})});
 assert.equal(handlers.check(),false);assert.equal(await ask(handlers),false);
 enabled=true;assert.equal(await ask(handlers),true);enabled=false;assert.equal(await ask(handlers),false);
 const failing=permissionHandlers({alpha:true,origin,ownedContents:()=>contents,readAccess:async()=>{throw Error('Offline');}});assert.equal(await ask(failing),false);
});
test('desktop policy rejects camera, GPS, subframes, foreign windows and smoke audio',async()=>{
 let reads=0;const options={alpha:true,origin,ownedContents:()=>contents,readAccess:async()=>{reads++;return {configured:true,choices:{microphone:true}};}};
 const handlers=permissionHandlers(options);
 for(const details of [{isMainFrame:false,mediaTypes:['audio']},{isMainFrame:true,mediaTypes:['audio','video']},{isMainFrame:true,mediaTypes:['video']}])assert.equal(await ask(handlers,contents,'media',details),false);
 assert.equal(await ask(handlers,contents,'geolocation',audio),false);assert.equal(await ask(handlers,{getURL:()=>origin+'/'},'media',audio),false);
 assert.equal(await ask(permissionHandlers({...options,alpha:false})),false);assert.equal(reads,0);
});
test('native microphone prompt follows app consent and rejects OS denial or errors',async()=>{
 let enabled=false,calls=0,osAllowed=false;
 const options={alpha:true,origin,ownedContents:()=>contents,readAccess:async()=>({configured:true,choices:{microphone:enabled}}),askSystemAccess:async()=>{calls++;return osAllowed;}};
 assert.equal(await ask(permissionHandlers(options)),false);assert.equal(calls,0);
 enabled=true;assert.equal(await ask(permissionHandlers(options)),false);assert.equal(calls,1);
 osAllowed=true;assert.equal(await ask(permissionHandlers(options)),true);
 assert.equal(await ask(permissionHandlers({...options,askSystemAccess:async()=>{throw Error('OS unavailable');}})),false);
});
test('native microphone approval cannot outlive app consent or its owning local page',async()=>{
 let enabled=true,url=origin+'/',resolvePrompt;
 const page={getURL:()=>url};const options={alpha:true,origin,ownedContents:()=>page,readAccess:async()=>({configured:true,choices:{microphone:enabled}}),askSystemAccess:()=>new Promise(resolve=>{resolvePrompt=resolve;})};
 const revoked=ask(permissionHandlers(options),page);await new Promise(resolve=>setImmediate(resolve));enabled=false;resolvePrompt(true);assert.equal(await revoked,false);
 enabled=true;const navigated=ask(permissionHandlers(options),page);await new Promise(resolve=>setImmediate(resolve));url='https://example.com/';resolvePrompt(true);assert.equal(await navigated,false);
});
