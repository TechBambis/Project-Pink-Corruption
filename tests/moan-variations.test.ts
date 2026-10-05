// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {MoanVariations,moanVariationIds} from '../packages/audio/moan-variations';

test('every loaded moan plays once per shuffled round with no immediate repeat',()=>{
 for(const random of [()=>0,()=>.5,()=>.999]){
  const picker=new MoanVariations(random),played=Array.from({length:30},()=>picker.next(moanVariationIds));
  for(let i=0;i<played.length;i+=3)assert.deepEqual(new Set(played.slice(i,i+3)),new Set(moanVariationIds));
  for(let i=1;i<played.length;i++)assert.notEqual(played[i],played[i-1]);
 }
});
test('missing and changing recordings never select an unavailable file',()=>{
 const picker=new MoanVariations(()=>0);
 assert.equal(picker.next([]),undefined);
 assert.equal(picker.next(['snap','moan_alt']),'moan_alt');
 assert.equal(picker.next(['moan_alt']),'moan_alt');
 const played=Array.from({length:6},()=>picker.next(['moan','moan_third']));
 for(let i=0;i<played.length;i+=2)assert.deepEqual(new Set(played.slice(i,i+2)),new Set(['moan','moan_third']));
 assert.equal(picker.next([]),undefined);
});
