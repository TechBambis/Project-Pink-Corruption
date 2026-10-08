// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {startObserver,stopObserver,observeRows,observeAcl} from '../scripts/desktop-windows-processes.mjs';

test('concurrent observation requests retain their matching IPC replies and a failed request releases the queue',async()=>{
 // Exercise real child stdio, including a slow first reply. This fixture is an
 // observation protocol test, not a Windows process/hardware measurement.
 const fixture=`import {createInterface} from 'node:readline';
 console.log(JSON.stringify({ready:true}));let sequence=0;
 createInterface({input:process.stdin}).on('line',line=>{const order=++sequence;setTimeout(()=>{
  if(line==='13'){console.log(JSON.stringify({error:'Public fixture rejection'}));return;}
  if(line.startsWith('--acl ')){console.log(JSON.stringify({order,path:Buffer.from(line.slice(6),'base64').toString('utf8')}));return;}
  console.log(JSON.stringify([{pid:Number(line.split(' ')[0]),order,title:line.endsWith('--windows')?'fixture window':undefined}]));
 },order===1?75:5);});`;
 try{
  await startObserver({executable:process.execPath,args:['--input-type=module','-e',fixture]});
  const [processes,windows,acl]=await Promise.all([observeRows([11]),observeRows([12],true),observeAcl(process.cwd())]);
  assert.equal(processes[0].pid,11);assert.equal(processes[0].order,1);
  assert.equal(windows[0].pid,12);assert.equal(windows[0].order,2);assert.equal(windows[0].title,'fixture window');
  assert.equal(acl.order,3);assert.equal(acl.path,process.cwd());
  const [failed,next]=await Promise.allSettled([observeRows([13]),observeRows([14])]);
  assert.equal(failed.status,'rejected');assert.match(String(failed.reason),/Public fixture rejection/);
  assert.equal(next.status,'fulfilled');assert.equal(next.value[0].pid,14);assert.equal(next.value[0].order,5);
 }finally{await stopObserver();}
});
