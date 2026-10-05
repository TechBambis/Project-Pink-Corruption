// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechRendererQueue, speechRendererQueue, fetchAvailableRenderer } from '../packages/speech/renderer-queue';
import { Kokoro } from '../packages/speech/tts';

test('voice preparation serializes, prioritizes conversation and removes cancelled queued work', async () => {
  const queue = new SpeechRendererQueue(), live = new AbortController(), cancelled = new AbortController();
  const release = await queue.acquire(live.signal); const order: string[] = [];
  const event = queue.acquire(live.signal, 0).then(done => { order.push('event'); done(); });
  const stopped = queue.acquire(cancelled.signal); const rejection = assert.rejects(stopped, /Stopped/);
  const conversation = queue.acquire(live.signal, 10).then(done => { order.push('conversation'); done(); });
  cancelled.abort(Error('Stopped')); await rejection;
  assert.deepEqual(order, []); release(); release(); await Promise.all([event, conversation]);
  assert.deepEqual(order, ['conversation', 'event']);
  assert.equal(speechRendererQueue('http://127.0.0.1:8882'), speechRendererQueue('http://127.0.0.1:8882/'));
});

test('a busy renderer retries only admission and preserves the caller cancellation/deadline', async () => {
  let attempts = 0, elapsed = 0;
  const signal = new AbortController().signal;
  const response = await fetchAvailableRenderer(async () => ++attempts < 3
    ? new Response(JSON.stringify({error:'Local voice renderer is busy. Wait or stop the current request.'}), {status:429})
    : new Response('ready'), signal, { now: () => elapsed, sleep: async ms => { elapsed += ms; } });
  assert.equal(await response.text(), 'ready'); assert.equal(attempts, 3); assert.equal(elapsed, 750);
  await assert.rejects(fetchAvailableRenderer(async () => new Response('voice renderer is busy', {status:429}), signal,
    {maxWaitMs:100,now:()=>elapsed,sleep:async ms=>{elapsed+=ms;}}), /remained busy/);
  const stop = new AbortController();
  await assert.rejects(fetchAvailableRenderer(async () => new Response('voice renderer is busy', {status:429}), stop.signal,
    {sleep:async()=>{stop.abort(Error('Stopped'));}}), /Stopped/);
  await assert.rejects(fetchAvailableRenderer(async () => new Response('rate limit', {status:429}), signal), /rate limit/);
});

test('a stopped TTS stream releases the shared slot without replaying accepted audio', async () => {
  const original = globalThis.fetch; let attempts = 0;
  const signal = new AbortController().signal;
  globalThis.fetch = async () => {
    attempts++;
    return new Response(JSON.stringify({audio:'YQ==',audio_format:'wav',text:'Quiet.',timestamps:[]})+'\n');
  };
  try {
    const voice = new Kokoro('http://127.0.0.1:18882');
    const first = voice.speak('Quiet.', 'af_heart', .78, signal, 'bambi_local_clean', [], true);
    assert.equal((await first.next()).value?.text, 'Quiet.');
    await first.return(undefined);
    const second = voice.speak('Quiet.', 'af_heart', .78, signal);
    assert.equal((await second.next()).value?.text, 'Quiet.'); await second.return(undefined);
    assert.equal(attempts,2);
  } finally { globalThis.fetch = original; }
});
