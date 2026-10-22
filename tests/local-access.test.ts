// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request, type IncomingHttpHeaders} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {localRequestAllowed} from '../packages/safety/local-access';
import {Kokoro} from '../packages/speech/tts';
import {WebSocket} from 'ws';

test('local admission rejects rebinding, foreign and extension origins, and originless WebSockets', () => {
 const valid = {host:'127.0.0.1:6969', origin:'http://127.0.0.1:6969'};
 assert.equal(localRequestAllowed(valid,6969,true),true);
 assert.equal(localRequestAllowed({host:'localhost:6969'},6969),true);
 for(const headers of [
  {...valid,host:'attacker.example:6969'}, {...valid,host:'127.0.0.1:6970'},
  {...valid,origin:'http://attacker.example'}, {...valid,origin:'null'},
  {...valid,origin:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},
  {...valid,origin:'moz-extension://00000000-0000-0000-0000-000000000000'},
  {...valid,origin:'http://127.0.0.1:6969.attacker.example'},
  {...valid,'sec-fetch-site':'cross-site'}, {host:valid.host,'sec-fetch-site':'cross-site'},
 ])assert.equal(localRequestAllowed(headers,6969),false,JSON.stringify(headers));
 assert.equal(localRequestAllowed({host:valid.host},6969,true),false);
});

test('speech credentials rotate between requests and never go to remote providers', () => {
 const directory=mkdtempSync(join(tmpdir(),'bambi-speech-credential-'));
 const previousFile=process.env.BAMBI_TTS_TOKEN_FILE, previousToken=process.env.BAMBI_TTS_TOKEN;
 const path=join(directory,'access.token');
 try{
  delete process.env.BAMBI_TTS_TOKEN;process.env.BAMBI_TTS_TOKEN_FILE=path;
  const client=new Kokoro();
  assert.equal(client.renderHeaders()['X-Bambi-TTS-Token'],undefined);
  writeFileSync(path,'a'.repeat(64));assert.equal(client.renderHeaders()['X-Bambi-TTS-Token'],'a'.repeat(64));
  writeFileSync(path,'b'.repeat(64));assert.equal(client.renderHeaders()['X-Bambi-TTS-Token'],'b'.repeat(64));
  assert.equal(new Kokoro('https://speech.example').renderHeaders()['X-Bambi-TTS-Token'],undefined);
  writeFileSync(path,'invalid');assert.throws(()=>client.renderHeaders(),/Invalid local speech credential/);
 }finally{
  if(previousFile===undefined)delete process.env.BAMBI_TTS_TOKEN_FILE;else process.env.BAMBI_TTS_TOKEN_FILE=previousFile;
  if(previousToken===undefined)delete process.env.BAMBI_TTS_TOKEN;else process.env.BAMBI_TTS_TOKEN=previousToken;
  rmSync(directory,{recursive:true,force:true});
 }
});

test('real app routes and WebSocket upgrades share the local access boundary', {timeout:20000}, async () => {
 const directory=mkdtempSync(join(tmpdir(),'bambi-local-access-'));
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
 for(const name of ['packages','presets','voices','apps','docs','dist','config','scripts','node_modules'])if(existsSync(resolve(name)))symlinkSync(resolve(name),join(directory,name),process.platform==='win32'?'junction':'dir');
 writeFileSync(join(directory,'package.json'),'{"type":"module"}');
 writeFileSync(join(directory,'bootstrap.mjs'),`
  // Admission/cloud fixtures never launch native hardware discovery. Windows
  // descendants can otherwise retain the fixture directory after app teardown.
  import childProcess from 'node:child_process';
  import {syncBuiltinESMExports} from 'node:module';
  childProcess.execFile=(_command,_args,options,callback)=>{
   const finish=typeof options==='function'?options:callback;
   queueMicrotask(()=>finish(Object.assign(Error('Native commands are excluded from this fixture'),{code:'ENOENT'}),'',''));
   return {kill:()=>false};
  };
  syncBuiltinESMExports();
  import dgram from 'node:dgram';
  import {EventEmitter} from 'node:events';
  dgram.createSocket=()=>{const socket=new EventEmitter();socket.bind=(_p,_h,callback)=>callback?.();socket.unref=()=>socket;socket.send=()=>{};socket.close=()=>{};return socket;};
  globalThis.fetch=async()=>new Response('{}',{status:503});
  await import(${JSON.stringify(new URL('../apps/server/index.ts',import.meta.url).href)});
 `);
 const child=spawn(process.execPath,['--import','tsx','bootstrap.mjs'],{cwd:directory,env:{...process.env,BAMBI_PORT:String(port),BAMBI_DATABASE:':memory:',BAMBI_CLOUD_URL:'',BAMBI_CLOUD_API_KEY:'',BAMBI_TTS_TOKEN_FILE:join(directory,'absent.token')},stdio:['ignore','pipe','pipe']});
 const childClosed=once(child,'close');
 let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 const probe=(path:string,headers:IncomingHttpHeaders={},method='GET',body?:string,upgrade=false)=>new Promise<{status:number;headers:IncomingHttpHeaders}>((done,reject)=>{
  const call=request({host:'127.0.0.1',port,path,method,headers:{...headers,...(upgrade?{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')}:{})}},res=>{res.resume();done({status:res.statusCode!,headers:res.headers});});
  call.on('upgrade',(res,socket)=>{socket.destroy();done({status:res.statusCode!,headers:res.headers});});
  call.on('error',reject);call.setTimeout(3000,()=>call.destroy(Error('Probe timed out')));call.end(body);
 });
 try{
  const deadline=Date.now()+10000;
  while(!output.includes('Bambi Local READY')){
   if(child.exitCode!==null||Date.now()>deadline)throw Error('Isolated app startup failed: '+output);
   await new Promise(done=>setTimeout(done,25));
  }
  for(const path of ['/api/preferences','/api/diagnostics/replies','/api/diagnostics/scenes']){
   assert.equal((await probe(path,{Host:`attacker.example:${port}`})).status,403);
   assert.equal((await probe(path,{Origin:'https://attacker.example'})).status,403);
   assert.equal((await probe(path,{Origin:'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'})).status,403);
   const accepted=await probe(path,{Origin:`http://127.0.0.1:${port}`});assert.equal(accepted.status,200);
   assert.equal(accepted.headers['cache-control'],'no-store');assert.equal(accepted.headers['x-content-type-options'],'nosniff');
  }
  const catalog=await (await fetch(`http://127.0.0.1:${port}/api/content`)).json();
  assert.equal(catalog.docs.length,14);
  for(const path of catalog.docs)assert.equal((await probe('/content/stable-2.0/'+path)).status,200,'In-app guide remains available: '+path);
  for(const path of ['/content/stable-2.0/manifest.json','/content/stable-2.0/workers/ollama.js','/api/hardware'])
   assert.equal((await probe(path)).status,404,'Internal/reference files and retired reports are not served: '+path);
  assert.equal((await probe('/api/preferences',{'Content-Type':'application/json'},'PUT','{broken')).status,400);
  assert.equal((await probe('/api/access',{'Content-Type':'application/json'},'PUT',JSON.stringify({microphone:true,devices:false,modelDownloads:false,onlineMedia:false,cloudAI:false,localClock:false,approximateLocation:false,contextToCloud:false}))).status,200);
  for(const body of ['[]','{"length":44,"0":82}'])assert.equal((await probe('/api/transcribe',{'Content-Type':'application/json'},'POST',body)).status,400);
  for(const query of ['q=one&q=two','q[key]=value'])assert.equal((await probe('/api/knowledge?'+query)).status,400);
  assert.equal((await probe('/api/voice-lab/comparison/unknown')).status,400);
  assert.equal((await probe('/api/preferences',{'Content-Type':'application/json'},'PUT',JSON.stringify({test:'x'.repeat(128*1024)}))).status,413);
  assert.equal((await probe('/ws',{Host:`attacker.example:${port}`},'GET',undefined,true)).status,403);
  assert.equal((await probe('/ws',{},'GET',undefined,true)).status,403);
  assert.equal((await probe('/ws',{Origin:'https://attacker.example'},'GET',undefined,true)).status,403);
  assert.equal((await probe('/ws',{Origin:`http://127.0.0.1:${port}`},'GET',undefined,true)).status,101);
  assert.equal((await probe('/other',{Origin:`http://127.0.0.1:${port}`},'GET',undefined,true)).status,403);
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:`http://127.0.0.1:${port}`});
  socket.on('error',()=>{});
  await once(socket,'open');
  const invalidReply=new Promise<Record<string,unknown>>(done=>socket.on('message',raw=>{const data=JSON.parse(String(raw));if(data.type==='error')done(data);}));
  socket.send('{broken');assert.equal((await invalidReply).text,'Invalid message');
  const closed=once(socket,'close');socket.send('x'.repeat(128*1024+1));
  assert.equal((await closed)[0],1009);
  assert.equal((await probe('/api/diagnostics/replies')).status,200,'Oversized messages must not crash the app');
  // Exhaust repeated file/API work, while retaining the native emergency Stop.
  const statuses=[];
  for(let batch=0;batch<19;batch++)statuses.push(...await Promise.all(Array.from({length:100},()=>probe('/api/content').then(response=>response.status))));
  assert(statuses.includes(200));assert(statuses.includes(429));
  assert.equal((await probe('/api/panic',{},'POST')).status,200);
 }finally{
  child.kill('SIGTERM');
  const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},2000);
  try{await childClosed;}finally{clearTimeout(timer);rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 }
});
