// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionState, sessionPhases, snapshotSession } from '../packages/ai/session-state';
import { appendPhasePrompt, phaseConfig, PhaseConfigSchema } from '../packages/content/phases';

const state = snapshotSession({ elapsedSeconds: 0, totalSeconds: 1200, scene: 'Minimal Dark',
  intensityPercent: 75, activeTriggers: [], lastTrigger: null });

test('only the current phase and intensity append after state and the complete base prompt', () => {
  const base = 'MAIN\nCOLLAR\nSTRATEGY';
  for (const phase of sessionPhases) for (const intensity of [1, 2, 3, 4, 5]) {
    const session = { ...state, phase, intensity };
    const result = appendPhasePrompt(base, session);
    const intensityText = phaseConfig.intensity_overrides[String(intensity) as '1' | '2' | '3' | '4' | '5'];
    assert.equal(result, [base, buildSessionState(session), phaseConfig.phases[phase], intensityText].join('\n\n'));
    for (const other of sessionPhases.filter(value => value !== phase)) assert.ok(!result.includes(phaseConfig.phases[other]));
  }
  assert.equal(appendPhasePrompt(base), base, 'Older clients without session state preserve their prompt');
});

test('invalid phase configuration fails rather than injecting missing or empty guidance', () => {
  const copy = () => structuredClone(phaseConfig);
  const missingPhase = copy(); Reflect.deleteProperty(missingPhase.phases, 'anchor');
  const missingIntensity = copy(); Reflect.deleteProperty(missingIntensity.intensity_overrides, '5');
  const empty = copy(); empty.phases.induction = '  ';
  const huge = copy(); huge.intensity_overrides['1'] = 'x'.repeat(4001);
  for (const invalid of [missingPhase, missingIntensity, empty, huge, { ...copy(), unexpected: true }]) {
    assert.equal(PhaseConfigSchema.safeParse(invalid).success, false);
  }
});
