// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('extension retries an open overlay, never replays requests, and cancels retries on close',async()=>{
 let onMessage:any,onRemoved:any;const sockets:any[]=[],timers=new Map<number,()=>void>(),events:any[]=[];let timerId=0;
 class Socket{static OPEN=1;readyState=0;onopen:any;onclose:any;onmessage:any;onerror:any;sent:string[]=[];constructor(_url:string){sockets.push(this);}close(){this.readyState=3;this.onclose?.();}send(data:string){this.sent.push(data);}}
 const browser={browserAction:{onClicked:{addListener(){}}},runtime:{onMessage:{addListener(fn:any){onMessage=fn;}}},tabs:{sendMessage:async(_id:number,data:any)=>{events.push(data);},executeScript:async()=>{},onRemoved:{addListener(fn:any){onRemoved=fn;}},onUpdated:{addListener(){}}}};
 runInNewContext(readFileSync('apps/extension/background.js','utf8'),{browser,WebSocket:Socket,console,setTimeout(fn:()=>void){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id:number){timers.delete(id);}});
 await onMessage({type:'bambi-connect'},{tab:{id:7}});assert.equal(sockets.length,1);sockets[0].readyState=1;sockets[0].onopen();
 await onMessage({type:'bambi-send',data:{type:'chat',text:'Hello'}},{tab:{id:7}});assert.equal(sockets[0].sent.length,1);
 sockets[0].close();assert.equal(timers.size,1);const retry=[...timers.values()][0];timers.clear();retry();assert.equal(sockets.length,2);assert.equal(sockets[1].sent.length,0);
 sockets[1].close();assert.equal(timers.size,1);await onMessage({type:'bambi-disconnect'},{tab:{id:7}});assert.equal(timers.size,0);
 await onMessage({type:'bambi-connect'},{tab:{id:8}});onRemoved(8);assert.equal(timers.size,0);assert.ok(events.some(event=>event.bambiEvent.type==='offline'));
});
