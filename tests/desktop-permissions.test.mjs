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
