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
/** Friction peaks locate the stroke centre; their narrow energy envelopes are not full travel windows. */
export function wiperMotionProfile(profile: WiperProfile): WiperProfile {
  const { duration, strokes } = profile;
  if (!strokes.length || duration <= 0) return profile;
  return { duration, strokes: strokes.map((stroke, i) => {
    const previous = i ? strokes[i - 1].peak : strokes.at(-1)!.peak - duration;
    const next = i + 1 < strokes.length ? strokes[i + 1].peak : strokes[0].peak + duration;
    // Derive room for travel from adjacent acoustic peaks; keep real gaps and all peak times.
    const halfTravel = Math.min(.8, .85 * Math.min(stroke.peak - previous, next - stroke.peak)) / 2;
    const lower = i ? (previous + stroke.peak) / 2 : 0;
    const upper = i + 1 < strokes.length ? (stroke.peak + next) / 2 : duration;
    return { start: Math.max(lower, Math.min(stroke.start, stroke.peak - halfTravel)), peak: stroke.peak,
      end: Math.min(upper, Math.max(stroke.end, stroke.peak + halfTravel)) };
  }) };
}
export function wiperProfile(buffer: AudioBuffer): WiperProfile {
  let profile = profiles.get(buffer);
  if (!profile) { profile = wiperMotionProfile(analyseWiper(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), buffer.sampleRate)); profiles.set(buffer, profile); }
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
  // Monotone Hermite travel: stop only at reversal, with continuous nonzero speed at the sound peak.
  const a = Math.max(.001, stroke.peak - stroke.start), b = Math.max(.001, stroke.end - stroke.peak);
  const w1 = 2 * b + a, w2 = b + 2 * a;
  const middleSpeed = (w1 + w2) / (w1 / (.5 / a) + w2 / (.5 / b));
  const first = local <= stroke.peak, u = Math.min(1, Math.max(0, first ? (local - stroke.start) / a : (local - stroke.peak) / b));
  const progress = first ? .5 * smooth(u) + a * middleSpeed * (u * u * u - u * u)
    : .5 + .5 * smooth(u) + b * middleSpeed * (u * u * u - 2 * u * u + u);
  const fade = smooth((time - playback.start) / .06) * smooth((playback.start + playback.duration - time) / .08);
  return { active: true, x: direction > 0 ? progress : 1 - progress, direction,
    strength: Math.sin(Math.PI * progress) * fade, remaining: 1 - progress,
    text: playback.text ?? 'THOUGHTS', stroke: ordinal };
}
