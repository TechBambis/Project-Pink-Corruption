// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const hz=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim());
export function processSnapshot(owner){
 const rows=execFileSync('ps',['-eo','pid,ppid'],{encoding:'utf8'}).trim().split('\n').slice(1).map(line=>line.trim().split(/\s+/).map(Number));const owned=new Set([owner]);let changed=true;while(changed){changed=false;for(const [pid,parent] of rows)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);changed=true;}}
 const result={at:performance.now(),cpuTicks:0,rssBytes:0,pssBytes:0,pids:[...owned],processTicks:{}};
 for(const pid of owned){try{const fields=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ');const ticks=Number(fields[11])+Number(fields[12]);result.cpuTicks+=ticks;result.processTicks[pid]=ticks;const status=readFileSync(`/proc/${pid}/status`,'utf8');result.rssBytes+=Number(/^VmRSS:\s+(\d+) kB/m.exec(status)?.[1]||0)*1024;result.pssBytes+=Number(/^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`,'utf8'))?.[1]||0)*1024;}catch{}}
 return result;
}
export async function measureProcesses(owner,seconds=10){
 const samples=[processSnapshot(owner)];for(let i=0;i<seconds;i++){await new Promise(r=>setTimeout(r,1000));samples.push(processSnapshot(owner));}const first=samples[0],last=samples.at(-1),durationSeconds=(last.at-first.at)/1000;
 return {durationSeconds,cpuPercentOfOneCore:samples.slice(1).reduce((sum,s,i)=>sum+Object.entries(s.processTicks).reduce((n,[pid,ticks])=>n+Math.max(0,ticks-(samples[i].processTicks[pid]??0)),0),0)/hz/durationSeconds*100,rssBytesMean:samples.reduce((n,s)=>n+s.rssBytes,0)/samples.length,pssBytesMean:samples.reduce((n,s)=>n+s.pssBytes,0)/samples.length,pssBytesMax:Math.max(...samples.map(s=>s.pssBytes)),samples,method:'Owned descendant tree; Linux /proc CPU ticks and smaps PSS. RSS includes shared pages; CPU percent uses one full core as 100%.'};
}
