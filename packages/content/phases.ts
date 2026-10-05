// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { appendSessionState, type SessionState } from '../ai/session-state';
import {triggerTimingDirection} from '../session-director/trigger-timing';

const guidance = z.string().trim().min(1).max(4000);
export const PhaseConfigSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  phases: z.object({
    induction: guidance, deepening: guidance, conditioning: guidance,
    anchor: guidance, awakening: guidance,
  }).strict(),
  intensity_overrides: z.object({
    '1': guidance, '2': guidance, '3': guidance, '4': guidance, '5': guidance,
  }).strict(),
}).strict();

// Local author configuration; reload by restarting the application server.
// Separately edited bambisleep-phases*.json files are retained but not loaded here.
export const phaseConfig = PhaseConfigSchema.parse(JSON.parse(readFileSync(
  new URL('./session-phases-neutral.json', import.meta.url), 'utf8',
)));

export function appendPhasePrompt(basePrompt: string, session?: SessionState): string {
  if (!session) return basePrompt;
  const intensity = String(session.intensity) as keyof typeof phaseConfig.intensity_overrides;
  return [
    appendSessionState(basePrompt, session),
    phaseConfig.phases[session.phase],
    phaseConfig.intensity_overrides[intensity],
    session.triggerTiming ? triggerTimingDirection(session.phase,session.phaseProgress,session.triggerTiming) : '',
  ].filter(Boolean).join('\n\n');
}
