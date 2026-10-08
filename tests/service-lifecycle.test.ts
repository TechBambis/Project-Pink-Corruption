// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {ServiceLifecycle} from '../packages/runtime/service-lifecycle';

test('different simultaneous model requests load their own model in order; matching ready requests reuse it',async()=>{
 const events:string[]=[];let resident:string|null=null;
 const lifecycle=new ServiceLifecycle({ready:model=>resident===model,stop:async()=>{events.push('stop');resident=null;},
  start:async(model)=>{events.push(model);await Promise.resolve();resident=model;}});
 await Promise.all([lifecycle.prepare('small',4096),lifecycle.prepare('large',24576)]);
 assert.deepEqual(events,['stop','small','stop','large']);assert.deepEqual(lifecycle.state,{phase:'ready',model:'large'});
 await lifecycle.prepare('large',24576);assert.equal(events.length,4);
 resident=null;assert.equal(lifecycle.state.phase,'failed');await lifecycle.prepare('large',24576);assert.equal(events.at(-1),'large');
});

test('stop cancels active and queued preparation, removes services and allows a new request afterward',async()=>{
 let started!:()=>void;const reached=new Promise<void>(resolve=>{started=resolve;});let resident:string|null=null;const loaded:string[]=[];
 const lifecycle=new ServiceLifecycle({ready:model=>resident===model,stop:async()=>{resident=null;},start:async(model,_context,signal)=>{
  loaded.push(model);if(model==='slow'){started();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}
  signal.throwIfAborted();resident=model;
 }});
 const active=lifecycle.prepare('slow',4096),queued=lifecycle.prepare('obsolete',4096);
 // Attach rejection handlers before stop aborts the active work.
 const results=Promise.allSettled([active,queued]);await reached;const stopping=lifecycle.stop();await stopping;
 assert((await results).every(result=>result.status==='rejected'));assert.deepEqual(loaded,['slow']);assert.equal(resident,null);assert.equal(lifecycle.state.phase,'idle');
 await lifecycle.prepare('fresh',4096);assert.equal(resident,'fresh');
});

test('one caller cancellation does not strand the queue or silently satisfy another caller',async()=>{
 const cancelled=new AbortController();cancelled.abort();let resident:string|null=null;
 const lifecycle=new ServiceLifecycle({ready:model=>resident===model,stop:async()=>{resident=null;},start:async(model)=>{resident=model;}});
 const outcomes=await Promise.allSettled([lifecycle.prepare('cancelled',4096,cancelled.signal),lifecycle.prepare('wanted',4096)]);
 assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');assert.equal(resident,'wanted');
});

test('failed preparation cleans a partial start and a later retry can recover',async()=>{
 let attempt=0,resident:string|null=null,stops=0;
 const lifecycle=new ServiceLifecycle({ready:model=>resident===model,stop:async()=>{stops++;resident=null;},start:async(model)=>{resident=model;if(++attempt===1)throw Error('native loader failed');}});
 await assert.rejects(lifecycle.prepare('model',4096),/native loader/);assert.equal(resident,null);assert.equal(stops,2);assert.equal(lifecycle.state.phase,'failed');
 await lifecycle.prepare('model',4096);assert.equal(lifecycle.state.phase,'ready');
});
