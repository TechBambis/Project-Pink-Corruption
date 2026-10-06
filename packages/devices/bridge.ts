// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {execFile,spawn,type ChildProcess} from 'node:child_process';
import {existsSync,mkdirSync,createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {z} from 'zod';

export const BLEConnectionSchema=z.object({address:z.string().regex(/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i),writeChar:z.string().uuid().optional()}).strict();
const runFile=promisify(execFile);
export class LocalBLEBridge{
 private process:ChildProcess|null=null;private scanBusy=false;private operations:Promise<unknown>=Promise.resolve();private target='';private lastError='';private connecting=false;
 get status(){return {running:!!this.process,connecting:this.connecting,error:this.lastError};}
 get supported(){return process.platform==='linux'&&existsSync(resolve('.runtime/joyhub-venv/bin/python'));}
 private command(args:string[]){
  const python=resolve('.runtime/joyhub-venv/bin/python'),script=resolve('tools/joyhub_bridge.py');
  // The editor Flatpak cannot talk to BlueZ's system bus. Only this fixed local
  // bridge is run on the host; the normal app stays in its existing environment.
  return existsSync('/.flatpak-info')?{file:'/usr/bin/flatpak-spawn',args:['--host','--watch-bus',python,script,...args]}:{file:python,args:[script,...args]};
 }
 async scan(){if(!this.supported)throw Error('Bluetooth setup is missing. Run ./scripts/setup-joyhub.sh.');if(this.scanBusy)throw Error('A Bluetooth scan is already running.');this.scanBusy=true;
  try{const command=this.command(['--scan','--seconds','6']);const {stdout}=await runFile(command.file,command.args,{timeout:20000,maxBuffer:128*1024});const devices=z.array(z.object({address:z.string(),name:z.string(),rssi:z.number()})).max(200).parse(JSON.parse(stdout));return devices;}
  catch(error){throw Error('Bluetooth scan failed: '+String((error as {stderr?:string}).stderr||error).slice(0,300));}
  finally{this.scanBusy=false;}
 }
 connect(input:unknown){const operation=this.operations.catch(()=>{}).then(()=>this.connectInternal(input));this.operations=operation;return operation;}
 private async connectInternal(input:unknown){if(!this.supported)throw Error('Bluetooth setup is missing. Run ./scripts/setup-joyhub.sh.');const settings=BLEConnectionSchema.parse(input);const target=JSON.stringify(settings);
  if(this.process&&this.target===target)return {started:true,connecting:this.connecting};
  await this.disconnectInternal();this.target=target;this.lastError='';this.connecting=true;
  mkdirSync('runtime',{recursive:true});const log=createWriteStream('runtime/joyhub-bridge.log',{flags:'a'});const command=this.command(['--address',settings.address,...(settings.writeChar?['--write-char',settings.writeChar]:[])]);
  const child=spawn(command.file,command.args,{stdio:['ignore','pipe','pipe']});this.process=child;child.stdout?.pipe(log,{end:false});child.stderr?.pipe(log,{end:false});
  let output='';child.stdout?.on('data',bytes=>{output+=bytes.toString();if(output.length>8192)output=output.slice(-8192);let newline;while((newline=output.indexOf('\n'))>=0){const line=output.slice(0,newline);output=output.slice(newline+1);try{const data=JSON.parse(line);if(this.process===child){if(data.connected===true){this.connecting=false;this.lastError='';}if(data.error)this.lastError=String(data.error).slice(0,300);}}catch{}}});
  child.stderr?.on('data',bytes=>{if(this.process===child)this.lastError=bytes.toString().trim().slice(0,300);});
  child.on('error',error=>{log.write(String(error)+'\n');if(this.process===child){this.process=null;this.connecting=false;this.lastError=String(error).slice(0,300);}});
  child.on('exit',code=>{if(this.process===child){this.process=null;this.connecting=false;if(code&&!this.lastError)this.lastError='BLE bridge exited (code '+code+').';}log.end();});
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  return {started:true,connecting:this.connecting};
 }
 disconnect(){const operation=this.operations.catch(()=>{}).then(()=>this.disconnectInternal());this.operations=operation;return operation;}
 private async disconnectInternal(){const child=this.process;this.process=null;this.target='';this.connecting=false;this.lastError='';if(!child)return;
  await new Promise<void>(resolve=>{child.once('exit',()=>{clearTimeout(timer);resolve();});const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},4000);child.kill('SIGTERM');});
 }
}
