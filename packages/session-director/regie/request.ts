// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { EventSpeechRequestSchema } from '../events/speech';
import { PresentationStateSchema } from '../events/contract';
import { PlanningContextSchema } from './plan';

export const SceneRequestSchema=EventSpeechRequestSchema.omit({event:true,payloadId:true,allowedTriggers:true,motif:true,precedingNarration:true,presentationPreferences:true,experimentProfile:true}).extend({
  planningContext:PlanningContextSchema,
  atMs:z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),durationMs:z.number().finite().min(1000).max(86400000),
  continuous:z.boolean().default(false),baseline:PresentationStateSchema,
}).strict();
export type SceneRequest=z.infer<typeof SceneRequestSchema>;
