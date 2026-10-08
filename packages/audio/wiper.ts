// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Acoustic stroke landmarks, in buffer seconds. Analysed once, never on the render loop. */
export interface WiperStroke { start: number; peak: number; end: number }
export interface WiperProfile { duration: number; strokes: WiperStroke[] }
export interface WiperFrame { active: boolean; visible?: boolean; x: number; direction: number; strength: number; remaining: number; text: string; stroke: number }
export const emptyWiperFrame: WiperFrame = { active: false, x: 0, direction: 1, strength: 0, remaining: 1, text: '', stroke: -1 };
export interface WiperPlayback { start: number; duration: number; offset: number; profile: WiperProfile; text?: string }

export function analyseWiper(channels: readonly Float32Array[], rate: number): WiperProfile {
  if (!channels.length || !Number.isFinite(rate) || rate <= 0) return { duration: 0, strokes: [] };
  const length = Math.min(...channels.map(c => c.length)), hop = Math.max(1, Math.round(rate * .01));
  const duration = length / rate, step = hop / rate, energy: number[] = [];
  for (let i = 0; i < length; i += hop) {
    let sum = 0, count = 0;
    for (const channel of channels) for (let j = i; j < Math.min(length, i + hop); j++) { sum += channel[j] ** 2; count++; }
    energy.push(Math.sqrt(sum / count));
  }
  const smooth = energy.map((_, i) => { let sum = 0, count = 0; for (let j = Math.max(0, i - 3); j <= Math.min(energy.length - 1, i + 3); j++) { sum += energy[j]; count++; } return sum / count; });
  const sorted = [...smooth].sort((a, b) => a - b), floor = sorted[Math.floor(sorted.length * .2)] ?? 0;
  const top = sorted[Math.floor(sorted.length * .98)] ?? 0;
  if (top < .000001 || top - floor < top * .12) return { duration, strokes: [] };
  const threshold = floor + (top - floor) * .4, edge = floor + (top - floor) * .12;
  const peaks: number[] = [];
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i] < threshold || smooth[i] < (smooth[i - 1] ?? 0) || smooth[i] <= (smooth[i + 1] ?? 0)) continue;
    const last = peaks.at(-1);
    if (last !== undefined && (i - last) * step < .28) { if (smooth[i] > smooth[last]) peaks[peaks.length - 1] = i; }
    else peaks.push(i);
  }
  const strokes = peaks.map((peak, index) => {
    const left = index ? Math.ceil((peaks[index - 1] + peak) / 2) : 0;
    const right = index + 1 < peaks.length ? Math.floor((peak + peaks[index + 1]) / 2) : smooth.length - 1;
    let start = peak, end = peak;
    while (start > left && smooth[start - 1] > edge) start--;
    while (end < right && smooth[end + 1] > edge) end++;
    return { start: start * step, peak: peak * step, end: Math.min(duration, (end + 1) * step) };
  }).filter(s => s.end - s.start >= .08);
  return { duration, strokes };
}

const profiles = new WeakMap<AudioBuffer, WiperProfile>();
export function wiperProfile(buffer: AudioBuffer): WiperProfile {
  let profile = profiles.get(buffer);
  if (!profile) { profile = analyseWiper(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), buffer.sampleRate); profiles.set(buffer, profile); }
  return profile;
}
const smooth = (n: number) => { n = Math.max(0, Math.min(1, n)); return n * n * (3 - 2 * n); };

/** Uses the actual buffer offset (including resumed/looped sources), never a CSS timer. */
export function wiperFrame(playback: WiperPlayback | undefined, time: number): WiperFrame {
  if (!playback || time < playback.start || time >= playback.start + playback.duration || !playback.profile.strokes.length) return emptyWiperFrame;
  const { profile } = playback, elapsed = playback.offset + time - playback.start;
  const loop = Math.floor(elapsed / profile.duration), local = elapsed % profile.duration;
  const index = profile.strokes.findIndex(s => local >= s.start && local < s.end);
  if (index < 0) {
    // Hold the physical blade at its last endpoint instead of making it vanish between strokes.
    let completed = -1;
    for (let i = 0; i < profile.strokes.length; i++) if (profile.strokes[i].end <= local) completed = i;
    const ordinal = loop * profile.strokes.length + completed;
    const last = ordinal >= 0 ? ordinal : 0, direction = last % 2 ? -1 : 1;
    return { active: false, visible: true, x: ordinal < 0 ? 0 : direction > 0 ? 1 : 0, direction, strength: 0, remaining: 0, text: '', stroke: ordinal };
  }
  const stroke = profile.strokes[index], ordinal = loop * profile.strokes.length + index, direction = ordinal % 2 ? -1 : 1;
  // Reach the middle at the friction maximum, then settle at the far edge.
  const progress = local <= stroke.peak ? .5 * smooth((local - stroke.start) / Math.max(.001, stroke.peak - stroke.start))
    : .5 + .5 * smooth((local - stroke.peak) / Math.max(.001, stroke.end - stroke.peak));
  const fade = smooth((time - playback.start) / .06) * smooth((playback.start + playback.duration - time) / .08);
  return { active: true, x: direction > 0 ? progress : 1 - progress, direction,
    strength: Math.sin(Math.PI * progress) * fade, remaining: 1 - progress,
    text: playback.text ?? 'THOUGHTS', stroke: ordinal };
}
