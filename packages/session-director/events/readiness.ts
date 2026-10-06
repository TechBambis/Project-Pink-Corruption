// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Session-clock backoff: no wall timer can replay an expired narration request. */
export class SpeechReadiness {
  private retries = new Map<string, { attempts: number; retryAtMs: number }>();
  blockedUntilMs = 0;
  canRequest(id: string, nowMs: number) { return nowMs >= this.blockedUntilMs && nowMs >= (this.retries.get(id)?.retryAtMs ?? 0); }
  busy(id: string, nowMs: number, readyByMs: number) {
    const attempts = (this.retries.get(id)?.attempts ?? 0) + 1, retryAtMs = nowMs + Math.min(8000, 1000 * 2 ** (attempts - 1));
    this.retries.set(id, { attempts, retryAtMs }); this.blockedUntilMs = retryAtMs;
    return attempts <= 3 && retryAtMs < readyByMs;
  }
  succeeded(id: string) { this.retries.delete(id); this.blockedUntilMs = 0; }
  prune(live: Set<string>) { for (const id of this.retries.keys()) if (!live.has(id)) this.retries.delete(id); }
  clear() { this.retries.clear(); this.blockedUntilMs = 0; }
}
export function readinessDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
