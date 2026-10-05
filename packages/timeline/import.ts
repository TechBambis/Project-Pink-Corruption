// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { ActionSchema, sceneNames } from '../safety/actions';
import type { TimelineEvent } from './index';
import { phaseStarts, sessionPhases } from '../session-director/phases';

const sceneAliases = Object.fromEntries(sceneNames.map(name => [name.toLowerCase().replaceAll(' ', '_'), name]));
const modes: Record<string, string> = { strobe_pulse: 'strobe', color_cycle: 'colorCycle' };
const entrySchema = z.object({
 time: z.number().finite().min(0).optional(), progress:z.number().finite().min(0).max(1).optional(),
 phase:z.enum(sessionPhases).optional(), phaseProgress:z.number().finite().min(0).max(1).optional(),
}).passthrough().refine(entry => [entry.time, entry.progress, entry.phase].filter(value => value !== undefined).length === 1 && (entry.phaseProgress === undefined || entry.phase !== undefined), 'Use exactly one of time, progress or phase; phaseProgress belongs to phase.');
const captionSchema = z.object({ type: z.literal('caption'), text: z.string().max(1000), duration: z.number().finite().min(.1).max(60) }).strict();

/** Accept both the existing action format and the user's concise scene format. */
export function parseTimelineJSON(source: string, duration: number): TimelineEvent[] {
  z.number().finite().gt(0).max(86400).parse(duration);
  return z.array(entrySchema).max(10000).parse(JSON.parse(source)).map(entry => {
    const { time: seconds, progress, phase, phaseProgress, id: _id, duration: eventDuration, action, ...fields } = entry;
    const phaseIndex = phase === undefined ? 0 : sessionPhases.indexOf(phase);
    const time = seconds ?? (progress ?? (phaseStarts[phaseIndex] + (phaseProgress ?? 0) * ((phaseStarts[phaseIndex + 1] ?? 1) - phaseStarts[phaseIndex]))) * duration;
    const identifier = crypto.randomUUID();
    const basis = seconds === undefined ? { relativeTo: 'session' as const } : {};
    if (fields.type === 'caption') {
      const data = captionSchema.parse({ type: 'caption', text: fields.text ?? (fields.data as { text?: unknown } | undefined)?.text ?? '', duration: eventDuration ?? 4 });
      return { id: identifier, time, ...basis, type: 'caption', duration: data.duration, data: { text: data.text } };
    }
    const raw = z.record(z.unknown()).parse(action ?? fields);
    const normalized = { ...raw };
    if (typeof normalized.scene === 'string') {
      normalized.type ??= 'scene';
      normalized.scene = sceneAliases[normalized.scene] ?? normalized.scene;
    }
    if (normalized.spiral !== undefined) {
      const spiral = z.record(z.unknown()).parse(normalized.spiral);
      if (typeof spiral.mode === 'string') spiral.mode = modes[spiral.mode] ?? spiral.mode;
      normalized.spiral = spiral;
    }
    if (normalized.type === 'visual' && normalized.durationMs === undefined) normalized.durationMs = Number(eventDuration ?? 1) * 1000;
    const parsed = ActionSchema.parse(normalized);
    return { id: identifier, time, ...basis, type: parsed.type, data: parsed };
  }).sort((a,b)=>a.time-b.time);
}
