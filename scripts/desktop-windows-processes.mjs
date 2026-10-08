// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {join,resolve} from 'node:path';

let observerChild,observerReply,observerQueue=Promise.resolve();
function nextReply(timeout=20000){
 if(observerReply)throw Error('Concurrent observer requests are not supported.');
 return new Promise((accept,reject)=>{
  const timer=setTimeout(()=>{observerReply=null;reject(Error('Native observer reply timed out'));},timeout);
  observerReply={accept:value=>{clearTimeout(timer);observerReply=null;accept(value);},reject:error=>{clearTimeout(timer);observerReply=null;reject(error);}};
 });
}
export async function startObserver({executable=process.env.BAMBI_WINDOWS_OBSERVER,args=['--server']}={}){
 if(!executable)return;
 if(observerChild)throw Error('An observation server is already running.');
 observerQueue=Promise.resolve();
 observerChild=spawn(resolve(executable),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const ready=nextReply(30000);
 observerChild.stdin.on('error',error=>observerReply?.reject(error));observerChild.stderr.resume();
 createInterface({input:observerChild.stdout}).on('line',line=>{
  try{const value=JSON.parse(line);if(value.error)throw Error(value.error);observerReply?.accept(value);}catch(error){observerReply?.reject(error);}
 });
 observerChild.once('error',error=>observerReply?.reject(error));
 observerChild.once('exit',()=>observerReply?.reject(Error('Native observer exited before its reply')));
 if((await ready).ready!==true)throw Error('Native observer did not report ready');
}
function requestObservation(command){
 const result=observerQueue.then(()=>{
  if(!observerChild)throw Error('Observation server is not running.');
  const reply=nextReply();observerChild.stdin.write(command+'\n');return reply;
 });
 observerQueue=result.catch(()=>{});return result;
}
export async function observeRows(roots,windows=false){
 if(!observerChild)return processRows(roots);
 if(!roots.length||roots.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw Error('Specify owned process IDs for observation.');
 const rows=await requestObservation(roots.join(',')+(windows?' --windows':''));return windows?rows:rows.map(row=>({...row,command:''}));
}
export async function observeOwnedRows(owner,{identityTimeoutMs=2000}={}){
 const deadline=performance.now()+identityTimeoutMs;
 while(true){
  try{return ownedRows(owner,await observeRows([owner]));}
  catch(error){
   // A Toolhelp entry can exit before its query handle is opened. Take a
   // fresh snapshot; never discard a live row just because it is unverified.
   if(!(error instanceof MissingProcessIdentity)||performance.now()>=deadline)throw error;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
 }
}
export async function observeAcl(path){
 if(!observerChild)return privateAcl(path);
 return await requestObservation('--acl '+Buffer.from(resolve(path),'utf8').toString('base64'));
}
export async function stopObserver(){
 if(!observerChild)return;
 await observerQueue;
 const child=observerChild;observerChild=null;child.stdin.end();
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');resolve();},2000))]);
}

export function powershell(command,extraEnvironment={}){
 if(process.platform!=='win32')throw Error('Native Windows inspection requires Windows.');
 const executable=join(process.env.SystemRoot||process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const environment={...process.env,...extraEnvironment};
 // Native grandchildren of pwsh otherwise resolve shared module names to PS7
 // versions that inbox Windows PowerShell cannot load. Preserve host settings.
 for(const key of Object.keys(environment))if(key.toLowerCase()==='psmodulepath')delete environment[key];
 return execFileSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); "+command],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024**2,env:environment}).trim();
}
export function processRows(roots=[]){
 if(process.env.BAMBI_WINDOWS_OBSERVER){
  if(!roots.length||roots.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw Error('Specify owned process IDs for qualification observation.');
  return JSON.parse(execFileSync(resolve(process.env.BAMBI_WINDOWS_OBSERVER),[roots.join(',')],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024**2})).map(row=>({...row,command:''}));
 }
 if(!process.env.BAMBI_WINDOWS_JOB_HELPER)throw Error('Native Windows process snapshot helper was not selected.');
 return JSON.parse(execFileSync(resolve(process.env.BAMBI_WINDOWS_JOB_HELPER),['--process-snapshot'],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024**2})).map(row=>({...row,command:''}));
}
export function ownedRows(owner,rows=processRows([owner])){
 const owned=new Set([owner]);let changed=true;
 while(changed){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){assertCreation(row);owned.add(row.pid);changed=true;}}
 return rows.filter(row=>owned.has(row.pid)).map(row=>{assertCreation(row);return row;});
}
class MissingProcessIdentity extends Error {}
function assertCreation(row){if(!row.created||!row.executable)throw new MissingProcessIdentity('Cannot verify native process identity for PID '+row.pid);}
export async function processSnapshot(owner){
 const rows=await observeOwnedRows(owner);
 // Command lines contain private service tokens. Never persist them in evidence.
 return {at:performance.now(),rssBytes:rows.reduce((n,r)=>n+r.rssBytes,0),privateCommitBytes:rows.reduce((n,r)=>n+r.privateCommitBytes,0),pids:rows.map(r=>r.pid),processTicks:Object.fromEntries(rows.map(r=>[r.pid,r.cpu100ns])),processes:rows.map(({command,...row})=>row)};
}
export async function measureProcesses(owner,seconds=10){
 const samples=[await processSnapshot(owner)];
 for(let i=0;i<seconds;i++){await new Promise(r=>setTimeout(r,1000));samples.push(await processSnapshot(owner));}
 const durationSeconds=(samples.at(-1).at-samples[0].at)/1000;
 const cpu100ns=samples.slice(1).reduce((sum,s,i)=>sum+Object.entries(s.processTicks).reduce((n,[pid,ticks])=>n+Math.max(0,ticks-(samples[i].processTicks[pid]??0)),0),0);
 return {durationSeconds,cpuPercentOfOneCore:cpu100ns/1e7/durationSeconds*100,rssBytesMean:samples.reduce((n,s)=>n+s.rssBytes,0)/samples.length,rssBytesMax:Math.max(...samples.map(s=>s.rssBytes)),privateCommitBytesMean:samples.reduce((n,s)=>n+s.privateCommitBytes,0)/samples.length,samples,method:'Owned Windows descendant tree; native Toolhelp snapshot, process creation-time, CPU 100 ns, working-set and private-commit counters. Working sets count shared pages repeatedly; private commit is not physical RAM. One core is 100%. One-second intervals plus snapshot overhead; creation and termination between samples may be missed.'};
}
export function privateAcl(path){
 if(!process.env.BAMBI_WINDOWS_JOB_HELPER)throw Error('Native Windows ACL snapshot helper was not selected.');
 return JSON.parse(execFileSync(resolve(process.env.BAMBI_WINDOWS_JOB_HELPER),['--profile-acl',resolve(path)],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1024**2}));
}
export function machineConditions(){
 return JSON.parse(powershell('@{os=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,TotalVisibleMemorySize,FreePhysicalMemory); cpu=(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors); gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion)} | ConvertTo-Json -Depth 4 -Compress'));
}
