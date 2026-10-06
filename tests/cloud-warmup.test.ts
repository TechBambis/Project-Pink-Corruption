// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CLOUD_MODEL_ALIAS} from '../packages/ai/cloud';

test('real remote preparation can finish beyond the former fixed deadline and still supports cancellation', {timeout:15000}, async()=>{
 const fixture=mkdtempSync(join(tmpdir(),'bambi-cloud-warmup-'));
 let generated=0,requestsClosed=0;
 const provider=createServer(async(req,res)=>{
  if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'test-qwen:latest'}]}));return;}
  assert.equal(req.url,'/api/chat');
  const parts=[];for await(const part of req)parts.push(part);
  const body=JSON.parse(Buffer.concat(parts).toString());
  assert.equal(body.model,'test-qwen:latest');assert.equal(body.think,false);
  assert.equal(body.options.num_ctx,32768);assert.equal(body.options.num_predict,1);
  generated++;
  const timer=setTimeout(()=>res.end('{"message":{"content":"Ready"},"done":true}\n'),250);
  res.on('close',()=>{requestsClosed++;clearTimeout(timer);});
 });
 provider.listen(0,'127.0.0.1');await once(provider,'listening');
 const providerPort=(provider.address() as {port:number}).port;
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
 for(const name of ['packages','presets','voices','apps','docs','dist','config','scripts','node_modules'])symlinkSync(resolve(name),join(fixture,name),process.platform==='win32'?'junction':'dir');
 writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
 writeFileSync(join(fixture,'bootstrap.mjs'),`
  import dgram from 'node:dgram';
  import {EventEmitter} from 'node:events';
  dgram.createSocket=()=>{const socket=new EventEmitter();socket.bind=(_p,_h,callback)=>callback?.();socket.unref=()=>socket;socket.send=()=>{};socket.close=()=>{};return socket;};
  const timeout=AbortSignal.timeout.bind(AbortSignal);
  // Accelerate long deadlines: the old two-minute limit fires before the
  // provider finishes, while the configured longer limit permits completion.
  AbortSignal.timeout=ms=>timeout(ms===120000?100:ms>=60000?1000:ms);
  const nativeFetch=globalThis.fetch;
  globalThis.fetch=(url,options)=>String(url).startsWith('http://127.0.0.1:${providerPort}')?nativeFetch(url,options):Promise.resolve(new Response('{}',{status:503}));
  await import(${JSON.stringify(new URL('../apps/server/index.ts',import.meta.url).href)});
 `);
 const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^BAMBI_|^OLLAMA_/.test(key)));
 const child=spawn(process.execPath,['--import','tsx','bootstrap.mjs'],{cwd:fixture,env:{...inherited,BAMBI_PORT:String(port),BAMBI_DATABASE:':memory:',BAMBI_CLOUD_URL:`http://127.0.0.1:${providerPort}`,BAMBI_CLOUD_MODEL:'test-qwen:latest',BAMBI_CLOUD_KIND:'ollama',BAMBI_CLOUD_CONTEXT:'32768',BAMBI_CLOUD_TIMEOUT_MS:'230000'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
 const base=`http://127.0.0.1:${port}`;
 try{
  let ready=false;for(let n=0;n<80;n++){
   if(child.exitCode!==null)throw Error('Fixture server failed: '+logs);
   try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}
   await new Promise(done=>setTimeout(done,50));
  }
  assert.ok(ready);
  const settings={model:CLOUD_MODEL_ALIAS,promptId:'bambisleep-classic',username:'Test',speak:false,context:32768};
  const tooLarge=await fetch(base+'/api/warm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,selectedTriggers:Array.from({length:100},(_,i)=>('CUSTOM_TRIGGER_'+i+'_').padEnd(100,'A'))})});
  assert.equal(tooLarge.status,503);assert.match((await tooLarge.json()).error,/too little context/);assert.equal(generated,0,'Overflow must fail before provider generation');
  const response=await fetch(base+'/api/warm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});
  assert.equal(response.status,200);const prepared=await response.json();assert.equal(prepared.ok,true);assert.equal(prepared.contextCheck.tokenCount,'estimate');assert.equal(prepared.contextCheck.budgets.length,6);assert.equal(generated,1);
  const controller=new AbortController();
  const cancelled=assert.rejects(fetch(base+'/api/warm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings),signal:controller.signal}),{name:'AbortError'});
  for(let n=0;n<40&&generated<2;n++)await new Promise(done=>setTimeout(done,10));
  assert.equal(generated,2);controller.abort();await cancelled;
  for(let n=0;n<40&&requestsClosed<2;n++)await new Promise(done=>setTimeout(done,10));
  assert.equal(requestsClosed,2);
 }finally{
  child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(done=>setTimeout(done,1500))]);
  if(child.exitCode===null)child.kill('SIGKILL');
  provider.closeAllConnections();await new Promise<void>(done=>provider.close(()=>done()));rmSync(fixture,{recursive:true,force:true});
 }
});
