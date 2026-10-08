// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveDirector, type DirectorOptions } from '../packages/session-director/adaptive';
import { directionPreset, directEpisode, DirectionSchema, directionScore, normalizeDirection, sessionDirections, type SessionDirection } from '../packages/session-director/direction';
import { phaseNarrativeFocus } from '../packages/session-director/events/narrative';
import { createEpisode } from '../packages/session-director/events/episodes';
import { EventRuntime, compileEvent } from '../packages/session-director/events/runtime';
import { eventDurationMs, parentPhaseMs } from '../packages/session-director/events/contract';

const options: DirectorOptions = { speech: true, visuals: true, reducedMotion: false, triggers: ['Good Girl'], voiceAvailable: true };
function journey(direction: SessionDirection, continuous = false, reducedMotion = false, seed = 42) {
  const director = new AdaptiveDirector(1200000, .9, seed, continuous, direction), settings = { ...options, reducedMotion };
  const runtime = new EventRuntime(director.initial(settings));
  const events = [];
  let event = runtime.program.events[0];
  const endOfJourney = continuous ? 2400000 : 1200000;
  while (event.atMs < endOfJourney) {
    events.push(event);
    const end = event.atMs + eventDurationMs(event), cycle = Math.floor(event.atMs / 1200000) * 1200000, bounds = parentPhaseMs(event.phase, 1200000);
    assert.ok(event.atMs >= bounds.start + cycle && end <= bounds.end + cycle + .001);
    for (let at = event.atMs; at < end; at += 1000) {
      const state = runtime.snapshot(at).state; director.observe(event, state, at, true, state.narrationState === 'speaking'); runtime.tick(at);
    }
    if (end >= endOfJourney - .001) break;
    const next = director.plan(end, settings); runtime.append(next.event, next.motifs); event = next.event;
    assert.ok(runtime.compiled.length <= 64 && director.decisions.length <= 128);
  }
  return { events, director };
}

test('styles are independent bounded compositions with named influence metadata', () => {
  assert.ok(sessionDirections.find(style => style.id === 'reference-contrast')?.influence?.includes('Tom Tame'));
  for (const style of sessionDirections) assert.doesNotThrow(() => DirectionSchema.parse(style.settings));
  const edited = directionPreset('reference-contrast'); edited.mechanisms.length = 0;
  assert.equal(directionPreset('balanced').mechanisms.length, 7);
  assert.equal(directionPreset('reference-contrast').mechanisms.length, 7);
  assert.deepEqual(normalizeDirection({ contrast: Infinity }), directionPreset('balanced'));
});
test('optional mechanisms can all be disabled without losing bounded parents, continued journeys or finite closing', () => {
  for (const continuous of [false, true]) {
    const direction = { ...directionPreset('reference-contrast'), mechanisms: [] };
    const { events } = journey(direction, continuous);
    assert.ok(events.length > 40);
    for (const event of events) assert.ok(!['blink_trigger', 'fractionation', 'mindwipe', 'reset', 'original_self', 'mantra', 'peak'].includes(event.type));
    assert.equal(events.at(-1)?.softReturn?.final, !continuous);
  }
});
test('a chosen motif is introduced truthfully, persists through the journey and honors reduced motion', () => {
  for (const motifs of ['ring', 'heart', 'gears'] as const) {
    const { events } = journey({ ...directionPreset('balanced'), motifs });
    assert.ok(events.every(event => event.baseline.motifForm === motifs));
    assert.ok(events[0].speech.instruction.includes(motifs === 'ring' ? 'pink ring' : motifs === 'heart' ? 'pink heart' : 'linked pink gears'));
  }
  const { events } = journey({ ...directionPreset('driving'), motifs: 'gears' }, false, true);
  assert.ok(events.every(event => event.baseline.motifForm === 'ring' && event.type !== 'peak'));
});
test('contrast and voice rhythm change actual compiled presentation and delivery without changing windows', () => {
  const low = { ...directionPreset('balanced'), contrast: 0 }, high = { ...directionPreset('balanced'), contrast: 1 };
  const makeFraction = () => createEpisode('fractionation', 'f', 500000, 34000, 'conditioning', 'ring', .9, true);
  const a = directEpisode(makeFraction(), low), b = directEpisode(makeFraction(), high);
  assert.equal(eventDurationMs(a), eventDurationMs(b));
  assert.ok(b.fractionation!.stateB.density.visualDensity > a.fractionation!.stateB.density.visualDensity);
  assert.ok(b.fractionation!.stateA.density.visualDensity < a.fractionation!.stateA.density.visualDensity);
  assert.ok(b.fractionation!.transitionMs < a.fractionation!.transitionMs);
  assert.deepEqual(compileEvent(a).speech.map(slot => slot.endMs - slot.atMs), compileEvent(b).speech.map(slot => slot.endMs - slot.atMs));
  assert.ok(compileEvent(b).speech.every(slot => slot.atMs >= b.atMs && slot.endMs <= b.atMs + eventDurationMs(b)));
  const makePassage = () => createEpisode('passage', 'p', 500000, 30000, 'conditioning', 'ring', .9, true);
  const slow = directEpisode(makePassage(), directionPreset('velvet')), fast = directEpisode(makePassage(), directionPreset('driving'));
  assert.equal(slow.speech.delivery, 'settle'); assert.equal(fast.speech.delivery, 'drive');
  assert.ok(fast.speech.wordTarget! > slow.speech.wordTarget!);
  const blank = directEpisode(createEpisode('mindwipe', 'm', 500000, 15100, 'conditioning', 'ring', .9, true), high);
  assert.equal(compileEvent(blank).frames.find(frame => frame.marker === '[mindwipe:blank]')?.state.narrationState, 'paused');
});
test('repetition preferences change scheduling while cached mantra count and peak recovery stay authoritative', () => {
  assert.ok(directionScore('mantra', { ...directionPreset('balanced'), repetition: 1 }) > directionScore('mantra', { ...directionPreset('balanced'), repetition: 0 }));
  for (const style of ['reference-contrast', 'velvet', 'driving']) {
    const { events } = journey(directionPreset(style));
    events.forEach((event, i) => {
      if (event.type === 'mantra') assert.equal(event.mantra?.count, 3);
      if (event.type === 'peak') assert.equal(events[i + 1]?.type, 'soft_return');
    });
    assert.equal(events.at(-1)?.softReturn?.final, true);
  }
});
test('live direction edits preserve delivered history and committed events, introduce a new preferred motif next', () => {
  const director = new AdaptiveDirector(1200000, .7, 7), { event } = director.plan(0, options);
  const committed = structuredClone(event); director.observe(event, event.state, 1000, true, true);
  const history = director.history;
  director.configure({ ...directionPreset('driving'), motifs: 'heart', mechanisms: [] }, .95);
  assert.deepEqual(director.history, history); assert.deepEqual(event, committed);
  const next = director.plan(eventDurationMs(event), options).event;
  assert.equal(next.baseline.motifForm, 'heart'); assert.ok(next.speech.instruction.includes('pink heart'));
  assert.equal(next.state.density.intensity, .95);
});
test('a preferred narrative theme biases delivered topics while preserving phase fit and variety', () => {
  let normal = 0, focused = 0;
  for (const seed of [7, 11, 27, 42, 101, 202, 404, 808]) {
    for (const theme of ['varied', 'attention'] as const) {
      const { events, director } = journey({ ...directionPreset('balanced'), theme }, false, false, seed);
      const decisions = director.decisions.filter(decision => decision.narrativeFocus);
      for (const decision of decisions) {
        const event = events.find(event => event.id === decision.eventId)!;
        assert.ok(phaseNarrativeFocus[event.phase].includes(decision.narrativeFocus!));
      }
      const count = decisions.filter(decision => decision.narrativeFocus === 'attention').length;
      if (theme === 'varied') normal += count; else focused += count;
      assert.ok(new Set(decisions.map(decision => decision.narrativeFocus)).size > 3);
    }
  }
  assert.ok(focused > normal, `Focused ${focused}; varied ${normal}`);
});
test('selecting a new object after a peak defers its introduction until owed recovery completes', () => {
  const director = new AdaptiveDirector(1200000, .95, 42, false, { ...directionPreset('balanced'), motifs: 'ring' });
  const runtime = new EventRuntime(director.initial(options)); let event = runtime.program.events[0], recovered = false;
  while (event.atMs < 960000) {
    const end = event.atMs + eventDurationMs(event);
    for (let at = event.atMs; at < end; at += 1000) director.observe(event, runtime.snapshot(at).state, at, true, true);
    if (event.type === 'peak') {
      director.configure({ ...directionPreset('driving'), motifs: 'heart' });
      const next = director.plan(end, options).event;
      assert.equal(next.type, 'soft_return');
      runtime.append(next); director.observe(next, next.state, end + 1000, true, true);
      const introduced = director.plan(end + eventDurationMs(next), options).event;
      assert.equal(introduced.baseline.motifForm, 'heart'); assert.ok(introduced.speech.instruction.includes('Introduce'));
      recovered = true; break;
    }
    const next = director.plan(end, options); runtime.append(next.event, next.motifs); event = next.event;
  }
  assert.equal(recovered, true);
});
