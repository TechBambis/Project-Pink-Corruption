// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseWiper, wiperFrame, emptyWiperFrame, type WiperPlayback } from '../packages/audio/wiper';
import { synthesizeTriggerSound } from '../packages/audio/trigger-synthesis';
import { createEpisode } from '../packages/session-director/events/episodes';
import { EventSchema } from '../packages/session-director/events/contract';
import { compileEvent } from '../packages/session-director/events/runtime';
import { stateGains, wipeNarrationFacts } from '../packages/session-director/events/presentation';
import { windshieldPose } from '../packages/visuals/wiper';

test('wiper analysis detects acoustic strokes and silence rather than assuming a constant animation rate', () => {
  const profile = analyseWiper(synthesizeTriggerSound('wiper', 8000), 8000);
  assert.equal(profile.duration, 5); assert.equal(profile.strokes.length, 8);
  for (const [i, stroke] of profile.strokes.entries()) {
    assert.ok(Math.abs(stroke.start - i * .68) < .08);
    assert.ok(Math.abs(stroke.peak - (i * .68 + .29)) < .06 || i === 7);
    assert.ok(stroke.start < stroke.peak && stroke.peak < stroke.end);
  }
  assert.deepEqual(analyseWiper([new Float32Array(8000)], 8000), { duration: 1, strokes: [] });
  assert.deepEqual(analyseWiper([], 0), { duration: 0, strokes: [] });
});

const playback: WiperPlayback = { start: 10, duration: 7, offset: 0, text: 'QUIET', profile: { duration: 3, strokes: [{ start: .1, peak: .4, end: .8 }, { start: 1.1, peak: 1.5, end: 1.9 }] } };
test('audible stroke midpoint erases half the word; direction alternates and gaps park the blade', () => {
  const mid = wiperFrame(playback, 10.4);
  assert.equal(mid.active, true); assert.ok(Math.abs(mid.x - .5) < 1e-10); assert.ok(Math.abs(mid.remaining - .5) < 1e-10);
  assert.equal(mid.text, 'QUIET'); assert.equal(mid.direction, 1);
  assert.equal(wiperFrame(playback, 11.5).direction, -1);
  for (const time of [9, 17]) assert.deepEqual(wiperFrame(playback, time), emptyWiperFrame);
  const firstRest = wiperFrame(playback, 10.9), lastRest = wiperFrame(playback, 12);
  assert.equal(firstRest.active, false); assert.equal(firstRest.visible, true); assert.equal(firstRest.x, 1); assert.equal(firstRest.text, '');
  assert.equal(lastRest.x, 0); assert.equal(lastRest.strength, 0);
  assert.equal(wiperFrame(playback, 10.05).x, 0);
  assert.deepEqual(wiperFrame({ ...playback, profile: { duration: 0, strokes: [] } }, 10.2), emptyWiperFrame);
});

test('car blade rotates about a fixed bottom pivot; word erasure and the swept sector use the same angle', () => {
  const mid = windshieldPose(wiperFrame(playback, 10.4));
  assert.ok(Math.abs(mid.angle) < 1e-9); assert.match(mid.clip, /^M500 690 L500 /);
  assert.equal(windshieldPose(wiperFrame(playback, 10.9)).angle, 64);
  assert.equal(windshieldPose(wiperFrame(playback, 12)).angle, -64);
  assert.equal(windshieldPose(wiperFrame(playback, 10.9)).clip, 'M0 0Z');
  assert.match(mid.sheen, /A570 570/);
});

test('looping and resumed buffers retain their audible phase without replaying a completed wipe', () => {
  const before = wiperFrame(playback, 11.4);
  const resumed = { ...playback, start: 30, duration: 5.6, offset: 1.4 };
  const after = wiperFrame(resumed, 30.0001);
  assert.equal(after.direction, before.direction); assert.equal(after.stroke, before.stroke);
  assert.ok(Math.abs(after.x - before.x) < .001);
  assert.equal(wiperFrame(playback, 13.4).stroke, 2);
  assert.ok(Math.abs(wiperFrame(playback, 13.4).x - .5) < 1e-10);
  assert.deepEqual(wiperFrame({ ...resumed, duration: .01 }, 30.02), emptyWiperFrame);
});

test('engine wipe ends exactly before mindwipe blank, owns its sound layer and keeps blank free of text and audio', () => {
  const event = createEpisode('mindwipe', 'wipe', 24000, 15100, 'conditioning', 'ring', .6, true);
  assert.deepEqual(event.wipe, { offsetMs: 0, durationMs: 8000, text: 'THOUGHTS' });
  const compiled = compileEvent(event), blank = compiled.frames.find(f => f.label === 'blank')!;
  assert.equal(blank.atMs, event.atMs + event.wipe!.durationMs);
  assert.equal(stateGains(compiled.frames[0].state).EFFECTS, .6);
  assert.equal(stateGains(blank.state).EFFECTS, 0); assert.equal(stateGains(blank.state).AI_VOICE, 0);
  assert.ok(compiled.speech.every(s => s.endMs <= blank.atMs || s.atMs >= blank.atMs + event.timing.activeMs));
  assert.equal(EventSchema.safeParse({ ...event, wipe: { ...event.wipe!, durationMs: 8001 } }).success, false);
  assert.equal(EventSchema.safeParse({ ...event, baseline: { ...event.baseline, activeLayers: event.baseline.activeLayers.filter(l => l !== 'transition_sfx') } }).success, false);
});

test('wipe narration describes current capabilities and never describes wiping during blank/reanchor', () => {
  const event = createEpisode('mindwipe', 'wipe', 24000, 15100, 'conditioning', 'ring', .6, true);
  assert.match(wipeNarrationFacts(event, 24000), /windshield blade/);
  assert.match(wipeNarrationFacts(event, 24000, { visualsEnabled: true, reducedMotion: true }), /without a moving wiper/);
  assert.match(wipeNarrationFacts(event, 24000, { visualsEnabled: false, reducedMotion: false }), /Visuals are disabled/);
  assert.match(wipeNarrationFacts(event, 24000, { visualsEnabled: true, reducedMotion: false, effectsEnabled: false }), /wipe effect is disabled/);
  assert.equal(wipeNarrationFacts(event, 32000), ''); assert.equal(wipeNarrationFacts(event, 36000), '');
});
