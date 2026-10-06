// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket,WebSocketServer} from 'ws';
import {StreamingSpeechService} from '../packages/speech/streaming/service';

test('resident recognition serves partial/final messages without reloading and cancels old identities',async()=>{
 let launches=0;
 const service=new StreamingSpeechService({launch:()=>{launches++;return spawn(process.execPath,['-e',`
  const readline=require('node:readline');let id=null;
  console.log(JSON.stringify({type:'ready'}));
  readline.createInterface({input:process.stdin}).on('line',line=>{
   const data=JSON.parse(line);
   if(data.type==='start')id=data.id;
   if(data.type==='audio'){console.log(JSON.stringify({type:'partial',id,text:'Provisional words'}));console.log(JSON.stringify({type:'ack',id,bytes:Buffer.from(data.pcm,'base64').length}));}
   if(data.type==='finish'){console.log(JSON.stringify({type:'final',id,text:'Complete words.'}));id=null;}
   if(data.type==='reset'){if(id)console.log(JSON.stringify({type:'final',id,text:'Cancelled words.'}));id=null;}
  });
 `],{stdio:['pipe','pipe','pipe']});}});
 const server=createServer(),sockets=new WebSocketServer({server});sockets.on('connection',socket=>service.attach(socket));
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
 const connect=()=>{const socket=new WebSocket(`ws://127.0.0.1:${port}`),messages:any[]=[];socket.on('message',data=>messages.push(JSON.parse(data.toString())));return {socket,messages};};
 const wait=async(predicate:()=>boolean)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Streaming fixture timed out');};
 const first=connect();
 try{
  await wait(()=>first.messages.some(message=>message.type==='ready'));
  const id=crypto.randomUUID();first.socket.send(JSON.stringify({type:'start',id}));first.socket.send(new Float32Array(512));
  await wait(()=>first.messages.some(message=>message.type==='partial'));
  assert.ok(!first.messages.some(message=>message.type==='final'));
  first.socket.send(JSON.stringify({type:'finish',id}));await wait(()=>first.messages.some(message=>message.type==='final'));
  assert.equal(first.messages.find(message=>message.type==='final').text,'Complete words.');
  const cancelled=crypto.randomUUID();first.socket.send(JSON.stringify({type:'start',id:cancelled}));first.socket.send(JSON.stringify({type:'reset'}));
  await new Promise(resolve=>setTimeout(resolve,30));assert.ok(!first.messages.some(message=>message.id===cancelled));
  first.socket.close();await once(first.socket,'close');
  const second=connect();await wait(()=>second.messages.some(message=>message.type==='ready'));assert.equal(launches,1);second.socket.close();await once(second.socket,'close');
 }finally{first.socket.terminate();service.close();for(const socket of sockets.clients)socket.terminate();sockets.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
