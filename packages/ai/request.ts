// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { modelContext, nativeSamplingModels, communityQwen } from './models';
import { SessionStateSchema } from './session-state';
import { NATIVE_CONTEXT } from '../../config/sampling';
import {LocalContextRequestSchema} from './local-context';
import {conversationTopics} from '../content/conversation';

export const PROTOCOL_VERSION = 1;
export const audioPresetSchema = z.enum(['bambi_local_clean', 'bambi_classic', 'bambi_classic_deep', 'bambi_voice_test']);
export const ReplyIntentSchema = z.enum(['conversation', 'narration', 'continuation', 'clarification']);
export type ReplyIntent = z.infer<typeof ReplyIntentSchema>;
export interface ModelConnection { backend: 'ollama' | 'llama.cpp' | 'cloud'; context: number }
export const InteractionSchema=z.enum(['reactive','situational']);
export type Interaction=z.infer<typeof InteractionSchema>;
export const ChatRequestSchema = z.object({
  type: z.literal('chat'), protocolVersion: z.literal(PROTOCOL_VERSION).optional(),
  requestId: z.string().uuid().optional(),
  interaction:InteractionSchema.default('reactive'),source:z.enum(['user','engine']).default('user'),
  conversationTopic:z.enum(conversationTopics).default('general'),
  intent: ReplyIntentSchema.optional(), sampling: z.enum(['qwen', 'creative']).default('qwen'),
  playbackBuffer:z.boolean().optional(),
  sceneHeardText:z.string().max(6000).optional(),
  dualVoice:z.boolean().default(false),
  // Compatibility flags for older clients; language freedom is unconditional.
  nsfw:z.boolean().default(false), rawRoleplay:z.boolean().default(false),
  adaptiveDelivery: z.boolean().default(false),
  adaptiveVisuals: z.boolean().default(false),
  soundDesign: z.boolean().default(false), dialogue: z.boolean().default(true),
  text: z.string().trim().min(1).max(4000), model: z.string().min(1).max(100).default(communityQwen),
  backend: z.enum(['ollama', 'llama.cpp', 'cloud']).optional(),
  voice: z.string().regex(/^[a-z0-9_+():. -]{1,150}$/).default('bambi_classic'),
  preset: audioPresetSchema.default('bambi_local_clean'), speed: z.number().min(.5).max(1.5).default(.78),
  speak: z.boolean().default(true), persona: z.string().max(500).default('Soft, playful, dreamy and affectionate'),
  promptId: z.enum(['bambisleep-classic', 'gentle-induction', 'english-conversation', 'bambi-companion', 'custom']).default('bambisleep-classic'),
  narrationStyle:z.string().max(300).optional(),
  username: z.string().max(50).default('Bambi'), selectedTriggers: z.array(z.string().max(100)).max(100).default([]),
  collar: z.boolean().default(false), collarName: z.string().max(4000).default(''),
  context: z.number().int().min(2048).max(131072).default(NATIVE_CONTEXT),
  maxTokens: z.number().int().min(64).max(8192).default(2048), session: SessionStateSchema.optional(),
  inputTiming:z.object({speechEndToRequestMs:z.number().finite().min(0).max(120000),sttMs:z.number().finite().min(0).max(120000)}).strict().optional(),
  localContext:LocalContextRequestSchema.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export function modelConnection(model: string, promptId: string, connections: Record<string, ModelConnection> = {}): ModelConnection {
  return connections[model] ?? { backend: nativeSamplingModels.includes(model) ? 'llama.cpp' : 'ollama', context: modelContext(model, promptId) };
}
/** Both clients send the same explicit defaults; server configuration is authoritative. */
export function buildChatRequest(input: z.input<typeof ChatRequestSchema>, connections: Record<string, ModelConnection> = {}): ChatRequest {
  const connection = modelConnection(input.model ?? communityQwen, input.promptId ?? 'bambisleep-classic', connections);
  const intent = input.intent ?? (input.dialogue === false ? 'narration' : 'conversation');
  return ChatRequestSchema.parse({ ...input, ...connection, protocolVersion: PROTOCOL_VERSION, intent,
    dialogue: intent !== 'narration', soundDesign: intent === 'narration' && input.soundDesign === true });
}
