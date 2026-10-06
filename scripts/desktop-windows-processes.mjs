// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

export function powershell(command,extraEnvironment={}){
 if(process.platform!=='win32')throw Error('Native Windows inspection requires Windows.');
 const executable=join(process.env.SystemRoot||process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
 return execFileSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); "+command],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:16*1024**2,env:{...process.env,...extraEnvironment}}).trim();
}
export function processRows(){
 const result=JSON.parse(powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize,PageFileUsage,CommandLine | ConvertTo-Json -Compress')||'[]');
 return (Array.isArray(result)?result:[result]).map(row=>({pid:row.ProcessId,parent:row.ParentProcessId,executable:row.ExecutablePath,created:row.CreationDate,cpu100ns:Number(row.KernelModeTime)+Number(row.UserModeTime),rssBytes:Number(row.WorkingSetSize),privateCommitBytes:Number(row.PageFileUsage)*1024,command:row.CommandLine||''}));
}
export function ownedRows(owner,rows=processRows()){
 const owned=new Set([owner]);let changed=true;
 while(changed){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true;}}
 return rows.filter(row=>owned.has(row.pid));
}
export function processSnapshot(owner){
 const rows=ownedRows(owner);
 // Command lines contain private service tokens. Never persist them in evidence.
 return {at:performance.now(),rssBytes:rows.reduce((n,r)=>n+r.rssBytes,0),privateCommitBytes:rows.reduce((n,r)=>n+r.privateCommitBytes,0),pids:rows.map(r=>r.pid),processTicks:Object.fromEntries(rows.map(r=>[r.pid,r.cpu100ns])),processes:rows.map(({command,...row})=>row)};
}
export async function measureProcesses(owner,seconds=10){
 const samples=[processSnapshot(owner)];
 for(let i=0;i<seconds;i++){await new Promise(r=>setTimeout(r,1000));samples.push(processSnapshot(owner));}
 const durationSeconds=(samples.at(-1).at-samples[0].at)/1000;
 const cpu100ns=samples.slice(1).reduce((sum,s,i)=>sum+Object.entries(s.processTicks).reduce((n,[pid,ticks])=>n+Math.max(0,ticks-(samples[i].processTicks[pid]??0)),0),0);
 return {durationSeconds,cpuPercentOfOneCore:cpu100ns/1e7/durationSeconds*100,rssBytesMean:samples.reduce((n,s)=>n+s.rssBytes,0)/samples.length,rssBytesMax:Math.max(...samples.map(s=>s.rssBytes)),privateCommitBytesMean:samples.reduce((n,s)=>n+s.privateCommitBytes,0)/samples.length,samples,method:'Owned Windows descendant tree; CIM CPU 100 ns counters and working set/private commit. Working sets count shared pages repeatedly; private commit is not physical RAM. One core is 100%. One-second intervals plus CIM overhead; creation and termination between samples may be missed.'};
}
export function privateAcl(path){
 return JSON.parse(powershell('$acl=Get-Acl -LiteralPath $env:BAMBI_ACL_PATH; $sid=[System.Security.Principal.SecurityIdentifier]; @{user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; owner=$acl.Owner; protected=$acl.AreAccessRulesProtected; rules=@($acl.Access | ForEach-Object { @{sid=$_.IdentityReference.Translate($sid).Value; type=$_.AccessControlType.ToString(); inherited=$_.IsInherited; rights=$_.FileSystemRights.ToString()} })} | ConvertTo-Json -Depth 4 -Compress',{BAMBI_ACL_PATH:path}));
}
export function machineConditions(){
 return JSON.parse(powershell('@{os=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,TotalVisibleMemorySize,FreePhysicalMemory); cpu=(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfLogicalProcessors); gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion)} | ConvertTo-Json -Depth 4 -Compress'));
}
