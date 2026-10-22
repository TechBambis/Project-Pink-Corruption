// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {SamplingProfile} from '../../config/sampling';
export interface Message { role:'system'|'user'|'assistant'; content:string }
export interface StructuredOptions { maxTokens?:number; temperature?:number }
export interface LLMBackend { name:string; supportsPrefill?:boolean; supportsTurnGrammar?:boolean; models():Promise<string[]>; countTokens?(messages:Message[],signal:AbortSignal):Promise<number>; structured?(messages:Message[],model:string,signal:AbortSignal,context:number,schema:unknown,options?:StructuredOptions):Promise<unknown>; stream(messages:Message[],model:string,signal:AbortSignal,context?:number,maxTokens?:number,sampling?:SamplingProfile,grammar?:string):AsyncGenerator<{text:string;stats?:unknown}> }
