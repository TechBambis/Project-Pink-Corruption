// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { matchSoundLevel } from './sound-level';

export const eventCueSettings = {
  blink: { frequency: 104, duration: 1.8, decay: .48, levelDb: -18 },
  close: { frequency: 82, duration: .9, decay: .28, levelDb: -23 },
  open: { frequency: 138, duration: .75, decay: .23, levelDb: -23 },
} as const;
export type EventCueSound = keyof typeof eventCueSettings | 'pulse_a' | 'pulse_b';

/** Original tonal pulses: no sampled reference audio. Finite, identical stereo channels. */
export function synthesizeEventCue(kind: EventCueSound, rate = 48000): [Float32Array, Float32Array] {
  if (kind === 'pulse_a' || kind === 'pulse_b') {
    const duration = kind === 'pulse_a' ? .055 : .06, frequency = kind === 'pulse_a' ? 1350 : 2400;
    const data = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, attack = Math.min(1, t / .0015), release = Math.min(1, (duration - t) / .008);
      data[i] = attack * release * Math.exp(-t / .009) * (Math.sin(2 * Math.PI * frequency * t) + .2 * Math.sin(2 * Math.PI * frequency * 1.73 * t));
    }
    const channels: [Float32Array, Float32Array] = [data, data.slice()];
    matchSoundLevel(channels, rate, -25);
    return channels;
  }
  const spec = eventCueSettings[kind], data = new Float32Array(Math.round(rate * spec.duration));
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate, attack = Math.min(1, t / .012), release = Math.min(1, (spec.duration - t) / .05);
    phase += 2 * Math.PI * (spec.frequency + 7 * Math.exp(-t / .07)) / rate;
    data[i] = (Math.sin(phase) + .055 * Math.sin(2 * phase)) * attack * release * Math.exp(-t / spec.decay);
  }
  const channels: [Float32Array, Float32Array] = [data, data.slice()];
  matchSoundLevel(channels, rate, spec.levelDb);
  return channels;
}
