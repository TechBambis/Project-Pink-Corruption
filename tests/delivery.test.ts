// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationDeliveryAt, deliverySpeed, deliveryProfiles, deliveryDirection, deliveryWordBudget } from '../packages/session-director/delivery';
import { deliveryGains } from '../packages/audio/delivery-mix';
import { ChatRequestSchema } from '../packages/ai/request';
import { Kokoro } from '../packages/speech/tts';
import { deliveryPresentation, type VisualPresentation } from '../packages/visuals/choreography';
import { createReferenceProgram } from '../packages/session-director/events/program';
import { compileEvent } from '../packages/session-director/events/runtime';
import { sessionPhaseAt } from '../packages/session-director/phases';

test('delivery varies within conditioning without changing parent boundaries or closing behavior', () => {
  for (const duration of [300, 600, 1200, 3600]) {
    assert.equal(narrationDeliveryAt(duration * .9, duration), 'return');
    assert.equal(narrationDeliveryAt(duration, duration), 'return');
    const modes = new Set();
    for (let time = duration * .4; time < duration * .8; time++) {
      assert.equal(sessionPhaseAt(time, duration).phase, 'conditioning');
      modes.add(narrationDeliveryAt(time, duration));
    }
    assert.ok(modes.has('drive') && modes.has('hold'));
    const program = createReferenceProgram(duration * 1000);
    assert.ok(program.events.filter(e => e.type === 'peak').every(e => e.speech.delivery === 'drive'));
    for (const event of program.events) {
      for (const slot of compileEvent(event).speech) assert.ok(slot.endMs <= event.atMs + event.timing.prepMs + event.timing.activeMs + event.timing.returnMs);
    }
  }
});

test('delivery respects the user speed range, source audio and final visual fade', () => {
  for (const base of [.5, .78, 1.5]) for (const mode of ['settle', 'drive'] as const) assert.ok(deliverySpeed(base, mode) >= .5 && deliverySpeed(base, mode) <= 1.5);
  assert.ok(deliverySpeed(.78, 'drive') > deliverySpeed(.78, 'settle') * 1.4);
  assert.equal(ChatRequestSchema.parse({ type: 'chat', text: 'Hello.' }).adaptiveDelivery, false, 'Existing clients remain unchanged');
  const mix = deliveryGains('hold');
  assert.ok(!('SESSION' in mix) && !('music_optional' in mix) && !('MASTER' in mix));
  assert.ok(Object.values(mix).every(gain => gain > 0 && gain <= 1));
  assert.ok(Object.values(deliveryGains()).every(gain => gain === 1));
  const base: VisualPresentation = { scene: 'Audio Only', opacity: 0, spiral: { speed: .2, complexity: 1, alpha: 0, colorA: '#f00088', colorB: '#000000', mode: 'breathe' } };
  assert.equal(deliveryPresentation(base, 'drive'), base, 'The final audio-only fade must not revive graphics');
  const visible = { ...base, scene: 'Spiral Focus' as const, opacity: .5 };
  assert.ok(deliveryPresentation(visible, 'hold').opacity < deliveryPresentation(visible, 'drive').opacity);
  assert.match(deliveryDirection('drive'), /engine budget overrides/);
  assert.equal(deliveryWordBudget('return', 30), 24, 'A five-minute session cannot queue a long closing into its thirty-second final phase');
  assert.equal(deliveryWordBudget('return', 120), 123);
  assert.equal(deliveryWordBudget('drive', 1200), 85);
});

test('adaptive TTS removes model-authored pauses and sends engine phrase timing; ordinary TTS retains its preset', async () => {
  const original = globalThis.fetch, calls: any[] = [];
  try {
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body)); calls.push(body);
      return new Response(JSON.stringify({ text: body.input, audio: 'AAAA', audio_format: 'wav', timestamps: [], spoken_seconds: .2 }) + '\n');
    };
    const tts = new Kokoro();
    for await (const _ of tts.speak('One clear thought. [pause:10000] The next thought.', 'af_heart', deliverySpeed(.78, 'drive'), AbortSignal.timeout(3000), 'bambi_local_clean', [], false, undefined, 'drive')) {}
    assert.ok(calls.every(body => !/\[pause:/i.test(body.input)));
    assert.ok(calls.every(body => body.overrides.timing.normal === deliveryProfiles.drive.phrasePauseMs));
    const count = calls.length;
    for await (const _ of tts.speak('A normal conversation.', 'af_heart', .78, AbortSignal.timeout(3000))) {}
    assert.equal(calls[count].overrides, undefined);
    for await (const _ of tts.speak('One anchor.', 'af_heart', .7, AbortSignal.timeout(3000), 'bambi_local_clean', [], true, undefined, 'hold')) {}
    assert.equal(calls.at(-1).overrides.timing.normal, 0, 'Native events reserve their own recovery/blank interval');
  } finally { globalThis.fetch = original; }
});
