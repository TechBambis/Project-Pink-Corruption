// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTimelineJSON } from '../packages/timeline/import';
import { choreographyAt, timelinePresentationAt, type VisualPresentation } from '../packages/visuals/choreography';
import { TriggerVisualState, triggerEffectFor, strongestTriggerEffect, emptyTriggerFrame } from '../packages/visuals/trigger-effects';
import { TimelineScheduler } from '../packages/timeline';
import { pinkWordOffsets } from '../packages/visuals/spoken-cues';
import { snapshotSession } from '../packages/ai/session-state';

const base: VisualPresentation = { scene: 'Particle Drift', opacity: 1, spiral: { mode: 'classic', speed: 1, complexity: 1, alpha: 1, colorA: '#c700c7', colorB: '#ff82ff' } };
const template = readFileSync('apps/web/public/timelines/phase-choreography.json', 'utf8');

test('spoken pink is brief and independent of other triggers, Sleep, and reduced motion', () => {
  assert.deepEqual(pinkWordOffsets([{word:'Pink,',atMs:50},{word:'pinkish',atMs:80},{word:'pink',atMs:150},{word:'pink',atMs:NaN},{word:'pink',atMs:200}],200),[50,150]);
  const state=new TriggerVisualState();
  state.start(0,triggerEffectFor('BAMBI SLEEP'));state.pinkPulse(1);
  assert.equal(state.frame(1).pink,.5);assert.equal(state.frame(1).eyeOpening,0);
  assert.equal(state.frame(1).flash,0);assert.equal(state.frame(1).impulse,0);
  assert.equal(state.frame(1.181).pink,0);assert.equal(state.frame(1.181).eyeOpening,0);
  assert.equal(state.frame(5.8).eyeOpening,0);assert.equal(state.frame(8.1).eyeOpening,1);
  state.pinkPulse(10,true);assert.equal(state.frame(10,true).pink,0);
  state.pinkPulse(11);state.clear();assert.deepEqual(state.frame(11),emptyTriggerFrame);
});

test('one proportional timeline follows AI phases across all supported durations, including awakening fade', () => {
  for (const duration of [300, 600, 1200, 1800, 3600]) {
    const events = parseTimelineJSON(template, duration);
    assert.deepEqual(events.map(event => event.time), [0, .24, .4, .8, .9, .98].map(progress => progress * duration));
    assert.ok(events.every(event => event.relativeTo === 'session'));
    for (const [progress, phase, scene] of [[0, 'induction', 'Soft Pink'], [.24, 'deepening', 'Deep Tunnel'], [.4, 'conditioning', 'Minimal Dark'], [.8, 'anchor', 'Spiral Focus'], [.9, 'awakening', 'Soft Pink'], [.98, 'awakening', 'Audio Only']] as const) {
      const time = duration * progress;
      const auto = choreographyAt(time, duration, base), timeline = timelinePresentationAt(events, time, base);
      assert.equal(auto.scene, scene, `${duration}, ${progress}`);
      assert.equal(timeline.scene, auto.scene);
      assert.equal(snapshotSession({ elapsedSeconds: time, totalSeconds: duration, scene: auto.scene, intensityPercent: 50, activeTriggers: [], lastTrigger: null }).phase, phase);
      assert.equal(timeline.spiral.speed, auto.spiral.speed);
      assert.ok(Math.abs(timeline.opacity - auto.opacity) < 1e-8);
    }
    assert.ok(Math.abs(choreographyAt(duration * .94, duration, base).opacity - .35) < 1e-8);
    assert.ok(Math.abs(timelinePresentationAt(events, duration * .94, base).opacity - .35) < 1e-8);
  }
});

test('pause freezes choreography and trigger effects; backward seeking restores prior phase settings', () => {
  let wall = 10;
  const clock = new TimelineScheduler(() => wall), effects = new TriggerVisualState();
  clock.start(); clock.seek(1000);
  effects.start(clock.time, triggerEffectFor('BAMBI SLEEP'));
  wall += .1;
  clock.pause();
  const visual = choreographyAt(clock.time, 1200, base), trigger = effects.frame(clock.time);
  wall += 90;
  assert.deepEqual(choreographyAt(clock.time, 1200, base), visual);
  assert.deepEqual(effects.frame(clock.time), trigger);
  effects.clear(); clock.seek(100);
  assert.equal(choreographyAt(clock.time, 1200, base).scene, 'Soft Pink');
  assert.deepEqual(effects.frame(clock.time), emptyTriggerFrame);
  const events = parseTimelineJSON(template, 1200);
  assert.equal(timelinePresentationAt(events, 1000, base).spiral.mode, 'strobe');
  assert.equal(timelinePresentationAt(events, 100, base).spiral.mode, 'breathe');
  assert.equal(timelinePresentationAt(events, 100, base).spiral.colorB, '#008080');
});

test('trigger tiers peak at their specified alpha, black follows hard flash, shake stops after 150 ms', () => {
  const state = new TriggerVisualState();
  for (const [name, alpha] of [['good girl', .4], ['BAMBI FREEZE', .7], ['DROP FOR COCK', 1]] as const) {
    const effect = triggerEffectFor(name);
    state.start(5, effect);
    assert.ok(Math.abs(state.frame(5 + effect.flash / 2000).flash - alpha) < 1e-8);
  }
  state.start(0, triggerEffectFor('DROP FOR COCK'));
  assert.notEqual(state.frame(.0125).x, 0);
  assert.equal(state.frame(.15).x, 0);
  assert.equal(state.frame(.7).black, 1);
  assert.deepEqual(state.frame(.9), emptyTriggerFrame);
  assert.equal(strongestTriggerEffect(['GOOD GIRL', 'BAMBI FREEZE', 'COCK ZOMBIE NOW']).flashAlpha, 1);
  assert.equal(triggerEffectFor('bambi_limp').flashAlpha, .7);
});

test('Bambi Sleep closes softly, holds fully black for five seconds, then opens slowly',()=>{
  const state=new TriggerVisualState(), effect=triggerEffectFor('bambi_sleep');
  state.start(10,effect);
  assert.equal(state.frame(10).eyeOpening,1);
  assert.ok(Math.abs(state.frame(10.45).eyeOpening-.5)<1e-8);
  assert.equal(state.frame(10.9).eyeOpening,0);
  assert.equal(state.frame(15.899).eyeOpening,0);
  assert.ok(Math.abs(state.frame(17).eyeOpening-.5)<1e-8);
  assert.deepEqual(state.frame(18.1),emptyTriggerFrame);
  assert.equal(strongestTriggerEffect(['Bambi Sleep','Good Girl']),effect);
});

test('Sleep hold survives the next narration/other cue; full cancellation and reduced motion remain authoritative',()=>{
  const state=new TriggerVisualState();state.start(0,triggerEffectFor('Bambi Sleep'));
  state.clear(true);state.start(2,triggerEffectFor('Good Girl'));
  assert.equal(state.frame(2.2).eyeOpening,0);
  state.clear();assert.deepEqual(state.frame(2.3),emptyTriggerFrame);
  state.start(5,triggerEffectFor('Bambi Sleep'),true);
  assert.equal(state.frame(5,true).eyeOpening,0);
  assert.equal(state.frame(9.999,true).eyeOpening,0);
  assert.deepEqual(state.frame(10,true),emptyTriggerFrame);
});

test('repeated triggers restart immediately and reduced motion or stop cancels every visual component', () => {
  const state = new TriggerVisualState();
  state.start(0, triggerEffectFor('DROP FOR COCK'));
  state.start(.75, triggerEffectFor('GOOD GIRL'));
  assert.equal(state.frame(.8).black, 0);
  assert.ok(state.frame(.8).flash > 0);
  assert.deepEqual(state.frame(.8, true), emptyTriggerFrame);
  assert.deepEqual(state.frame(.85), emptyTriggerFrame);
  state.start(1, triggerEffectFor('DROP FOR COCK'), true);
  assert.deepEqual(state.frame(1.1), emptyTriggerFrame);
  state.start(2, triggerEffectFor('DROP FOR COCK')); state.clear();
  assert.deepEqual(state.frame(2.1), emptyTriggerFrame);
});

test('relative selectors rescale, second-based legacy actions remain valid, and malformed scenes are rejected', () => {
  const source = JSON.stringify([{ progress: .5, scene: 'minimal_dark', opacity: 0 }, { time: 10, action: { type: 'scene', scene: 'Soft Pink' } }, { phase: 'anchor', phaseProgress: .5, scene: 'spiral_focus', spiral: { mode: 'strobe_pulse', speed: .15 } }, { time: 20, type: 'visual', effect: 'pulse', duration: 2, intensity: .4 }]);
  const short = parseTimelineJSON(source, 600), long = parseTimelineJSON(source, 1800);
  assert.deepEqual(short.map(event => Math.round(event.time)), [10, 20, 300, 510]);
  assert.deepEqual(long.map(event => Math.round(event.time)), [10, 20, 900, 1530]);
  assert.equal((short[3].data as any).spiral.mode, 'strobe');
  assert.equal((short[1].data as any).durationMs, 2000);
  for (const entry of [{ phase: 'unknown', scene: 'soft_pink' }, { phase: 'anchor', phaseProgress: 2, scene: 'soft_pink' }, { time: 0, progress: .5, scene: 'soft_pink' }, { progress: .5, scene: 'soft_pink', javascript: 'alert(1)' }, { progress: .5, scene: 'spiral_focus', spiral: { speed: 0 } }, { progress: .5, scene: 'soft_pink', opacity: 2 }]) {
    assert.throws(() => parseTimelineJSON(JSON.stringify([entry]), 1200));
  }
  assert.throws(() => parseTimelineJSON(source, 0));
});
