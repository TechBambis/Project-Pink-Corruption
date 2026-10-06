// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import {SceneTransition,sceneTransitionSeconds} from '../packages/visuals/scene-transition';

test('scene changes blend on the session clock and remain frozen during pause',()=>{
 const transition=new SceneTransition();
 assert.deepEqual(transition.frame('tunnel',10,true),{capture:false,opacity:0});
 assert.equal(transition.frame('vortex',10.1,true).capture,true);
 const halfway=transition.frame('vortex',10.1+sceneTransitionSeconds/2,true);
 assert.ok(Math.abs(halfway.opacity-.5)<1e-10);
 assert.deepEqual(transition.frame('vortex',10.1+sceneTransitionSeconds/2,true),halfway);
 assert.equal(transition.frame('vortex',10.1+sceneTransitionSeconds+.01,true).opacity,0);
 assert.equal(transition.frame('vortex',11,true).capture,false);
});
test('blank intervals, reduced motion, seeks and restart cannot retain a scene snapshot',()=>{
 for(const jump of [-10,10]){
  const transition=new SceneTransition();transition.frame('tunnel',20,true);
  assert.deepEqual(transition.frame('orb',20+jump,true),{capture:false,opacity:0});
 }
 const transition=new SceneTransition();transition.frame('tunnel',20,true);
 transition.frame('orb',20.1,true);
 assert.deepEqual(transition.frame('blank',20.2,false),{capture:false,opacity:0});
 assert.deepEqual(transition.frame('orb',20.3,true),{capture:false,opacity:0});
 transition.frame('tunnel',20.4,true);transition.reset();
 assert.deepEqual(transition.frame('orb',0,true),{capture:false,opacity:0});
});
