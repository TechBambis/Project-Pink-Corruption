// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
export const sceneNames = ['Spiral Focus', 'Deep Tunnel', 'Soft Pink', 'Particle Drift', 'Minimal Dark', 'Text Focus', 'Audio Only'] as const;
export const SPIRAL_COMPLEXITY_MAX = 1.5;
export const SpiralSettingsSchema = z.object({
 speed:z.number().finite().min(.01).max(5).optional(), complexity:z.number().finite().min(.1).max(3).transform(n=>Math.min(SPIRAL_COMPLEXITY_MAX,n)).optional(),
 alpha:z.number().finite().min(.01).max(1).optional(), colorA:z.string().regex(/^#[\da-f]{6}$/i).optional(), colorB:z.string().regex(/^#[\da-f]{6}$/i).optional(),
 mode:z.enum(['classic','breathe','drift','colorCycle','strobe']).optional(),
 pulseHz:z.number().finite().min(.1).max(2).optional(),
 style:z.enum(['original','vortex','infinity','prism','orb','tunnel','loop','fractal']).optional(), depth:z.number().finite().min(0).max(1).optional(),
}).strict();
export const SceneActionSchema = z.object({type:z.literal('scene'),scene:z.enum(sceneNames),opacity:z.number().finite().min(0).max(1).optional(),spiral:SpiralSettingsSchema.optional(),fade:z.boolean().optional()}).strict();
export const ActionSchema = z.discriminatedUnion('type', [
 z.object({type:z.literal('visual'), effect:z.enum(['pulse','spiral','particles']),intensity:z.number().finite().transform(n=>clamp(n)),durationMs:z.number().finite().transform(n=>clamp(n,100,10000))}).strict(),
 SceneActionSchema,
 z.object({type:z.literal('silence'),durationMs:z.number().finite().transform(n=>clamp(n,100,10000))}).strict(),
 z.object({type:z.literal('ambient'),level:z.number().finite().transform(n=>clamp(n,0,.5))}).strict()
]);
export type AIAction = z.infer<typeof ActionSchema>;
