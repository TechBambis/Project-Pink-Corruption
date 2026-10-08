// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { clamp } from '../safety/actions';
import type {WiperFrame} from '../audio/wiper';

export interface TickVisualSignal { active: boolean; phaseMs: number; level: number }
export interface AudioVisualSignal { time: number; voice: number; tick: TickVisualSignal; wiper?: WiperFrame }
export const silentVisualSignal: AudioVisualSignal = { time: 0, voice: 0, tick: { active: false, phaseMs: 0, level: 0 } };

/** Attack/release follows the audio clock, so suspended playback freezes the envelope. */
export class AudioReactivity {
  private time: number | undefined;
  private voice = 0;
  voiceAmount = 0;
  tickAmount = 0;
  frame(signal: AudioVisualSignal, strength: number, voiceEnabled: boolean, tickEnabled: boolean, reduced: boolean) {
    if (reduced || strength <= 0) { this.clear(); return 0; }
    const dt = this.time === undefined || signal.time < this.time ? 1 / 60 : Math.min(.1, signal.time - this.time);
    this.time = signal.time;
    const target = voiceEnabled ? clamp(signal.voice) : 0;
    if (!voiceEnabled) this.voice = 0;
    this.voice += (target - this.voice) * (1 - Math.exp(-dt / (target > this.voice ? .14 : .35)));
    // One rounded pulse starts at each audible tick, including tempo changes.
    const phase = signal.tick.phaseMs / 1000;
    const pulse = phase < .045 ? Math.sin(Math.PI / 2 * phase / .045) ** 2
      : Math.cos(Math.PI / 2 * (phase - .045) / .315) ** 2;
    const tick = tickEnabled && signal.tick.active && phase >= 0 && phase < .36
      ? pulse * clamp(signal.tick.level) : 0;
    this.voiceAmount = clamp(strength) * this.voice * .65;
    this.tickAmount = clamp(strength) * tick * .75;
    return clamp(strength) * clamp(this.voice * .65 + tick * .75);
  }
  clear() { this.time = undefined; this.voice = this.voiceAmount = this.tickAmount = 0; }
}
