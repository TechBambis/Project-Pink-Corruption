// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputEvidence,projectOutput,type OutputOccurrence} from '../packages/speech/output-evidence';
const occurrence:OutputOccurrence={id:'scene:p:0',requestId:'request-1',epoch:3,text:'Light stays. Return gently.',sessionStartMs:1000,audioStartSeconds:10,durationMs:2000,words:[{word:'Light',atMs:100,endMs:400},{word:'stays',atMs:500,endMs:850},{word:'Return',atMs:1000,endMs:1300},{word:'gently',atMs:1400,endMs:1800}]};
test('caption onset, completed words and completed statements have distinct evidence boundaries',()=>{
 let p=projectOutput(occurrence,120);assert.equal(p.caption,'Light');assert.equal(p.history,'');assert.deepEqual(p.statements,[]);
 p=projectOutput(occurrence,410);assert.equal(p.history,'Light');assert.deepEqual(p.statements,[]);
 p=projectOutput(occurrence,850);assert.equal(p.history,'Light stays.');assert.deepEqual(p.statements,['Light stays.']);
 p=projectOutput(occurrence,1050);assert.equal(p.caption,'Light stays. Return');assert.equal(p.history,'Light stays.');
 assert.deepEqual(projectOutput(occurrence,1800).statements,['Light stays.','Return gently.']);
 assert.equal(projectOutput({...occurrence,words:occurrence.words.map(({endMs,...w})=>w)},1999).history,'');
 assert.equal(projectOutput({...occurrence,words:[]},2000).history,occurrence.text);
});
test('occurrences map session/audio clocks once, remain monotonic, bounded and epoch isolated',()=>{
 const evidence=new OutputEvidence(3,2);assert.equal(evidence.schedule(occurrence),true);assert.equal(evidence.schedule(occurrence),false);
 assert.equal(evidence.sample(occurrence.id,10.4,3)?.history,'Light');assert.equal(evidence.sample(occurrence.id,10.2,3)?.history,'Light');
 assert.equal(evidence.sample(occurrence.id,12,2),undefined);
 assert.equal(evidence.schedule({...occurrence,id:'old',epoch:2}),false);
 evidence.schedule({...occurrence,id:'second'});evidence.sample('second',12,3);evidence.schedule({...occurrence,id:'third'});
 assert.equal(evidence.sample(occurrence.id,12,3),undefined);assert.equal(evidence.snapshot().length,1);
 evidence.reset(4);assert.deepEqual(evidence.snapshot(),[]);assert.equal(evidence.sample('second',12,4),undefined);
});
