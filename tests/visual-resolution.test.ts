// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { visualResolution } from '../packages/visuals/resolution';

test('adaptive quality reduces actual pixel work while preserving the scene aspect ratio',()=>{
 for(const dpr of [1,1.25,1.5,2,3])for(const quality of [.5,.7,1]){
  const size=visualResolution(1600,900,dpr,quality);
  const full=visualResolution(1600,900,dpr);
  assert.ok(Math.abs(size.width-full.width*quality)<=1);
  assert.ok(Math.abs(size.height-full.height*quality)<=1);
  assert.ok(Math.abs(size.width/size.height-16/9)<.002);
 }
});
test('high-density displays and 4K fullscreen stay within the 1440p render budget',()=>{
 assert.deepEqual(visualResolution(1920,1080,2),{width:2560,height:1440});
 assert.deepEqual(visualResolution(3840,2160,1,.5),{width:1280,height:720});
 assert.deepEqual(visualResolution(2560,1440,1),{width:2560,height:1440});
 assert.deepEqual(visualResolution(2160,3840,2),{width:1440,height:2560});
});
test('pixel and hardware caps preserve ultrawide aspect ratios rather than squeezing scenes',()=>{
 for(const [w,h,dpr,limit] of [[5120,1440,2,8192],[7680,4320,1,8192],[1920,1080,2,2048]]){
  const size=visualResolution(w,h,dpr,1,limit);
  assert.ok(size.width<=limit&&size.height<=limit);
  assert.ok(size.width*size.height<=2560*1440);
  assert.ok(Math.abs(size.width/size.height-w/h)<.003);
 }
 assert.deepEqual(visualResolution(0,0,1),{width:1,height:1});
});
