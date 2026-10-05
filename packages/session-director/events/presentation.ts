// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { Bus } from '../../audio';
import type { PresentationState } from './contract';
import type { CompiledEvent, EngineSnapshot } from './runtime';

export function stateGains(state: PresentationState): Partial<Record<Bus, number>> {
  const has = (layer: string) => state.activeLayers.includes(layer as never);
  const voice = state.narrationState === 'speaking';
  const bed = state.ambientState === 'silent' ? 0 : state.ambientState === 'reduced' ? .5 : 1;
  const support = state.foreground === 'main_voice' || state.foreground === 'mantra_voice' ? .6 : 1;
  return {
    AI_VOICE: voice ? 1 : 0,
    main_voice: voice && (has('main_voice') || has('mantra_voice')) ? 1 : 0,
    left_voice: voice && has('left_voice') ? support : 0,
    right_voice: voice && has('right_voice') ? support : 0,
    echo_voice: voice && has('echo_voice') ? support : 0,
    drone: has('drone') ? bed * support : 0,
    noise: has('noise') ? bed * support : 0,
    music_optional: has('music') ? bed * support : 0,
    SESSION: bed,
    AMBIENCE: 0, // This vocabulary has no ambient-sample layer; never leak a legacy bed.
    EFFECTS: has('transition_sfx') ? support : 0,
  };
}
function visual(state: PresentationState) {
  const has = (layer: string) => state.activeLayers.includes(layer as never);
  const black = state.visualState === 'black';
  return {
    canvas: !black && (has('base_visual') || has('spiral')) ? 1 : 0,
    motif: !black && has('motif_visual') ? 1 : 0,
    overlay: !black && has('overlay') ? .2 : 0,
    text: !black && (has('center_text') || has('trigger_text')) ? 1 : 0,
    black: black ? 1 : 0,
    motion: state.visualState === 'sparse' || black ? 0 : state.density.visualDensity,
  };
}
const unit = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** All envelopes are sampled from session time, including after a seek. No CSS/wall-clock timers. */
export function presentationAt(snapshot: EngineSnapshot, current: CompiledEvent | undefined, atMs: number) {
  const frame = current?.frames.filter(f => f.atMs <= atMs).at(-1);
  const previous = frame && current!.frames.filter(f => f.atMs < frame.atMs).at(-1);
  const from = previous?.state ?? current?.entryState ?? current?.event.baseline ?? snapshot.state;
  const target = frame?.state ?? snapshot.state;
  const transition = frame?.transition;
  const p = transition?.durationMs ? unit((atMs - frame!.atMs) / transition.durationMs) : 1;
  const kind = transition?.kind;
  let audioP = p, visualP = p;
  if (kind === 'audio_first') { audioP = unit(p * 2); visualP = unit(p * 2 - 1); }
  if (kind === 'visual_first') { audioP = unit(p * 2 - 1); visualP = unit(p * 2); }
  if (kind === 'hard_cut' || kind === 'silence_cut') audioP = visualP = 1;
  const sourceGains = stateGains(from), gains = stateGains(target);
  for (const bus of Object.keys(gains) as Bus[]) gains[bus] = lerp(sourceGains[bus] ?? 0, gains[bus]!, audioP);
  // A no-text blank never crossfades semantic speech into its reserved window.
  if (target.narrationState === 'paused') gains.AI_VOICE = 0;
  const oldVisual = visual(from), values = visual(target);
  for (const key of Object.keys(values) as (keyof typeof values)[]) values[key] = lerp(oldVisual[key], values[key], visualP);
  let blurPx = kind === 'blur' ? Math.sin(p * Math.PI) * 8 : 0;
  let zoom = kind === 'zoom' ? 1 + Math.sin(p * Math.PI) * .1 : 1;
  let text: string | undefined;
  if (current) {
    // Last authored envelope for each property wins; expired envelopes hold until the next frame.
    const sinceFrame = frame?.atMs ?? current.event.atMs;
    for (const action of current.event.audio) {
      const start = current.event.atMs + action.offsetMs;
      if (start > atMs || start < sinceFrame) continue;
      const t = action.durationMs ? unit((atMs - start) / action.durationMs) : 1;
      gains[action.bus] = lerp(gains[action.bus] ?? 0, action.gain, t);
    }
    for (const action of current.event.visual) {
      const start = current.event.atMs + action.offsetMs;
      if (start > atMs || start < sinceFrame) continue;
      const t = action.durationMs ? unit((atMs - start) / action.durationMs) : 1;
      if (action.opacity !== undefined) values.canvas *= lerp(1, action.opacity, t);
      if (action.motion !== undefined) values.motion = lerp(values.motion, action.motion, t);
      if (action.blurPx !== undefined) blurPx = lerp(blurPx, action.blurPx, t);
      if (action.zoom !== undefined) zoom = lerp(zoom, action.zoom, t);
      if (action.text !== undefined) text = action.text;
    }
  }
  // Automation cannot activate an undeclared bus or violate an actual speech/ambient silence.
  const allowed = stateGains(target);
  for (const bus of Object.keys(gains) as Bus[]) {
    if (allowed[bus] === 0 && (p === 1 || sourceGains[bus] === 0)) gains[bus] = 0;
  }
  if (target.narrationState === 'paused') gains.AI_VOICE = 0;
  if (target.ambientState === 'silent') for (const bus of ['drone', 'noise', 'music_optional', 'SESSION'] as Bus[]) gains[bus] = 0;
  const blinkCue = current?.event.blink && frame
    ? ({ 'blink:cue': 'BLINK', 'blink:long_close': 'CLOSE', 'blink:reopen': 'OPEN' } as Record<string, string>)[frame.label]
    : undefined;
  const recipe = target.motifMotion;
  const scanner = recipe && atMs >= recipe.startMs && values.motif > 0 && target.visualState !== 'sparse' && target.visualState !== 'black'
    ? { rotationY: Math.sin((atMs - recipe.startMs) / recipe.periodMs * Math.PI * 2) * 72,
        offset: Math.cos((atMs - recipe.startMs) / recipe.periodMs * Math.PI * 2) * 32,
        opacity: recipe.strength * values.motif * unit((atMs - recipe.startMs) / 1200) }
    : undefined;
  return { gains, ...values, blurPx, zoom, authoredText: text, blinkCue, scanner, transition, progress: p };
}
