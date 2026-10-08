// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

export function assertMachArm64(path){
 const bytes=readFileSync(path);
 if(bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x0100000c)
  throw Error('Expected native Mach-O arm64: '+path);
}
export function processRows(){
 return execFileSync('/bin/ps',['-axo','pid=,ppid=,stat=,command='],{encoding:'utf8'}).split('\n').flatMap(line=>{
  const match=line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
  return match?[{pid:Number(match[1]),parent:Number(match[2]),state:match[3],command:match[4]}]:[];
 });
}
export function running(pid){return processRows().some(row=>row.pid===pid&&!row.state.startsWith('Z'));}
export function appPaths(executable){
 if(!executable.endsWith('.app/Contents/MacOS/Bambi Local Smoke'))throw Error('Select the received macOS smoke app executable.');
 const contents=executable.slice(0,executable.lastIndexOf('/MacOS/'));
 return {contents,resources:contents+'/Resources',bundle:contents.slice(0,-'/Contents'.length)};
}
