// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {VisualCadence} from '../packages/visuals/cadence';

test('idle rendering follows each delivered refresh including high refresh monitors',()=>{
 for(const hz of [60,75,120,144,165,240]){
  const cadence=new VisualCadence();let rendered=0;
  for(let frame=0;frame<hz;frame++)if(cadence.frame(frame*1000/hz,false))rendered++;
  assert.equal(rendered,hz);
  assert.ok(Math.abs(cadence.refreshHz-hz)<.01);
 }
});
test('AI headroom uses alternate display refreshes rather than a fixed 30 FPS cap',()=>{
 for(const hz of [60,120,144,240]){
  const cadence=new VisualCadence();let rendered=0;
  for(let frame=0;frame<hz;frame++)if(cadence.frame(frame*1000/hz,true))rendered++;
  assert.equal(rendered,hz/2);
  assert.ok(Math.abs(cadence.targetFps(true)-hz/2)<.01);
  assert.equal(cadence.frame(1000,false),true,'Leaving AI work immediately restores every refresh');
 }
});
test('missed refreshes and returning from a hidden tab do not invent faster display rates',()=>{
 const cadence=new VisualCadence();let wall=0;
 for(let i=0;i<72;i++){wall+=(i%5===0?2:1)*1000/144;cadence.frame(wall,false);}
 assert.ok(Math.abs(cadence.refreshHz-144)<.01);
 cadence.frame(wall+10000,false);wall+=10000;
 for(let i=0;i<36;i++){wall+=1000/60;cadence.frame(wall,false);}
 assert.ok(Math.abs(cadence.refreshHz-60)<.01,'Moving to a slower monitor is detected');
});
