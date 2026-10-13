// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseWiper, wiperMotionProfile, wiperFrame, emptyWiperFrame, type WiperPlayback } from '../packages/audio/wiper';
import { synthesizeTriggerSound } from '../packages/audio/trigger-synthesis';
import { createEpisode } from '../packages/session-director/events/episodes';
import { EventSchema } from '../packages/session-director/events/contract';
import { compileEvent } from '../packages/session-director/events/runtime';
import { stateGains, wipeNarrationFacts } from '../packages/session-director/events/presentation';
import { windshieldPose, windshieldLayout } from '../packages/visuals/wiper';

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

test('paired car blades share a reversible stroke, with hidden distinct pivots and overlapping wipe sectors', () => {
  const first = windshieldPose(wiperFrame(playback, 10.1));
  const middle = windshieldPose(wiperFrame(playback, 10.4));
  const raised = windshieldPose(wiperFrame(playback, 10.9));
  const parked = windshieldPose(wiperFrame(playback, 12));
  assert.equal(middle.length, 2); assert.notEqual(middle[0].x, middle[1].x);
  for (let i = 0; i < 2; i++) {
    assert.equal(middle[i].y, 760); assert.ok(middle[i].y > 700);
    assert.ok(first[i].angle < middle[i].angle && middle[i].angle < raised[i].angle);
    assert.equal(parked[i].angle, i === 0 ? -100 : -102); assert.equal(raised[i].clip, 'M0 0Z');
    assert.match(middle[i].clip, new RegExp(`^M${middle[i].x} 760 L`));
    assert.match(middle[i].sheen, / A/);
  }
  assert.equal(raised[0].angle, 100); assert.equal(raised[1].angle, 98);
  const returning = windshieldPose(wiperFrame(playback, 11.5));
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(returning[i].angle - middle[i].angle) < 1e-8);
});

test('windshield geometry reaches the top of wide and tall surfaces while mounts stay below the frame', () => {
  for (const [width, height] of [[1920, 1080], [3440, 1440], [390, 844]]) {
    const layout = windshieldLayout(width, height);
    for (const blade of layout) {
      assert.ok(blade.y > height);
      const top = blade.y - Math.cos((blade.rest + blade.raised) / 2 * Math.PI / 180) * blade.reach;
      assert.ok(top <= 0, 'The centre of the stroke reaches the upper edge, rather than occupying a small central area.');
    }
    const pose = windshieldPose(wiperFrame(playback, 10.4), layout);
    assert.ok(pose.every(blade => Number.isFinite(blade.angle) && blade.y > height));
  }
});

test('both arms leave the glass geometrically at each reversal and re-enter on the return stroke', () => {
  for (const [width, height] of [[1920, 1080], [3440, 1440], [390, 844]]) {
    const layout = windshieldLayout(width, height);
    for (const blade of layout) {
      for (const angle of [blade.rest, blade.raised]) {
        const radians = angle * Math.PI / 180;
        // Include the complete arm back to its mount and the outer blade/clamp thickness.
        for (const radius of [0, blade.inner, blade.reach]) {
          for (const lateral of [-18, 18]) {
            const y = blade.y + lateral * Math.sin(radians) - radius * Math.cos(radians);
            assert.ok(y > height, 'No arm or rubber blade remains in the image at reversal.');
          }
        }
      }
      assert.ok(blade.y - blade.reach < height, 'Both blades return into the visible image mid-stroke.');
    }
  }
});

test('travel passes the acoustic peak without a mid-screen stall and slows only at reversal', () => {
  const dt = .00001, peak = 10.4;
  const left = (wiperFrame(playback, peak).x - wiperFrame(playback, peak - dt).x) / dt;
  const right = (wiperFrame(playback, peak + dt).x - wiperFrame(playback, peak).x) / dt;
  assert.ok(left > 1 && right > 1, 'The blade must keep moving through the sound peak.');
  assert.ok(Math.abs(left - right) < .001, 'Speed must be continuous across the acoustic landmark.');
  const start = 10.1, end = 10.8;
  assert.ok((wiperFrame(playback, start + dt).x - wiperFrame(playback, start).x) / dt < .001);
  assert.ok((1 - wiperFrame(playback, end - dt).x) / dt < .001);
  let previous = 0;
  for (let t = start; t < end; t += .001) {
    const x = wiperFrame(playback, t).x;
    assert.ok(x >= previous && x >= 0 && x <= 1); previous = x;
  }
});

test('short friction accents receive travel room without shifting peaks or overlapping neighboring strokes', () => {
  const original = { duration: 2, strokes: [
    { start: .13, peak: .2, end: .27 }, { start: .63, peak: .7, end: .77 },
    { start: 1.13, peak: 1.2, end: 1.27 }, { start: 1.63, peak: 1.7, end: 1.77 },
  ] };
  const expanded = wiperMotionProfile(original);
  assert.equal(expanded.duration, original.duration);
  expanded.strokes.forEach((s, i) => {
    assert.equal(s.peak, original.strokes[i].peak);
    assert.ok(s.end - s.start > .4, 'An isolated friction accent must not force an entire 200-degree sweep into 140 ms.');
    assert.ok(s.start >= 0 && s.end <= original.duration);
    if (i) assert.ok(s.start >= expanded.strokes[i - 1].end);
  });
  assert.equal(original.strokes[0].start, .13);
  assert.deepEqual(wiperMotionProfile({duration:1,strokes:[]}), {duration:1,strokes:[]});
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
  assert.match(wipeNarrationFacts(event, 24000), /Two dark rubber windshield blades/);
  assert.match(wipeNarrationFacts(event, 24000, { visualsEnabled: true, reducedMotion: true }), /without a moving wiper/);
  assert.match(wipeNarrationFacts(event, 24000, { visualsEnabled: false, reducedMotion: false }), /Visuals are disabled/);
  assert.match(wipeNarrationFacts(event, 24000, { visualsEnabled: true, reducedMotion: false, effectsEnabled: false }), /wipe effect is disabled/);
  assert.equal(wipeNarrationFacts(event, 32000), ''); assert.equal(wipeNarrationFacts(event, 36000), '');
});
