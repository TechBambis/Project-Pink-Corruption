// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kvCacheMode,validateKvCache} from '../packages/runtime/kv-cache';
import {communityQwen,communityQwen4B} from '../packages/ai/models';
import {dflashMode,validateDFlash} from '../packages/runtime/dflash';
import {KvCacheControl,dflashOption} from '../apps/web/src/kv-cache';

test('experimental cache selection requires explicit true, the qualified model and Linux',()=>{
 assert.equal(kvCacheMode(true,communityQwen,'linux'),'q8_0');
 for(const enabled of [false,undefined,'true',1])assert.equal(kvCacheMode(enabled,communityQwen,'linux'),'default');
 assert.equal(kvCacheMode(true,'other-model','linux'),'default');
 assert.equal(kvCacheMode(true,communityQwen,'win32'),'default');
 assert.throws(()=>validateKvCache('q8_0','other-model','linux'),/available/);
 assert.throws(()=>validateKvCache('q8_0',communityQwen,'win32'),/Linux/);
});
test('DFlash requires explicit opt-in for 4B on Linux and never applies to 9B',()=>{
 assert.equal(dflashMode(true,communityQwen4B,'linux'),'on');
 for(const enabled of [false,undefined,'true',1])assert.equal(dflashMode(enabled,communityQwen4B,'linux'),'off');
 assert.equal(dflashMode(true,communityQwen,'linux'),'off');assert.equal(dflashMode(true,communityQwen4B,'win32'),'off');
 assert.throws(()=>validateDFlash('on',communityQwen,'linux'),/4B/);
 assert.throws(()=>validateDFlash('on',communityQwen4B,'win32'),/Linux/);
});
test('DFlash control cancels its own endpoint and rolls back without changing the cache setting',async t=>{
 class Input extends EventTarget {checked=false;disabled=false;}
 const input=new Input(),note={textContent:''};let sent!:()=>void;const requested=new Promise<void>(r=>{sent=r;});
 let done!:()=>void;const completed=new Promise<void>(r=>{done=r;});
 t.mock.method(globalThis,'fetch',(url:unknown,options:RequestInit)=>new Promise((_resolve,reject)=>{
  assert.equal(url,'/api/runtime/dflash');assert.deepEqual(JSON.parse(String(options.body)),{enabled:true,model:communityQwen4B});
  options.signal!.addEventListener('abort',()=>reject(options.signal!.reason),{once:true});sent();
 }));
 const control=new KvCacheControl(input as unknown as HTMLInputElement,note as HTMLElement,
  ()=>({supported:true,target:communityQwen4B,model:communityQwen4B,enabled:false,busy:false}),()=>{},done,()=>{},dflashOption);
 control.sync();input.checked=true;input.dispatchEvent(new Event('change'));await requested;assert.equal(control.pending,true);
 control.cancel();await completed;assert.equal(input.checked,false);assert.equal(input.disabled,false);assert.match(note.textContent,/standard 4B/);
});

test('missing server capability asks for a restart rather than incorrectly reporting unsupported Linux',()=>{
 class Input extends EventTarget {checked=false;disabled=false;}
 const input=new Input(),note={textContent:''};let supported:boolean|undefined;
 const control=new KvCacheControl(input as unknown as HTMLInputElement,note as HTMLElement,
  ()=>({supported,target:communityQwen,model:communityQwen,busy:false}),()=>{},()=>{},()=>{});
 control.sync();assert.equal(input.disabled,true);assert.match(note.textContent,/Restart Bambi Local/);
 supported=false;control.sync();assert.equal(input.disabled,true);assert.match(note.textContent,/available on Linux/);
 supported=true;control.sync();assert.equal(input.disabled,false);assert.match(note.textContent,/Off/);
});

test('Stop aborts the cache request, restores its prior selection and clears pending state',async t=>{
 class Input extends EventTarget {checked=false;disabled=false;}
 const input=new Input(),note={textContent:''};let sent!:()=>void;const requested=new Promise<void>(r=>{sent=r;});
 let done!:()=>void;const completed=new Promise<void>(r=>{done=r;});const errors:string[]=[];
 t.mock.method(globalThis,'fetch',(_url:unknown,options:RequestInit)=>new Promise((_resolve,reject)=>{
  options.signal!.addEventListener('abort',()=>reject(options.signal!.reason),{once:true});sent();
 }));
 const control=new KvCacheControl(input as unknown as HTMLInputElement,note as HTMLElement,
  ()=>({supported:true,target:communityQwen,model:communityQwen,enabled:false,busy:false}),()=>{},done,message=>errors.push(message));
 control.sync();input.checked=true;input.dispatchEvent(new Event('change'));await requested;
 assert.equal(control.pending,true);assert.equal(input.disabled,true);
 control.cancel();await completed;
 assert.equal(control.pending,false);assert.equal(input.checked,false);assert.equal(input.disabled,false);assert.deepEqual(errors,[]);
});
