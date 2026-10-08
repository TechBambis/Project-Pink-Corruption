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
import { EventSpeechRequestSchema, renderEventSpeech, validatePresentationText } from '../packages/session-director/events/speech';
import { phaseNarrativeFocus } from '../packages/session-director/events/narrative';

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
test('planning before current speech starts keeps callbacks spaced, changes recalled objects and varies narrative focus', () => {
  for (const seed of [7, 11, 27, 42, 101]) {
    const director = new AdaptiveDirector(1200000, .7, seed), runtime = new EventRuntime(director.initial(options));
    const recalls: number[] = [], content: string[] = [];
    let event = runtime.program.events[0], next: typeof event | undefined, previousForm = event.state.motifForm;
    while (true) {
      const compiled = compileEvent(event), end = event.atMs + eventDurationMs(event);
      const decision = director.decisions.find(d => d.eventId === event.id)!;
      if (decision.recipe === 'recall') {
        recalls.push(event.atMs);
        if (director.introduced.size > 1) assert.notEqual(event.state.motifForm, previousForm);
      }
      if (decision.narrativeFocus) {
        assert.ok(phaseNarrativeFocus[event.phase].includes(decision.narrativeFocus));
        assert.notEqual(decision.narrativeFocus, content.at(-1));
        content.push(decision.narrativeFocus);
        assert.ok(event.speech.instruction.includes(`NARRATIVE FOCUS: ${decision.narrativeFocus}.`));
        assert.ok(event.speech.instruction.includes('Do not name or describe its color, shape or movement'));
      }
      previousForm = event.state.motifForm;
      for (let at = event.atMs; at < end; at += 1000) {
        const state = runtime.snapshot(at).state;
        const heard = compiled.speech.some(slot => at >= slot.atMs && at < slot.atMs + Math.min(4000, slot.speech.targetMs));
        director.observe(event, state, at, true, heard); runtime.tick(at);
        // Match live preparation: commit the successor on entry, before this
        // event's scheduled narration necessarily reaches the output device.
        if (!next && end < 1200000) { const planned = director.plan(end, options); runtime.append(planned.event, planned.motifs); next = planned.event; }
      }
      if (!next) break;
      event = next; next = undefined;
    }
    assert.ok(recalls.length >= 2 && recalls.length <= 10);
    for (let i = 1; i < recalls.length; i++) assert.ok(recalls[i] - recalls[i - 1] >= 120000);
    assert.ok(content.length > recalls.length);
    assert.ok(new Set(content).size >= 5);
    assert.ok(director.decisions.some(d => d.recipe === 'peak'));
    assert.ok(director.history.recentFocus.length <= 4 && director.history.recentRecipes.length <= 6);
  }
});
test('a reserved narrative topic is not delivered history, and silent fallback does not deliver it', () => {
  const director = new AdaptiveDirector(1200000, .7, 7), initial = director.initial(options).events[0];
  director.observe(initial, initial.state, 0, true, false);
  const planned = director.plan(eventDurationMs(initial), options).event;
  assert.ok(director.decisions.at(-1)!.narrativeFocus);
  assert.deepEqual(director.history.recentFocus, []);
  const fallback = director.fallback(planned);
  director.observe(fallback, fallback.state, fallback.atMs, true, false);
  assert.deepEqual(director.history.recentFocus, []);
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

function silentWav() {
  const bytes = Buffer.alloc(44 + 48000); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(48000, 40); return bytes;
}
test('closing bypasses language generation and keeps final layer withdrawal even if voice readiness fails', async () => {
  const event = createEpisode('closing', 'close', 1170000, 30000, 'awakening', 'heart', .7, true);
  const request = EventSpeechRequestSchema.parse({ event, payloadId: 'close:payload', allowedTriggers: [] });
  const response = await renderEventSpeech(request, { generate: async () => { throw Error('No model call belongs here'); }, render: async () => ({ bytes: silentWav() }), knownTriggers: [] }, new AbortController().signal);
  assert.equal(response.textAttempts, 0); assert.equal(response.text, event.speech.fixedText);
  const d = new AdaptiveDirector(1200000, .7, 1), fallback = d.fallback(event);
  assert.equal(fallback.softReturn?.final, true); assert.equal(compileEvent(fallback).speech.length, 0);
  assert.deepEqual(fallback.softReturn!.steps.at(-1)!.state.activeLayers, []);
});
test('narration receives the present object, actual motion preference and previous delivered text', async () => {
  const event = createEpisode('heart', 'heart', 500000, 24000, 'conditioning', 'heart', .7, true);
  let instruction = '';
  const request = EventSpeechRequestSchema.parse({ event, payloadId: 'heart:payload', allowedTriggers: [], precedingNarration: 'A familiar thought settles.', presentationPreferences: { visualsEnabled: true, reducedMotion: false } });
  await renderEventSpeech(request, { generate: async text => { instruction = text; return 'The pink heart turns.'; }, render: async () => ({ bytes: silentWav() }), knownTriggers: [] }, new AbortController().signal);
  assert.ok(instruction.includes('pink heart turns gently')); assert.ok(instruction.includes('A familiar thought settles.'));
  request.presentationPreferences!.reducedMotion = true;
  await renderEventSpeech(request, { generate: async text => { instruction = text; return 'Stay with this soft heart.'; }, render: async () => ({ bytes: silentWav() }), knownTriggers: [] }, new AbortController().signal);
  assert.ok(instruction.includes('pink heart stays steady'));
  assert.throws(() => validatePresentationText('The pink heart turns.', event.state, false, true), /movement/);
  assert.throws(() => validatePresentationText('Watch the pink gears.', event.state, false, false), /visible motif/);
});
test('interrupted audio ramps begin from the prior envelope at their entry, independently of sample time', () => {
  const event = createEpisode('peak', 'ramp', 500000, 20000, 'conditioning', 'heart', .7, true);
  event.audio = [{ offsetMs: 0, bus: 'drone', gain: 0, durationMs: 0 }, { offsetMs: 1000, bus: 'drone', gain: 1, durationMs: 4000 }, { offsetMs: 3000, bus: 'drone', gain: 0, durationMs: 2000 }];
  const runtime = new EventRuntime({ version: 1, durationMs: 1200000, baseline: event.baseline, motifs: [], events: [event] }), compiled = compileEvent(event);
  for (const [offset, expected] of [[2000,.25],[3000,.5],[4000,.25],[5000,0]]) assert.equal(presentationAt(runtime.snapshot(event.atMs + offset), compiled, event.atMs + offset).gains.drone, expected);
});
test('a restrained return never brings back a bed which was already removed; low-intensity sessions omit peaks', () => {
  const previous = createEpisode('quiet', 'q', 0, 10000, 'conditioning', 'ring', .2, false).state;
  const returning = createEpisode('return', 'r', 10000, 18000, 'conditioning', 'ring', .2, true, 0, previous);
  assert.ok(returning.softReturn!.steps.every(s => !s.state.activeLayers.includes('drone')));
  const director = new AdaptiveDirector(1200000, .2, 9), initial = director.initial(options).events[0];
  director.observe(initial, initial.state, 0, true, true); director.plan(600000, options);
  assert.equal(director.decisions.at(-1)!.candidates.find(c => c.recipe === 'peak')!.rejected, 'low intensity budget');
});
