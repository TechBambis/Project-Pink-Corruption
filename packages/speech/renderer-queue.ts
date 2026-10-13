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

export interface PlaybackBufferReport {
 sample:number;seqs:number[];queuedSeconds:number;speechSeconds:number;queuedBytes:number;running:boolean;
}
/** Browser output-clock observations, never generated sentence counts or server-time decay. */
export class SpeechRenderAhead {
 static readonly maxSeconds=30;
 static readonly maxBytes=8*1024*1024;
 private pending=new Map<number,{seconds:number;bytes:number}>();
 private durations:number[]=[];
 private report:PlaybackBufferReport={sample:-1,seqs:[],queuedSeconds:0,speechSeconds:0,queuedBytes:0,running:true};
 private held=false;
 get lowSeconds(){const values=[...this.durations].sort((a,b)=>a-b);const p95=values[Math.max(0,Math.ceil(values.length*.95)-1)]??1.25;return Math.min(4,Math.max(1.5,p95+.25));}
 get highSeconds(){return Math.min(6,this.lowSeconds+1.5);}
 get reserveLow(){return this.report.speechSeconds<=this.lowSeconds;}
 rendered(ms:number){if(Number.isFinite(ms)&&ms>=0){this.durations.push(ms/1000);if(this.durations.length>32)this.durations.shift();}}
 sent(seq:number,seconds:number,bytes:number){this.pending.set(seq,{seconds,bytes});}
 acknowledged(seq:number){this.pending.delete(seq);}
 observe(report:PlaybackBufferReport){
  if(report.sample<=this.report.sample||report.seqs.some(seq=>!this.pending.has(seq)))return false;
  this.report={...report,seqs:[...report.seqs]};
  if(this.held&&report.queuedSeconds<=this.lowSeconds)this.held=false;
  if(report.queuedSeconds>=this.highSeconds)this.held=true;
  return true;
 }
 allows(seconds=0,bytes=0){
  if(!Number.isFinite(seconds)||seconds<0||seconds>SpeechRenderAhead.maxSeconds||bytes>SpeechRenderAhead.maxBytes)throw Error('Voice unit exceeds the live audio limit');
  const pending=[...this.pending.values()];
  const unscheduled=[...this.pending.keys()].some(seq=>!this.report.seqs.includes(seq));
  return !this.held&&this.report.running&&!unscheduled&&pending.reduce((n,p)=>n+p.bytes,bytes)<=SpeechRenderAhead.maxBytes&&pending.reduce((n,p)=>n+p.seconds,seconds)<=SpeechRenderAhead.maxSeconds;
 }
 get snapshot(){return {sample:this.report.sample,queuedSeconds:this.report.queuedSeconds,speechSeconds:this.report.speechSeconds,authoredSilenceSeconds:Math.max(0,this.report.queuedSeconds-this.report.speechSeconds),queuedBytes:this.report.queuedBytes,lowSeconds:this.lowSeconds,highSeconds:this.highSeconds,held:this.held,pending:this.pending.size};}
}
