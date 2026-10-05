// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export const speechDucking = { bedDb: -8, sessionGain: .62, attackSeconds: .2, releaseSeconds: .8 } as const;
interface SpeechWindow { start: number; end: number; trigger: boolean }

/** Separate gain stages preserve preset levels. All envelopes use the audio clock. */
export class SpeechDucker {
  private windows = new Map<object, SpeechWindow>();
  constructor(private context: Pick<AudioContext, 'currentTime'>, private bed: AudioParam, private session: AudioParam) {}
  get active() { return [...this.windows.values()].some(w => w.start <= this.context.currentTime && this.context.currentTime < w.end); }
  schedule(source: object, start: number, end: number, trigger: boolean) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    this.windows.set(source, { start, end, trigger });
    this.rebuild();
  }
  forget(source: object) { if (this.windows.delete(source)) this.rebuild(); }
  clear() {
    this.windows.clear();
    for (const param of [this.bed, this.session]) {
      param.cancelScheduledValues(this.context.currentTime);
      param.setValueAtTime(1, this.context.currentTime);
    }
  }
  private rebuild() {
    const now = this.context.currentTime;
    const windows = [...this.windows.values()].filter(w => w.end > now);
    const times = [...new Set([now, ...windows.flatMap(w => [w.start, w.end]).filter(t => t > now)])].sort((a, b) => a - b);
    for (const [param, background] of [[this.bed, true], [this.session, false]] as const) {
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else {
        // Firefox versions without cancelAndHoldAtTime still preserve the current gain.
        const held = param.value;
        param.cancelScheduledValues(now);
        param.setValueAtTime(held, now);
      }
      let previous: number | undefined;
      for (const time of times) {
        const active = windows.filter(w => w.start <= time && time < w.end);
        const duck = background ? active.some(w => !w.trigger) && !active.some(w => w.trigger) : active.length > 0;
        const target = duck ? background ? 10 ** (speechDucking.bedDb / 20) : speechDucking.sessionGain : 1;
        if (target === previous) continue;
        // Three time constants reach about 95% of the requested gain change.
        param.setTargetAtTime(target, time, (duck ? speechDucking.attackSeconds : speechDucking.releaseSeconds) / 3);
        previous = target;
      }
    }
  }
}
