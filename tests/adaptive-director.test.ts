// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveDirector, type DirectorOptions } from '../packages/session-director/adaptive';
import { createEpisode, episodeMs } from '../packages/session-director/events/episodes';
import { EventRuntime, compileEvent } from '../packages/session-director/events/runtime';
import { EventSchema, eventDurationMs, parentPhaseMs, ProgramSchema } from '../packages/session-director/events/contract';
import { presentationAt } from '../packages/session-director/events/presentation';
import { rhythmBeats } from '../packages/session-director/events/rhythm';
import { SpeechReadiness, readinessDelay } from '../packages/session-director/events/readiness';
import { motifSvg, motifTurn, gearTurn } from '../packages/visuals/event-motif';
import { synthesizeEventCue } from '../packages/audio/event-cues';

const options: DirectorOptions = { speech: true, visuals: true, reducedMotion: false, triggers: ['Good Girl'], voiceAvailable: true };
function simulate(seconds: number, seed: number, settings = options) {
  const director = new AdaptiveDirector(seconds * 1000, .7, seed), runtime = new EventRuntime(director.initial(settings));
  const sequence: string[] = []; let event = runtime.program.events[0];
  while (true) {
    sequence.push(event.id + ':' + event.atMs + ':' + event.state.motifForm);
    const end = event.atMs + eventDurationMs(event), bounds = parentPhaseMs(event.phase, seconds * 1000);
    assert.ok(end <= bounds.end + .001 && event.atMs >= bounds.start);
    for (let at = event.atMs; at < end; at += 1000) {
      const state = runtime.snapshot(at).state;
      director.observe(event, state, at, settings.visuals, settings.speech && state.narrationState === 'speaking');
      runtime.tick(at);
    }
    if (end >= seconds * 1000 - .001) break;
    const next = director.plan(end, settings); runtime.append(next.event, next.motifs); event = next.event;
    assert.ok(runtime.compiled.length <= 64 && director.decisions.length <= 128);
  }
  assert.equal(event.phase, 'awakening'); assert.equal(event.softReturn?.final, true);
  assert.ok(Math.abs(event.atMs + eventDurationMs(event) - seconds * 1000) < .001);
  return { sequence, director, runtime };
}

test('adaptive sessions respect fixed parents, bounded live plans and resolved closing at varied durations', () => {
  for (const duration of [60, 300, 1200, 3600, 21600]) for (const seed of [11, 27]) simulate(duration, seed);
});
test('same seed/delivered inputs reproduce choices; different seeds vary legal sessions', () => {
  assert.deepEqual(simulate(1200, 42).sequence, simulate(1200, 42).sequence);
  assert.notDeepEqual(simulate(1200, 42).sequence, simulate(1200, 43).sequence);
});
test('sustained delivered density makes contrast more appropriate than another peak', () => {
  const director = new AdaptiveDirector(1200000, .8, 7), initial = director.initial(options).events[0];
  const dense = { ...initial.state, density: { intensity: .8, effectDensity: .8, visualDensity: .8, audioDensity: .8, speechDensity: .8 } };
  for (let at = 0; at <= 90000; at += 1000) director.observe(initial, dense, at, true, true);
  director.plan(600000, options);
  const decision = director.decisions.at(-1)!;
  assert.ok(['quiet', 'dark_hold', 'recall', 'return', 'mindwipe'].includes(decision.recipe));
  const recall = decision.candidates.find(c => c.recipe === 'recall')!, peak = decision.candidates.find(c => c.recipe === 'peak')!;
  assert.ok(recall.score > peak.score);
});
test('ineligible motifs, disabled motion and unavailable speech do not acquire phantom introductions', () => {
  const d = new AdaptiveDirector(1200000, .6, 2), p = d.initial(options);
  d.observe(p.events[0], p.events[0].state, 0, false, false);
  assert.equal(d.introduced.size, 0);
  assert.equal(d.plan(100000, { ...options, visuals: false, voiceAvailable: false }).event.state.narrationState, 'paused');
  const limited = simulate(300, 33, { ...options, speech: false, visuals: false, reducedMotion: true, triggers: [], voiceAvailable: false });
  assert.ok(limited.runtime.slots.length === 0);
});
test('every voice-capable grammar compiles, and blank/mantra/closing retain ownership contracts', () => {
  for (const [recipe, duration] of Object.entries(episodeMs)) {
    const phase = recipe === 'closing' ? 'awakening' : 'conditioning';
    const event = createEpisode(recipe as keyof typeof episodeMs, recipe, 0, duration, phase, 'ring', .7, true);
    const compiled = compileEvent(event);
    if (recipe === 'mindwipe') assert.ok(compiled.speech.every(s => s.endMs <= 8000 || s.atMs >= 11100));
    if (recipe === 'mantra') assert.equal(new Set(compiled.speech.map(s => s.payloadId)).size, 1);
    if (recipe === 'closing') assert.ok(compiled.speech[0].speech.fixedText);
  }
});
test('dark picture can keep a strong bed, while a quiet picture holds only the independent pulse lane', () => {
  const dark = createEpisode('dark_hold', 'dark', 0, 12000, 'conditioning', 'heart', .8, true);
  const quiet = createEpisode('quiet', 'quiet', 0, 10000, 'conditioning', 'heart', .8, true);
  const snapshot = (event: typeof dark, at: number) => new EventRuntime(ProgramSchema.parse({ version: 1, durationMs: 1200000, baseline: event.baseline, motifs: [], events: [{ ...event, atMs: 500000 }] })).snapshot(500000 + at);
  const d = presentationAt(snapshot(dark, 1000), compileEvent({ ...dark, atMs: 500000 }), 501000);
  const q = presentationAt(snapshot(quiet, 1000), compileEvent({ ...quiet, atMs: 500000 }), 501000);
  assert.equal(d.black, 1); assert.equal(d.gains.AI_VOICE, 0); assert.equal(d.gains.drone, 1);
  assert.equal(q.motif, 1); assert.equal(q.gains.drone, 0); assert.ok(q.gains.EFFECTS! > 0);
});
test('peak bed and pulse enter independently and repeat-family spacing can decelerate', () => {
  const event = createEpisode('peak', 'peak', 500000, 20000, 'conditioning', 'heart', .8, true), compiled = compileEvent(event);
  const r = new EventRuntime({ version: 1, durationMs: 1200000, baseline: event.baseline, motifs: [], events: [event] });
  const at = (offset: number) => presentationAt(r.snapshot(event.atMs + offset), compiled, event.atMs + offset);
  assert.equal(at(1000).gains.drone, 0); assert.equal(at(1000).gains.EFFECTS, 0); assert.equal(at(1000).motif, 1);
  assert.ok(at(3500).gains.drone! > 0); assert.equal(at(3500).gains.EFFECTS, 0); assert.ok(at(4500).gains.EFFECTS! > 0);
  const quiet = createEpisode('quiet', 'quiet', 0, 10000, 'conditioning', 'heart', .8, true, 1), beats = rhythmBeats(quiet);
  assert.deepEqual(beats.slice(0,8).map(b => b.kind), ['pulse_a','pulse_a','pulse_a','pulse_b','pulse_a','pulse_a','pulse_a','pulse_b']);
  assert.ok(beats.at(-1)!.atMs - beats.at(-2)!.atMs > beats[1].atMs - beats[0].atMs);
});
test('future fallback removes speech and bound cues without changing deadlines; delivered playback cannot be rewritten', () => {
  const d = new AdaptiveDirector(1200000, .7, 42), r = new EventRuntime(d.initial(options));
  const first = r.program.events[0]; d.observe(first, first.state, 0, true, true); r.tick(0);
  const next = d.plan(eventDurationMs(first), options); r.append(next.event, next.motifs);
  const end = next.event.atMs + eventDurationMs(next.event);
  r.replacePending(d.fallback(next.event));
  assert.equal(r.compiled.at(-1)!.speech.length, 0); assert.equal(r.program.events.at(-1)!.haptics.length, 0);
  assert.equal(r.program.events.at(-1)!.atMs + eventDurationMs(r.program.events.at(-1)!), end);
  r.tick(next.event.atMs); assert.throws(() => r.replacePending(next.event), /delivered/);
  r.stop(); assert.throws(() => r.append(next.event), /stopped/);
});
test('busy voice backoff is bounded, deadline-aware and cancellation interrupts preparation', async () => {
  const ready = new SpeechReadiness();
  assert.equal(ready.busy('voice', 0, 20000), true); assert.equal(ready.canRequest('voice', 999), false);
  assert.equal(ready.busy('voice', 1000, 20000), true); assert.equal(ready.blockedUntilMs, 3000);
  assert.equal(ready.busy('voice', 3000, 20000), true); assert.equal(ready.busy('voice', 7000, 20000), false);
  ready.clear(); assert.equal(ready.busy('late', 1000, 1500), false);
  const controller = new AbortController(), pending = readinessDelay(8000, controller.signal); controller.abort(new Error('Stop'));
  await assert.rejects(pending, /Stop/);
});
test('new original motif geometry and impulses are bounded, seek deterministic and motion-reducible', () => {
  for (const form of ['heart', 'gears'] as const) { const svg = motifSvg(form); assert.ok(svg.includes('<svg')); assert.ok(!/https?:|<script|<image/.test(svg)); assert.equal(motifTurn(form, 1234, true), 0); }
  assert.equal(motifTurn('heart', 1234, false), motifTurn('heart', 1234, false)); assert.equal(gearTurn(1000,40,1,true),0);
  assert.equal(gearTurn(1000,20,-1,false), -2 * gearTurn(1000,40,1,false));
  const a = synthesizeEventCue('pulse_a'), b = synthesizeEventCue('pulse_b');
  assert.notDeepEqual(a,b);
  for (const [kind, samples] of [['pulse_a',a],['pulse_b',b]] as const) {
    assert.deepEqual(samples, synthesizeEventCue(kind)); assert.equal(samples[0][0],0);
    assert.ok(samples[0].every(v => Number.isFinite(v) && Math.abs(v) < .8)); assert.ok(samples[0].length < 4000);
  }
  const malformed = createEpisode('quiet','malformed',0,10000,'conditioning','ring',.6,false); malformed.rhythm!.untilMs = 10001;
  assert.equal(EventSchema.safeParse(malformed).success,false);
});
