// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DesktopSetup,type Asset} from '../packages/runtime/desktop-setup';

const asset=(path:string,bytes:Buffer):Asset=>({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:'https://example.invalid/model',license:'test'});
test('verified copy activates only correct bytes; damaged input preserves installed assets and retry recovers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bambi-setup-'));const data=join(root,'data'),source=join(root,'source');await mkdir(source);const first=Buffer.from('public first'),second=Buffer.from('public second');const assets=[asset('a',first),asset('b',second)],setup=new DesktopSetup(data,assets);
 try{
  await writeFile(join(source,'a'),first);await writeFile(join(source,'b'),'wrong bytes');await setup.install(source);assert.equal(setup.state.phase,'failed');assert.equal(setup.verified,false);assert.deepEqual(await readFile(join(data,'a')),first);assert(!(await readdir(data)).some(n=>n.endsWith('.partial')));
  await writeFile(join(source,'b'),second);await setup.install(source);assert.equal(setup.state.phase,'installed');assert.equal(setup.verified,true);await writeFile(join(data,'b'),Buffer.alloc(second.length));await setup.check();assert.equal(setup.verified,false);assert.equal(setup.state.phase,'partial');assert.deepEqual(setup.snapshot.missing,['b']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('model-directory symlink cannot overwrite an unrelated file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bambi-setup-link-'));const data=join(root,'data'),source=join(root,'source'),foreign=join(root,'foreign');for(const p of [data,source,foreign])await mkdir(p);const bytes=Buffer.from('verified');await writeFile(join(source,'model'),bytes);await writeFile(join(foreign,'model'),'keep this');await symlink(foreign,join(data,'nested'),process.platform==='win32'?'junction':'dir');
 try{const setup=new DesktopSetup(data,[asset('nested/model',bytes)]);await setup.install(source);assert.equal(setup.state.phase,'failed');assert.equal(await readFile(join(foreign,'model'),'utf8'),'keep this');}finally{await rm(root,{recursive:true,force:true});}
});
test('cancelled bounded download removes its partial and retry retains prior verified files',async()=>{
 const {createServer}=await import('node:http');const root=await mkdtemp(join(tmpdir(),'bambi-setup-cancel-'));const payload=Buffer.alloc(1024*1024,42),pin=asset('download',payload);const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Length':payload.length});let sent=0;const timer=setInterval(()=>{if(sent>=payload.length){clearInterval(timer);res.end();return;}res.write(payload.subarray(sent,sent+4096));sent+=4096;},5);res.on('close',()=>clearInterval(timer));});await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));const address=server.address() as {port:number};pin.url=`http://127.0.0.1:${address.port}/fixed-fixture`;const setup=new DesktopSetup(root,[pin]);
 try{const job=setup.install();while(setup.state.completed<4096)await new Promise(r=>setTimeout(r,5));setup.cancel();await job;assert.equal(setup.state.phase,'cancelled');assert.equal(setup.verified,false);assert(!(await readdir(root)).some(n=>n.endsWith('.partial')));await setup.install();assert.equal(setup.verified,true);assert.deepEqual(await readFile(join(root,'download')),payload);}finally{await new Promise<void>(accept=>server.close(()=>accept()));await rm(root,{recursive:true,force:true});}
});
test('revoking a download permission stops transfer and removes the staged file',async()=>{
 const {createServer}=await import('node:http');const root=await mkdtemp(join(tmpdir(),'bambi-setup-consent-'));
 const payload=Buffer.alloc(64*1024,42),pin=asset('download',payload),lease=new AbortController();
 const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Length':payload.length});const timer=setInterval(()=>res.write(payload.subarray(0,1024)),5);res.on('close',()=>clearInterval(timer));});
 await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));pin.url=`http://127.0.0.1:${(server.address() as {port:number}).port}/consent-fixture`;
 const setup=new DesktopSetup(root,[pin]);
 try{
  const running=setup.install(undefined,lease.signal),deadline=Date.now()+5000;
  while(setup.state.completed<1024){assert(Date.now()<deadline,'Fixture download did not start');await new Promise(resolve=>setTimeout(resolve,5));}
  lease.abort();await running;assert.equal(setup.state.phase,'cancelled');assert.equal(setup.verified,false);
  assert(!(await readdir(root)).some(name=>name.endsWith('.partial')));
 }finally{await new Promise<void>(accept=>server.close(()=>accept()));await rm(root,{recursive:true,force:true});}
});
test('an existing model file can be imported independently of speech; missing speech stays explicit and checksums remain mandatory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bambi-single-model-')),data=join(root,'data'),source=join(root,'other-repository');await mkdir(source);const bytes=Buffer.from('reviewed-model-fixture'),voice=Buffer.from('reviewed-voice');
 const file=join(source,'renamed.gguf');await writeFile(file,bytes);const setup=new DesktopSetup(data,[asset('chat.gguf',bytes),asset('voice.onnx',voice)]);
 try{
  await setup.install(source,undefined,file);assert.equal(setup.state.phase,'partial');assert.equal(setup.verified,false);assert.equal(setup.snapshot.remainingBytes,voice.length);assert.deepEqual(setup.snapshot.missing,['voice.onnx']);assert.deepEqual(await readFile(file),bytes);
  await setup.check();assert.equal(setup.state.phase,'partial');await writeFile(join(source,'voice.onnx'),voice);await setup.install(source,undefined,file);assert(setup.verified);assert.equal(setup.state.phase,'installed');
  const damaged=new DesktopSetup(join(root,'damaged'),[asset('chat.gguf',bytes)]);await writeFile(file,Buffer.alloc(bytes.length));await damaged.install(source,undefined,file);assert.equal(damaged.state.phase,'failed');assert.equal(damaged.verified,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a download that stops delivering data fails visibly, keeps prior verified assets and removes its partial file',async()=>{
 const {createServer}=await import('node:http');const root=await mkdtemp(join(tmpdir(),'bambi-download-stall-')),first=Buffer.from('retained'),second=Buffer.alloc(4096,42);
 const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Length':second.length});res.write(second.subarray(0,1024));});await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));
 const pins=[asset('first',first),asset('second',second)];pins[1].url=`http://127.0.0.1:${(server.address() as {port:number}).port}/stall`;await writeFile(join(root,'first'),first);const setup=new DesktopSetup(root,pins,true,{downloadIdleMs:100});
 try{await setup.install();assert.equal(setup.state.phase,'failed');assert.match(setup.snapshot.error!,/stopped receiving data/);assert.equal(setup.snapshot.operation,'download');assert.equal(setup.snapshot.assetIndex,2);assert.equal(setup.snapshot.assetCount,2);assert.equal(setup.snapshot.assetCompleted,1024);assert(setup.snapshot.updatedAt!>=setup.snapshot.startedAt!);assert.deepEqual(await readFile(join(root,'first')),first);assert(!(await readdir(root)).some(n=>n.endsWith('.partial')));}
 finally{server.closeAllConnections();await new Promise<void>(accept=>server.close(()=>accept()));await rm(root,{recursive:true,force:true});}
});
