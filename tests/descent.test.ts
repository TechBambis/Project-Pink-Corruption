// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DescentVisualState, emptyDescentFrame } from '../packages/visuals/descent';
import { TimelineScheduler } from '../packages/timeline';

test('a queued descent waits for its sound, freezes with audio time, and clears at the end', () => {
  let audioTime = 0;
  const clock = new TimelineScheduler(() => audioTime), descent = new DescentVisualState();
  clock.start(); descent.start(5, 6);
  assert.deepEqual(descent.frame(clock.time), emptyDescentFrame);
  audioTime = 6;
  const falling = descent.frame(clock.time);
  assert.ok(falling.opacity > 0 && falling.scale > 1);
  clock.pause(); audioTime = 90;
  assert.deepEqual(descent.frame(clock.time), falling);
  clock.start(); audioTime = 94;
  assert.ok(descent.frame(clock.time).black > .5);
  audioTime = 95;
  assert.deepEqual(descent.frame(clock.time), emptyDescentFrame);
});

test('reduced motion, interruption and invalid starts never leave a queued or visible descent', () => {
  const descent = new DescentVisualState();
  descent.start(0); assert.ok(descent.frame(2).opacity > 0);
  assert.deepEqual(descent.frame(2, true), emptyDescentFrame);
  assert.deepEqual(descent.frame(3), emptyDescentFrame);
  descent.start(10); descent.clear();
  assert.deepEqual(descent.frame(12), emptyDescentFrame);
  for (const [start, duration] of [[NaN, 6], [0, Infinity], [0, 0]]) {
    descent.start(start, duration);
    assert.deepEqual(descent.frame(2), emptyDescentFrame);
  }
});
