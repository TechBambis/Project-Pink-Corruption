// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { setTimeout as delay } from 'node:timers/promises';

type Ticket = { priority: number; signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; abort: () => void };

/** One local renderer slot; conversation takes the next slot before event lookahead. */
export class SpeechRendererQueue {
  private busy = false;
  private waiting: Ticket[] = [];
  acquire(signal: AbortSignal, priority = 0): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return; }
      if (this.waiting.length >= 32) { reject(Error('Local voice preparation queue is full')); return; }
      const ticket: Ticket = { priority, signal, resolve, reject, abort: () => {
        this.waiting = this.waiting.filter(item => item !== ticket); reject(signal.reason);
      } };
      this.waiting.push(ticket); signal.addEventListener('abort', ticket.abort, { once: true }); this.drain();
    });
  }
  private drain() {
    if (this.busy) return;
    this.waiting.sort((a, b) => b.priority - a.priority);
    const next = this.waiting.shift(); if (!next) return;
    next.signal.removeEventListener('abort', next.abort);
    if (next.signal.aborted) { next.reject(next.signal.reason); this.drain(); return; }
    this.busy = true; let released = false;
    next.resolve(() => { if (released) return; released = true; this.busy = false; this.drain(); });
  }
}

const queues = new Map<string, SpeechRendererQueue>();
export function speechRendererQueue(url: string) {
  const key = new URL(url).href.replace(/\/$/, '');
  let queue = queues.get(key); if (!queue) { queue = new SpeechRendererQueue(); queues.set(key, queue); }
  return queue;
}

/** A 429 means no render started. Retry admission, never regenerate text or replay a partial stream. */
export async function fetchAvailableRenderer(request: () => Promise<Response>, signal: AbortSignal,
  policy: { maxWaitMs?: number; now?: () => number; sleep?: (ms: number, signal: AbortSignal) => Promise<unknown> } = {}) {
  const now = policy.now ?? (() => performance.now());
  const sleep = policy.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const deadline = now() + (policy.maxWaitMs ?? 30000); let attempt = 0;
  for (;;) {
    signal.throwIfAborted();
    const response = await request();
    if (response.status !== 429) return response;
    const detail = await response.text();
    if (!/voice renderer is busy/i.test(detail)) throw Error(`Local voice HTTP 429: ${detail.slice(0, 500)}`);
    const remaining = deadline - now();
    if (remaining <= 0) throw Error('Local voice renderer remained busy for the preparation window');
    await sleep(Math.min(remaining, 250 * 2 ** Math.min(attempt++, 3)), signal);
  }
}
