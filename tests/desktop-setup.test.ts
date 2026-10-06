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
  await writeFile(join(source,'b'),second);await setup.install(source);assert.equal(setup.state.phase,'installed');assert.equal(setup.verified,true);await writeFile(join(data,'b'),Buffer.alloc(second.length));await setup.check();assert.equal(setup.verified,false);assert.equal(setup.state.phase,'not-installed');
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
