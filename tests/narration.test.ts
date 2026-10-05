// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { NarrationFlow, narrationDirective, narrationPauses } from '../packages/session-director/narration';
import { SessionDirector } from '../packages/session-director';
import { TimelineScheduler } from '../packages/timeline';

test('start claims exactly one passage; only completed playback arms the next one', () => {
  const flow = new NarrationFlow(); flow.start(0);
  const first = flow.next(0, 300, true)!;
  assert.equal(flow.valid(first), true);
  assert.equal(flow.next(100, 300, true), null, 'Generation or stream gaps cannot advance narration');
  flow.completed(100, 4);
  assert.equal(flow.valid(first), false);
  assert.equal(flow.next(103.99, 300, true), null);
  const second = flow.next(104, 300, true)!;
  assert.notEqual(second, first, 'A late dispatch cannot reuse an earlier ticket');
  assert.equal(flow.valid(first), false);
  assert.equal(flow.next(105, 300, true), null);
});

test('all phase pauses begin at completion including embedded audio pauses', () => {
  for (const pause of Object.values(narrationPauses)) {
    const flow = new NarrationFlow(); flow.turnStarted(); flow.completed(50, pause);
    assert.equal(flow.next(50 + pause - .01, 300, true), null);
    assert.notEqual(flow.next(50 + pause, 300, true), null);
  }
});

test('session pause freezes the remaining gap and blockers do not consume a passage', () => {
  let wall = 0;
  const clock = new TimelineScheduler(() => wall), director = new SessionDirector(clock);
  director.ready(); director.start();
  const flow = new NarrationFlow(); flow.turnStarted(); flow.completed(clock.time, 5);
  wall = 2; director.togglePause(); wall = 100;
  assert.equal(clock.time, 2);
  assert.equal(flow.next(clock.time, director.duration, clock.running), null);
  director.togglePause(); wall = 102.9;
  assert.equal(flow.next(clock.time, director.duration, true), null);
  wall = 103;
  assert.equal(flow.next(clock.time, director.duration, false), null, 'Input/playback still blocks');
  assert.notEqual(flow.next(clock.time, director.duration, true), null);
});

test('session end, cancellation and playback errors cannot restart narration', () => {
  const flow = new NarrationFlow(); flow.start(0);
  const ticket = flow.next(0, 300, true)!;
  flow.cancel();
  assert.equal(flow.valid(ticket), false);
  flow.completed(10, 4);
  assert.equal(flow.next(20, 300, true), null);
  flow.start(299);
  assert.equal(flow.next(300, 300, true), null);
  assert.equal(flow.next(0, 300, true), null, 'Seeking after end cannot silently restart');
});

test('a reply awaiting an answer or final closing passage leaves no automatic continuation', () => {
  const flow = new NarrationFlow(); flow.turnStarted(); flow.completed(30, 4, true);
  flow.defer(40, 4);
  assert.equal(flow.next(100, 300, true), null);
  flow.turnStarted(); flow.completed(100, 4);
  assert.notEqual(flow.next(104, 300, true), null);
});

test('typing and a new user turn invalidate scheduled dispatch; configured pauses are bounded', () => {
  const flow = new NarrationFlow(); flow.start(0);
  const ticket = flow.next(0, 300, true)!;
  flow.defer(10, 6);
  assert.equal(flow.valid(ticket), false);
  assert.equal(flow.next(15, 300, true), null);
  assert.notEqual(flow.next(16, 300, true), null);
  for (const [pause, expected] of [[-10, 0], [100, 30], [NaN, 4]]) {
    flow.turnStarted(); flow.completed(20, pause);
    assert.equal(flow.next(20 + expected - .01, 300, true), null);
    assert.notEqual(flow.next(20 + expected, 300, true), null);
  }
});

test('continuation follows the current phase and closing states the duration limit', () => {
  assert.match(narrationDirective('induction', true, 300), /opening passage/);
  assert.match(narrationDirective('deepening', false, 200), /last heard passage/);
  assert.match(narrationDirective('awakening', false, 20), /clear closing passage/);
  assert.match(narrationDirective('awakening', false, 20), /20 seconds/);
});
