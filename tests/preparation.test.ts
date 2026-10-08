// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {CompanionPreparation} from '../apps/web/src/preparation';

test('page preparation and simultaneous Start reuse one request, including after it is ready',async()=>{
 let calls=0,finish!:()=>void;
 const preparation=new CompanionPreparation(async()=>{calls++;await new Promise<void>(resolve=>finish=resolve);});
 const first=preparation.prepare({model:'local',prompt:'Complete instructions'});
 assert.equal(preparation.pending,true);
 assert.equal(preparation.prepare({model:'local',prompt:'Complete instructions'}),first);
 finish();await first;await preparation.prepare({model:'local',prompt:'Complete instructions'});
 assert.equal(preparation.pending,false);
 assert.equal(calls,1);
});

test('changing prompt settings cancels stale preparation without replacing the new result',async()=>{
 const signals:AbortSignal[]=[],finishes:(()=>void)[]=[];
 const preparation=new CompanionPreparation(async(_settings,signal)=>{signals.push(signal);await new Promise<void>(resolve=>finishes.push(resolve));if(signal.aborted)throw signal.reason;});
 const stale=preparation.prepare({voice:'heart'});const rejected=assert.rejects(stale);
 const current=preparation.prepare({voice:'bella'});
 assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);
 finishes[0]();await rejected;finishes[1]();await current;
 assert.equal(preparation.prepare({voice:'bella'}),current);
 preparation.cancel();assert.equal(signals[1].aborted,true);
});

test('a failed preparation can retry identical settings',async()=>{
 let calls=0;
 const preparation=new CompanionPreparation(async()=>{if(++calls===1)throw Error('offline');});
 await assert.rejects(preparation.prepare({model:'local'}),/offline/);
 await preparation.prepare({model:'local'});assert.equal(calls,2);
});

test('failed background settings are remembered until an explicit retry or a change',async()=>{
 let calls=0;const settings={model:'native',context:24576};
 const preparation=new CompanionPreparation(async()=>{if(++calls===1)throw Error('Port busy');});
 await assert.rejects(preparation.prepare(settings),/Port busy/);
 assert.equal(preparation.hasFailed(settings),true);assert.equal(preparation.hasFailed({...settings,model:'another'}),false);
 await preparation.prepare(settings);assert.equal(preparation.hasFailed(settings),false);assert.equal(calls,2);
});

test('synchronous preparation failures cannot leave a fulfilled cached promise',async()=>{
 let calls=0;
 const preparation=new CompanionPreparation(()=>{if(++calls===1)throw Error('Synchronous failure');return Promise.resolve();});
 await assert.rejects(preparation.prepare({model:'native'}),/Synchronous failure/);
 assert.equal(preparation.pending,false);assert.equal(preparation.hasFailed({model:'native'}),true);
 await preparation.prepare({model:'native'});assert.equal(calls,2);
});

test('a cancelled preparation cannot become ready even when its runner ignores cancellation',async()=>{
 let finish!:()=>void;
 const preparation=new CompanionPreparation(async()=>{await new Promise<void>(resolve=>finish=resolve);});
 const obsolete=assert.rejects(preparation.prepare({model:'native'}),{name:'AbortError'});
 preparation.cancel();finish();await obsolete;
 assert.equal(preparation.pending,false);assert.equal(preparation.hasFailed({model:'native'}),false);
});

test('ready settings are rechecked after expiry while pending calls remain shared',async()=>{
 let now=0,calls=0;
 const preparation=new CompanionPreparation(async()=>{calls++;},100,()=>now);
 const first=preparation.prepare({model:'native'});await first;
 now=99;assert.equal(preparation.prepare({model:'native'}),first);assert.equal(calls,1);
 now=100;await preparation.prepare({model:'native'});assert.equal(calls,2);
});
