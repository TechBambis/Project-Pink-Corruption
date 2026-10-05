// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { clamp, SceneActionSchema } from '../safety/actions';
import { sessionPhaseAt, type SessionPhase } from '../session-director/phases';
import type { TimelineEvent } from '../timeline';
import type { StableSpiralSettings } from './stable';
import type { Scene } from './index';

export interface VisualPresentation { scene: Scene; opacity: number; spiral: StableSpiralSettings }
const pink = '#df0471', teal = '#008080';
export const phaseVisuals: Record<SessionPhase, { scene: Scene; opacity: number; spiral: Partial<StableSpiralSettings> }> = {
  induction: { scene: 'Soft Pink', opacity: .6, spiral: { mode: 'breathe', speed: .3, alpha: .6, colorA: pink, colorB: teal } },
  deepening: { scene: 'Deep Tunnel', opacity: .4, spiral: { mode: 'drift', speed: .5, alpha: .4, colorA: pink, colorB: '#240c3b' } },
  conditioning: { scene: 'Minimal Dark', opacity: .3, spiral: { mode: 'classic', speed: .2, alpha: .3, colorA: pink, colorB: '#000000' } },
  anchor: { scene: 'Spiral Focus', opacity: .25, spiral: { mode: 'strobe', speed: .15, alpha: .25, colorA: pink, colorB: '#000000', pulseHz: .7 } },
  awakening: { scene: 'Soft Pink', opacity: .6, spiral: { mode: 'breathe', speed: .3, alpha: .6, colorA: pink, colorB: teal } },
};

export function mergePresentation(base: VisualPresentation, action: { scene: Scene; opacity?: number; spiral?: Partial<StableSpiralSettings> }): VisualPresentation {
  return { scene: action.scene, opacity: action.opacity ?? base.opacity, spiral: { ...base.spiral, ...action.spiral } };
}

export function choreographyAt(time: number, duration: number, base: VisualPresentation): VisualPresentation {
  const current = sessionPhaseAt(time, duration);
  const result = mergePresentation(base, phaseVisuals[current.phase]);
  if (current.phase === 'awakening') {
    // Pink fades during awakening; the final fifth of that phase is audio only.
    const fade = clamp(current.progress / .8);
    result.opacity = .6 * (1 - fade) + .1 * fade;
    if (current.progress + 1e-9 >= .8) result.scene = 'Audio Only';
  }
  return result;
}

/** A visually dense journey stays in layered scenes through the main session. */
export function immersiveChoreographyAt(time: number, duration: number, base: VisualPresentation): VisualPresentation {
  const current = sessionPhaseAt(time, duration);
  const styles = { induction: 'tunnel', deepening: 'vortex', conditioning: 'fractal', anchor: 'loop', awakening: 'orb' } as const;
  const speed = { induction: .3, deepening: .48, conditioning: .55, anchor: .35, awakening: .25 }[current.phase];
  const result = mergePresentation(base, { scene: 'Spiral Focus', opacity: base.opacity, spiral: {
    style: styles[current.phase], mode: 'breathe', speed, alpha: 1, colorA: '#f52c9e', colorB: '#ffe1f7',
  } });
  if (current.phase === 'awakening') {
    result.opacity *= 1 - clamp(current.progress / .8);
    if (current.progress + 1e-9 >= .8) result.scene = 'Audio Only';
  }
  return result;
}

/** Replay only persistent scene settings. Never replay transient flashes/sounds on a seek. */
export function timelinePresentationAt(events: TimelineEvent[], position: number, base: VisualPresentation): VisualPresentation {
  let result = { ...base, spiral: { ...base.spiral } };
  let previousTime = 0;
  for (const event of events) {
    if (event.type !== 'scene') continue;
    const action = SceneActionSchema.parse(event.data);
    if (event.time > position) {
      if (action.fade && action.opacity !== undefined && event.time > previousTime) result.opacity += (action.opacity - result.opacity) * clamp((position - previousTime) / (event.time - previousTime));
      break;
    }
    result = mergePresentation(result, action);
    previousTime = event.time;
  }
  return result;
}
