// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {backendArguments} from './windows-runtime-paths.mjs';

if(process.platform!=='win32'||!process.connected)throw Error('Windows supervisor requires its live Electron IPC lease');
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=backendArguments(import.meta.url);
const owner=Number(process.env.BAMBI_ELECTRON_PID);
if(!Number.isSafeInteger(owner)||owner<1)throw Error('Windows Electron ownership lease missing');
// The native helper assigns this supervisor and its suspended backend to a
// kill-on-close job. It watches Electron independently of this event loop.
const guard=spawn(resolve(root,'native/ownership/bambi-job.exe'),[String(owner),String(process.pid),process.execPath,...args],{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['pipe','pipe','inherit']});
let stopping=false,started=false,buffer='',closing=false;
const kill=()=>{if(!closing){closing=true;guard.stdin.end('stop\n');}};
guard.stdin.on('error',()=>{});
guard.stdout.setEncoding('utf8');guard.stdout.on('data',chunk=>{
 buffer+=chunk;
 if(buffer.length>4096){kill();return;}
 const newline=buffer.indexOf('\n');if(newline<0)return;
 try{
  const message=JSON.parse(buffer.slice(0,newline));buffer=buffer.slice(newline+1);
  if(started||message.type!=='started'||!Number.isSafeInteger(message.pid)||message.pid<1||message.jobPid!==guard.pid)throw Error('Invalid private job ownership reply');
  started=true;process.send?.({type:'started',pid:message.pid,jobPid:guard.pid});
 }catch(error){console.error(error);kill();}
});
guard.once('error',error=>{console.error(error);process.exit(1);});
guard.once('exit',()=>process.exit(stopping?0:1));
async function stop(){
 if(stopping)return;stopping=true;
 // The native guard still owns the tree if an event loop stalls. This private
 // request allows generation/capture/storage to finish their stop path.
 const deadline=setTimeout(kill,2000);
 try{await fetch(`http://127.0.0.1:${process.env.BAMBI_PORT}/api/desktop/shutdown`,{method:'POST',headers:{'x-bambi-instance':process.env.BAMBI_INSTANCE_TOKEN},signal:AbortSignal.timeout(1500)});}catch{}
 clearTimeout(deadline);kill();
}
process.on('message',message=>{if(message.type==='stop')void stop();});
process.on('disconnect',()=>void stop());process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
