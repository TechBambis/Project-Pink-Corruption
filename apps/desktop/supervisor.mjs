// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// IPC is a live ownership lease. Parent SIGKILL/forced termination closes it.
if(!process.connected)throw Error('Desktop supervisor requires an Electron ownership lease');
const root=fileURLToPath(new URL('../../',import.meta.url));
const backend=spawn(process.execPath,['--import',fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url)),resolve(root,'apps/server/index.ts')],{cwd:process.cwd(),env:process.env,detached:true,stdio:['ignore','inherit','inherit','ipc']});
let stopping=false,explicitQuit=false;
const parentPid=process.ppid;
const signalGroup=signal=>{if(!Number.isSafeInteger(backend.pid)||backend.pid<1)return;try{process.kill(-backend.pid,signal);}catch(error){if(error.code!=='ESRCH')console.error(error);}};
function stop(quit=false){
 if(quit)explicitQuit=true;
 if(stopping)return;stopping=true;signalGroup('SIGTERM');
 setTimeout(()=>{
  signalGroup('SIGKILL');
  if(explicitQuit&&process.connected&&process.ppid===parentPid){
   process.send?.({type:'stopped'},()=>{});
   // Chromium/audio teardown can stall the main thread after its window closes.
   // The still-connected IPC lease and unchanged parent establish ownership.
   setTimeout(()=>{if(process.connected&&process.ppid===parentPid)try{process.kill(parentPid,'SIGKILL');}catch{}process.exit(0);},2000);
  }else process.exit(0);
 },2000);
}
backend.once('spawn',()=>process.send?.({type:'started',pid:backend.pid}));
backend.once('error',error=>{console.error(error);stop();});
backend.once('exit',(code,signal)=>{console.log('Owned backend exited',code,signal);stop();});
process.on('message',message=>{if(message.type==='stop')stop(true);});
process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
