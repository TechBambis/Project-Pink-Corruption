// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioReactivity, type AudioVisualSignal } from '../packages/visuals/audio-reactivity';

const signal = (time: number, voice = 0, phaseMs = 0, active = false, level = 1): AudioVisualSignal => ({ time, voice, tick: { active, phaseMs, level } });

test('voice follows speech with a soft attack and release; paused audio freezes its envelope', () => {
  const state = new AudioReactivity();
  const onset = state.frame(signal(1, 1), 1, true, false, false);
  const speaking = state.frame(signal(1.1, 1), 1, true, false, false);
  assert.ok(onset > 0 && onset < speaking && speaking < .65);
  for (let i = 0; i < 100; i++) assert.equal(state.frame(signal(1.1, 1), 1, true, false, false), speaking);
  const release = state.frame(signal(1.2), 1, true, false, false);
  assert.ok(release > 0 && release < speaking);
  for (let i = 3; i < 30; i++) state.frame(signal(1 + i / 10), 1, true, false, false);
  assert.ok(state.frame(signal(4), 1, true, false, false) < .001);
});

test('each tick peaks after 45 ms and settles between ticks; fade level and strength scale it', () => {
  const state = new AudioReactivity();
  const sample = (phase: number, strength = 1, level = 1) => state.frame(signal(1 + phase / 1000, 0, phase, true, level), strength, false, true, false);
  assert.equal(sample(0), 0);
  assert.ok(sample(20) > 0);
  assert.equal(sample(45), .75);
  assert.ok(sample(200) < .75);
  assert.equal(sample(360), 0);
  assert.equal(sample(1000), 0);
  assert.equal(sample(45, .5, .5), .75 / 4);
  assert.equal(state.frame(signal(2, 0, 45, false), 1, false, true, false), 0);
});

test('independent switches, zero strength, gentle motion and clearing remove reactions', () => {
  const state = new AudioReactivity();
  assert.ok(state.frame(signal(1, 1, 45, true), 1, true, true, false) > .75);
  assert.equal(state.frame(signal(1.1, 1, 45, true), 1, false, false, false), 0);
  assert.equal(state.frame(signal(1.2, 1, 45, true), 0, true, true, false), 0);
  assert.equal(state.frame(signal(1.3, 1, 45, true), 1, true, true, true), 0);
  assert.equal(state.frame(signal(1.4), 1, true, true, false), 0);
  state.frame(signal(2, 1), 1, true, false, false); state.clear();
  assert.equal(state.frame(signal(2.1), 1, true, true, false), 0);
});
