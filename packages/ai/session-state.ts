// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { clamp, sceneNames } from '../safety/actions';

import { sessionPhases, sessionPhaseAt } from '../session-director/phases';
import {TriggerTimingSchema} from '../session-director/trigger-timing';
export { sessionPhases } from '../session-director/phases';
export const SessionStateSchema = z.object({
  phase: z.enum(sessionPhases),
  phaseProgress: z.number().finite().min(0).max(100),
  scene: z.enum(sceneNames),
  intensity: z.number().int().min(1).max(5),
  intensityPercent: z.number().finite().min(0).max(100),
  deliveryIntensityPercent: z.number().finite().min(0).max(100).optional(),
  elapsedMin: z.number().finite().min(0).max(1440),
  totalMin: z.number().finite().gt(0).max(1440),
  activeTriggers: z.array(z.string().max(100)).max(100),
  lastTrigger: z.string().max(100).nullable(),
  triggerTiming: TriggerTimingSchema.optional(),
}).strict();
export type SessionState = z.infer<typeof SessionStateSchema>;

export function snapshotSession(input: {
  elapsedSeconds: number; totalSeconds: number; scene: SessionState['scene'];
  intensityPercent: number; activeTriggers: string[]; lastTrigger: string | null;
}): SessionState {
  const total = clamp(input.totalSeconds, 1, 86400);
  const elapsed = clamp(input.elapsedSeconds, 0, 86400);
  const current = sessionPhaseAt(elapsed, total);
  const intensityPercent = clamp(input.intensityPercent, 0, 100);
  return {
    phase: current.phase,
    phaseProgress: Math.round(current.progress * 1000) / 10,
    scene: input.scene,
    intensity: Math.max(1, Math.ceil(intensityPercent / 20)),
    intensityPercent,
    elapsedMin: Math.round(elapsed / 60 * 100) / 100,
    totalMin: total / 60,
    activeTriggers: [...input.activeTriggers],
    lastTrigger: input.lastTrigger,
  };
}

export function buildSessionState(session: SessionState): string {
  return `SESSION STATE (read-only metadata for the current response; use these current values, because conversation history may describe an earlier phase or intensity):
- Phase: ${session.phase}
- Phase progress: ${session.phaseProgress}%
- Scene: ${JSON.stringify(session.scene)}
- Intensity: ${session.intensity}/5 (${session.intensityPercent}/100 in the UI)${session.deliveryIntensityPercent===undefined?'':`\n- Current audiovisual envelope: ${session.deliveryIntensityPercent}%; this is separate from the selected language intensity.`}
- Elapsed: ${session.elapsedMin} min / ${session.totalMin} min planned
- Active triggers: ${JSON.stringify(session.activeTriggers)}
- Last trigger detected: ${session.lastTrigger === null ? 'none' : JSON.stringify(session.lastTrigger)}`;
}

export function appendSessionState(prompt: string, session?: SessionState): string {
  return session ? prompt + '\n\n' + buildSessionState(session) : prompt;
}
