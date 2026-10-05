// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { immersiveChoreographyAt, type VisualPresentation, timelinePresentationAt } from '../packages/visuals/choreography';
import { parseTimelineJSON } from '../packages/timeline/import';
import { SpiralSettingsSchema } from '../packages/safety/actions';
import { migrateVisualPreferences } from '../packages/visuals/preferences';

const base: VisualPresentation = { scene: 'Spiral Focus', opacity: .8, spiral: { mode: 'classic', speed: .4, alpha: 1, complexity: 1.4, colorA: '#f52c9e', colorB: '#ffe1f7', depth: .9 } };
test('immersive journey uses dense visuals across phases and fades at awakening, for every duration', () => {
  for (const duration of [300, 1200, 3600]) {
    for (const [progress, style] of [[0, 'tunnel'], [.24, 'vortex'], [.4, 'fractal'], [.8, 'loop'], [.9, 'orb']] as const) {
      const view = immersiveChoreographyAt(progress * duration, duration, base);
      assert.equal(view.scene, 'Spiral Focus'); assert.equal(view.spiral.style, style);
      assert.equal(view.spiral.mode, 'breathe'); assert.equal(view.opacity, .8);
      assert.equal(view.spiral.depth, .9);
    }
    assert.ok(Math.abs(immersiveChoreographyAt(duration * .94, duration, base).opacity - .4) < 1e-8);
    assert.equal(immersiveChoreographyAt(duration * .98, duration, base).scene, 'Audio Only');
  }
  assert.equal(base.spiral.mode, 'classic', 'phase calculations do not mutate manual settings');
});
test('saved heavy presets upgrade once while custom styles and manual control survive', () => {
  const old = { 'spiral-style': 'original', 'spiral-speed': '.35', 'spiral-complexity': '1.6', 'spiral-mode': 'breathe', 'phase-visuals': false };
  const upgraded = migrateVisualPreferences(old);
  assert.equal(upgraded['spiral-style'], 'loop'); assert.equal(upgraded['phase-visuals'], false);
  assert.equal(old['spiral-style'], 'original');
  assert.equal(migrateVisualPreferences(upgraded), upgraded);
  assert.equal(migrateVisualPreferences({ 'spiral-style': 'original', 'spiral-speed': '2.25', 'spiral-complexity': '2.2', 'spiral-mode': 'colorCycle' })['spiral-style'], 'fractal');
  assert.equal(migrateVisualPreferences({ 'spiral-style': 'prism', 'phase-visuals': false })['spiral-style'], 'prism');
  assert.equal(migrateVisualPreferences({ 'spiral-style': 'original', 'spiral-speed': '.8' })['spiral-style'], 'original');
  assert.equal(migrateVisualPreferences({ 'spiral-style': 'original', 'phase-visuals': true, 'visual-journey': false })['visual-journey'], true);
});
test('new styles work in imported timelines; invalid styles and depth values stay rejected', () => {
  for (const style of ['original', 'vortex', 'infinity', 'prism', 'orb', 'tunnel', 'loop', 'fractal']) {
    const events = parseTimelineJSON(JSON.stringify([{ progress: .25, scene: 'Spiral Focus', spiral: { style, depth: .7 } }]), 1200);
    assert.equal(timelinePresentationAt(events, 300, base).spiral.style, style);
    assert.equal(timelinePresentationAt(events, 300, base).spiral.depth, .7);
  }
  for (const value of [{ style: 'unknown' }, { depth: -1 }, { depth: 1.1 }, { depth: Infinity }]) assert.equal(SpiralSettingsSchema.safeParse(value).success, false);
});

// Old timeline/profile values still load, but cannot restore the excessively dense range.
test('complexity caps apply to current profiles, old presets and imported timeline actions', () => {
  const saved = {'visuals-version':2, 'spiral-style':'original', 'spiral-complexity':'3', 'phase-visuals':false};
  const bounded = migrateVisualPreferences(saved);
  assert.equal(bounded['spiral-complexity'],'1.5');assert.equal(bounded['phase-visuals'],false);
  assert.equal(saved['spiral-complexity'],'3');assert.equal(migrateVisualPreferences(bounded),bounded);
  const events=parseTimelineJSON(JSON.stringify([{progress:.25,scene:'Spiral Focus',spiral:{complexity:3}}]),1200);
  assert.equal(timelinePresentationAt(events,300,base).spiral.complexity,1.5);
});
