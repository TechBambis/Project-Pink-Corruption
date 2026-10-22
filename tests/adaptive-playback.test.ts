// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEvents } from '../apps/web/src/session-events';
import { AdaptiveDirector } from '../packages/session-director/adaptive';
import { createEpisode } from '../packages/session-director/events/episodes';
import { EventRuntime } from '../packages/session-director/events/runtime';
import { EventSpeechRequestSchema, type RenderedEventSpeech } from '../packages/session-director/events/speech';
import type { AudioEngine } from '../packages/audio';

function fixture() {
  const initial = createEpisode('introduction', 'fixture', 0, 24000, 'induction', 'ring', .7, true);
  const settings = EventSpeechRequestSchema.parse({ event: initial, payloadId: 'fixture:payload', allowedTriggers: [] });
  const notices: string[] = [], voices: { stop(): void }[] = [];
  let clears = 0;
  const audio = { context: { currentTime: 10, decodeAudioData: async () => ({ duration: 1 }) }, outputTime: 10,
    setNarrationDelivery() {}, setEventMode() {}, setEventGains() {}, clearEventGains() {}, stopEventCues() {},
    playEventVoice() { const source = { onended: null, stop() {} }; voices.push(source); return source; },
  } as unknown as AudioEngine;
  const hooks: ConstructorParameters<typeof SessionEvents>[2] = { audio: () => audio, visuals: () => null, settings: () => settings,
    notice: text => notices.push(text), narration() {}, displayNarration() {}, clearSpeech() {}, clearDevices: () => { clears++; },
    cue() {}, pink() {}, allowVisuals: () => true, paused: () => false, triggers: () => ({}), haptics: () => false,
    restore() {}, allowSpeech: () => true, allowTriggers: () => true, allowTriggerSound: () => false };
  const original = globalThis.document;
  const element = () => ({ hidden: true, style: { removeProperty() {} }, dataset: {}, append() {}, setAttribute() {} });
  let adapter: SessionEvents;
  try { globalThis.document = { createElement: element } as unknown as Document; adapter = new SessionEvents(element() as unknown as HTMLElement, element() as unknown as HTMLCanvasElement, hooks); }
  finally { globalThis.document = original; }
  const internal = adapter! as unknown as { started: boolean; runtime: EventRuntime; adaptive: AdaptiveDirector; request: AbortController | null; payloads: Map<string, { response: RenderedEventSpeech }> };
  return { adapter: adapter!, internal, notices, voices, get clears() { return clears; } };
}
function rendered(body: { payloadId: string }) {
  return Response.json({ payloadId: body.payloadId, text: 'Stay with the familiar scene.', audio: btoa('fixture'), durationMs: 1000 });
}

test('Unlimited adapter keeps its plan beyond the first journey, supports later seek and releases on Stop',async()=>{
 const f=fixture(),original=globalThis.fetch;
 try{
  globalThis.fetch=async(_url,init)=>rendered(JSON.parse(init!.body as string));
  await f.adapter.prepare(1200000,.7,new AbortController().signal,undefined,true);f.internal.started=true;
  assert.equal(f.adapter.program!.continuous,true);
  f.adapter.tick(0);f.adapter.seek(1200000+500000);f.adapter.tick(1700000);
  assert.equal(f.adapter.snapshot!.complete,false);assert.equal(f.adapter.program!.events[0].phase,'conditioning');
  f.adapter.seek(86400000+500000);f.adapter.tick(86900000);
  assert.equal(f.adapter.snapshot!.complete,false);assert.ok(f.adapter.program!.events.some(e=>e.atMs>=86900000));
  f.adapter.pause();f.adapter.resume();f.adapter.stop();assert.equal(f.adapter.active,false);assert.equal(f.adapter.program,undefined);
 }finally{f.adapter.stop();globalThis.fetch=original;}
});

test('native preparation retries a busy renderer once and caches only the successful response', async () => {
  const f = fixture(), original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => ++calls === 1 ? Response.json({ error: 'Local voice renderer is busy.' }, { status: 429 }) : rendered(JSON.parse(init!.body as string));
    await f.adapter.prepare(1200000, .7, new AbortController().signal);
    assert.equal(calls, 2); assert.equal(f.internal.payloads.size, 1); assert.deepEqual(f.notices, []);
  } finally { f.adapter.stop(); globalThis.fetch = original; }
});

test('a clock jump across an unprepared episode entry replaces it before any speech or bound cue fires', async () => {
  const f = fixture(), original = globalThis.fetch; let calls = 0, release: (response: Response) => void = () => {}, pendingBody: { payloadId: string; precedingNarration?: string } | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string); if (++calls === 1) return rendered(body);
      pendingBody = body; return new Promise<Response>(resolve => { release = resolve; });
    };
    await f.adapter.prepare(1200000, .7, new AbortController().signal); f.internal.started = true;
    f.adapter.tick(0); f.adapter.tick(100);
    const pending = f.internal.runtime.compiled.at(-1)!; assert.ok(pending.event.atMs > 100 && pending.speech.length > 0);
    assert.notEqual(pendingBody!.precedingNarration, 'Stay with the familiar scene.', 'Unheard queued words do not become continuity history');
    const request = f.internal.request!; f.adapter.tick(pending.event.atMs + 500);
    assert.equal(request.signal.aborted, true); assert.equal(f.internal.runtime.compiled.find(c => c.event.id === pending.event.id)!.speech.length, 0);
    assert.equal(f.adapter.decisions.find(d => d.eventId === pending.event.id)!.fallback, true);
    release(rendered(pendingBody!)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.internal.payloads.has(pendingBody!.payloadId), false); assert.equal(f.voices.length, 1);
  } finally { release(rendered(pendingBody ?? { payloadId: 'unused' })); f.adapter.stop(); globalThis.fetch = original; }
});

test('ordinary narration tolerates one late control tick inside its unchanged window', async () => {
  const f = fixture(), original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => rendered(JSON.parse(init!.body as string));
    await f.adapter.prepare(1200000, .7, new AbortController().signal); f.internal.started = true;
    const deadline = f.internal.runtime.slots[0].endMs;
    f.adapter.tick(60); assert.equal(f.voices.length, 1);
    assert.equal(f.internal.runtime.slots[0].endMs, deadline);
    assert.equal((f.adapter as unknown as { caption: { startMs: number } }).caption.startMs, 60);
  } finally { f.adapter.stop(); globalThis.fetch = original; }
});

test('a no-text interval can prepare a future voice without generating text for itself; Pause aborts it', async () => {
  const f = fixture(), original = globalThis.fetch; let requested: string | undefined, release: (response: Response) => void = () => {};
  try {
    const quiet = createEpisode('quiet', 'quiet', 500000, 10000, 'conditioning', 'heart', .7, false);
    const passage = createEpisode('passage', 'next', 510000, 30000, 'conditioning', 'heart', .7, true);
    f.internal.runtime = new EventRuntime({ version: 1, durationMs: 1200000, baseline: quiet.baseline, motifs: [], events: [quiet, passage] });
    f.internal.adaptive = new AdaptiveDirector(1200000, .7, 9); f.internal.started = true;
    globalThis.fetch = async (_url, init) => { requested = JSON.parse(init!.body as string).payloadId; return new Promise<Response>(resolve => { release = resolve; }); };
    f.adapter.tick(500000); const request = f.internal.request!;
    f.adapter.tick(500100);
    assert.equal(requested, 'next:payload'); assert.equal(request.signal.aborted, false); assert.equal(f.voices.length, 0);
    f.adapter.pause(); assert.equal(request.signal.aborted, true); assert.ok(f.clears > 0);
    release(rendered({ payloadId: requested! })); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.internal.payloads.size, 0);
  } finally { release(rendered({ payloadId: 'unused' })); f.adapter.stop(); globalThis.fetch = original; }
});

test('adaptive seek re-enters the destination parent without expired speech; Stop releases the new plan', async () => {
  const f = fixture(), original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => rendered(JSON.parse(init!.body as string));
    await f.adapter.prepare(1200000, .7, new AbortController().signal); f.internal.started = true;
    f.adapter.tick(0); f.adapter.seek(650000);
    assert.equal(f.adapter.program!.events.length, 1); assert.equal(f.adapter.program!.events[0].phase, 'conditioning');
    assert.equal(f.internal.runtime.slots.length, 0); assert.equal(f.internal.payloads.size, 0);
    f.adapter.seek(1000); assert.equal(f.adapter.program!.events[0].phase, 'induction');
    f.adapter.stop(); assert.equal(f.adapter.active, false); assert.equal(f.adapter.program, undefined); assert.deepEqual(f.adapter.decisions, []);
  } finally { f.adapter.stop(); globalThis.fetch = original; }
});
