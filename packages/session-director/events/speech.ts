// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { wipeNarrationFacts } from './presentation';
import { ChatRequestSchema } from '../../ai/request';
import { EventSchema, MotifSchema, type BambiEvent, type PresentationState } from './contract';
import { compileEvent, speechInstruction } from './runtime';
import { giggleOffset } from '../../audio/giggle';
import { pinkWordOffsets } from '../../visuals/spoken-cues';
import {implicitTriggerNames} from '../../../config/trigger-sequence';
import {validateSpokenText} from '../../speech/contract';

// Older event clients supplied only persona text; retain that custom-character default.
export const EventSpeechRequestSchema = ChatRequestSchema.pick({ model: true, voice: true, speed: true, preset: true, sampling: true, context: true, persona: true, username: true, selectedTriggers: true, collar: true, collarName: true, nsfw: true, rawRoleplay: true, localContext: true }).extend({ promptId: ChatRequestSchema.shape.promptId.default('custom'), narrationStyle: z.string().max(300).optional(), event: EventSchema, payloadId: z.string().min(1).max(160), requestId: z.string().min(1).max(160).optional(), experimentProfile: z.literal('next-gen-ab').optional(), allowedTriggers: z.array(z.string().max(100)).max(100), motif: MotifSchema.optional(), precedingNarration: z.string().max(1200).optional(), presentationPreferences: z.object({ visualsEnabled: z.boolean(), reducedMotion: z.boolean(), effectsEnabled: z.boolean().optional() }).strict().optional() }).strict();
export type EventSpeechRequest = z.infer<typeof EventSpeechRequestSchema>;
export interface RenderedEventSpeech { payloadId: string; requestId?: string; text: string; audio: string; durationMs: number; targetMs: number; textAttempts: number; triggerOffsetMs?: number; cueOffsetMs?: number; giggleOffsetMs?: number; pinkOffsetsMs?: number[]; words?: { word: string; atMs: number; endMs?: number }[] }
export class SpeechWindowError extends Error {
  readonly wordsPerMs: number;
  constructor(readonly durationMs: number, readonly targetMs: number, words: number) {
    super(`Rendered speech ${Math.round(durationMs)} ms exceeds its ${targetMs} ms window`);
    this.wordsPerMs = words / durationMs;
  }
}

/** Native decoding bounds plain English words; actual spoken duration remains a WAV check. */
export function eventTextGrammar(words: number, exactPhrase?: string, forbiddenWords: string[] = []) {
  if (!Number.isInteger(words) || words < 1 || words > 500) throw Error('Invalid event word budget');
  if (exactPhrase !== undefined) {
    if (!exactPhrase.trim() || /[\r\n\[\]<>]/.test(exactPhrase) || exactPhrase.trim().split(/\s+/).length > words) throw Error('Invalid exact event phrase');
    return `root ::= ${JSON.stringify(exactPhrase)} [.!?]?`;
  }
  const blocked = [...new Set(implicitTriggerNames(forbiddenWords).filter(w=>/^[A-Za-z]+$/.test(w)).map(w=>w.toLowerCase()))];
  if (!blocked.length) return `root ::= word (" " word){0,${words - 1}}\nword ::= [A-Za-z0-9] [A-Za-z0-9'.,!?;:\\-]*`;
  const rules: string[] = [], alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let serial=0;
  const branch=(prefix:string):string=>{
    const name=`prefix${serial++}`, next=[...new Set(blocked.filter(w=>w.startsWith(prefix)&&w.length>prefix.length).map(w=>w[prefix.length]))];
    const allowed=[...alphabet].filter(c=>!next.includes(c.toLowerCase())).join('');
    const alternatives = prefix && !blocked.includes(prefix) ? ['""'] : [];
    alternatives.push(`[${allowed}] tail`);
    if(prefix&&!blocked.includes(prefix))alternatives.push('"\'" tail','"-" tail');
    for(const c of next)alternatives.push(`[${c}${c.toUpperCase()}] ${branch(prefix+c)}`);
    rules.push(`${name} ::= ${alternatives.join(' | ')}`);return name;
  };
  const start=branch('');
  return `root ::= word (" " word){0,${words - 1}}\nword ::= ${start} [.,!?;:]?\ntail ::= [A-Za-z0-9'\\-]*\n${rules.join('\n')}`;
}

export function joinWav(parts: Uint8Array[]) {
  if (!parts.length) throw Error('No rendered speech');
  let format: Uint8Array | undefined; const data: Uint8Array[] = [];
  for (const part of parts) {
    wavDurationMs(part); const view = new DataView(part.buffer, part.byteOffset, part.byteLength);
    for (let at = 12; at + 8 <= part.length;) {
      const size = view.getUint32(at + 4, true), tag = String.fromCharCode(...part.subarray(at, at + 4));
      if (tag === 'fmt ') { const candidate = part.slice(at + 8, at + 8 + size); if (format && (format.length !== candidate.length || format.some((n, i) => n !== candidate[i]))) throw Error('Speech WAV formats differ'); format = candidate; }
      if (tag === 'data') data.push(part.subarray(at + 8, at + 8 + size)); at += 8 + size + size % 2;
    }
  }
  if (!format) throw Error('Missing speech format');
  const dataSize = data.reduce((n, bytes) => n + bytes.length, 0), fmtSize = format.length + format.length % 2;
  const out = new Uint8Array(12 + 8 + fmtSize + 8 + dataSize + dataSize % 2), view = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, out.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt '); view.setUint32(16, format.length, true); out.set(format, 20);
  const at = 20 + fmtSize; tag(at, 'data'); view.setUint32(at + 4, dataSize, true); let cursor = at + 8; for (const bytes of data) { out.set(bytes, cursor); cursor += bytes.length; }
  return out;
}

/** PCM/IEEE-float RIFF duration; no trust in a model's claimed spoken duration. */
export function wavDurationMs(bytes: Uint8Array) {
  if (bytes.length < 44 || bytes.length > 32000000) throw Error('Invalid rendered WAV');
  const text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw Error('Expected PCM WAV');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let byteRate = 0, data = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const length = view.getUint32(at + 4, true); if (at + 8 + length > bytes.length) throw Error('Truncated WAV');
    if (text(at, 4) === 'fmt ' && length >= 16) { const format = view.getUint16(at + 8, true); if (![1, 3, 65534].includes(format)) throw Error('Unsupported WAV encoding'); byteRate = view.getUint32(at + 16, true); }
    if (text(at, 4) === 'data') data += length;
    at += 8 + length + length % 2;
  }
  const duration = data / byteRate * 1000; if (!Number.isFinite(duration) || duration <= 0) throw Error('Missing WAV audio'); return duration;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function validateEventText(text: string, event: BambiEvent, required?: string, forbidden: string[] = []) {
  validateSpokenText(text,{narration:true,speaker:event.state.foreground==='left_voice'?'bambi':'owner'});
  if (!text.trim() || text.length > 6000 || /[\[\]<>]|```/.test(text)) throw Error('Event narration must contain plain original text only');
  if (required) {
    const matches = text.match(new RegExp(`\\b${escape(required)}\\b`, 'gi')) ?? [];
    if (matches.length !== 1 || !new RegExp(`${escape(required)}[.!?\\s]*$`, 'i').test(text)) throw Error('Required trigger must occur once in the final clause');
  }
  // Catalog entries may nest: the planned "Bambi Sleep" also contains "Bambi".
  // Only occurrences contained in the exact scheduled phrase are authorized.
  const planned = required ? [...text.matchAll(new RegExp(`\\b${escape(required)}\\b`, 'gi'))].map(m => ({ start: m.index!, end: m.index! + m[0].length })) : [];
  for (const phrase of implicitTriggerNames(forbidden)) {
    if (phrase.toLowerCase() === required?.toLowerCase()) continue;
    const unplanned = [...text.matchAll(new RegExp(`\\b${escape(phrase)}\\b`, 'gi'))].some(m =>
      !planned.some(span => m.index! >= span.start && m.index! + m[0].length <= span.end));
    if (unplanned) throw Error(`Unscheduled trigger in event text: ${JSON.stringify(phrase)}`);
  }
  if (event.type === 'original_self' && /operating system|reboot|bootloader|loading module/i.test(text)) throw Error('Original Self is a narrative perspective');
  return text.trim();
}

/** Screen claims are bounded to engine facts; this is a conservative check, not full semantic parsing. */
export function validatePresentationText(text: string, state: PresentationState, scan: boolean, visible: boolean) {
  const motionClaim = /\b(?:the|this|that)\s+(?:pink\s+|glowing\s+|soft\s+)*(?:light|ring|orb|circle|reflection|scanner|heart|gears?)\s+(?:(?:is|are|now|starts|begins)\s+)*(?:puls\w*|rotat\w*|turn\w*|mov\w*|sweep\w*|scann\w*)\b/i;
  if (motionClaim.test(text) && (!scan || !visible)) throw Error('Unscheduled visible ring movement in narration');
  if (!visible && /\b(?:look at|watch|see)\s+(?:the|this)\s+(?:pink\s+|glowing\s+)*(?:ring|orb|circle|light|heart|gears?)\b/i.test(text)) throw Error('Narration describes a visible motif during a dark/visual-off window');
  if (!state.activeLayers.includes('transition_sfx') && /\b(?:hear|listen to)\s+(?:the|this|a)\s+(?:snap|click|bell|beep|impact)\b/i.test(text)) throw Error('Unscheduled sound effect in narration');
}

export async function renderEventSpeech(raw: EventSpeechRequest, dependencies: {
  generate: (instruction: string, signal: AbortSignal, words: number, exactPhrase?: string) => Promise<string>;
  render: (text: string, signal: AbortSignal) => Promise<{ bytes: Uint8Array; words?: { word: string; atMs: number; endMs?: number }[] }>;
  knownTriggers: string[];
}, signal: AbortSignal): Promise<RenderedEventSpeech> {
  const request = EventSpeechRequestSchema.parse(raw), compiled = compileEvent(request.event), slot = compiled.speech.find(s => s.payloadId === request.payloadId);
  if (!slot || slot.speech.mode === 'silent') throw Error('No LLM generation belongs to this window');
  if (slot.speech.requiredTrigger && !request.allowedTriggers.includes(slot.speech.requiredTrigger)) throw Error('Trigger is not eligible for this authored event');
  signal.throwIfAborted();
  if (slot.speech.fixedText) {
    const text = validateEventText(slot.speech.fixedText, request.event), { bytes, words } = await dependencies.render(text, signal);
    signal.throwIfAborted();
    const durationMs = wavDurationMs(bytes);
    if (durationMs > slot.speech.targetMs + 1) throw new SpeechWindowError(durationMs, slot.speech.targetMs, text.split(/\s+/).length);
    return { payloadId: slot.payloadId, text, audio: Buffer.from(bytes).toString('base64'), durationMs, targetMs: slot.speech.targetMs, textAttempts: 0, words };
  }
  if (slot.speech.fixedCue) {
    // One original engine-owned command is rendered once, then reused at every authored cue.
    const text=slot.speech.fixedCue, {bytes,words:timed}=await dependencies.render(text,signal);signal.throwIfAborted();
    const durationMs=wavDurationMs(bytes), matches=(timed??[]).filter(w=>w.word.replace(/[^a-z]/gi,'').toLowerCase()===text.toLowerCase());
    const cueOffsetMs=matches[0]?.atMs, startOffset=slot.speech.cueAtMs!-cueOffsetMs;
    if(matches.length!==1||!Number.isFinite(cueOffsetMs)||cueOffsetMs<0||cueOffsetMs>=durationMs)throw Error('Eye cue requires one measured word timing');
    if(startOffset<0||startOffset+durationMs>slot.speech.targetMs+1)throw Error('Eye cue audio does not fit its fixed engine firing time');
    return {payloadId:slot.payloadId,text,audio:Buffer.from(bytes).toString('base64'),durationMs,targetMs:slot.speech.targetMs,textAttempts:0,cueOffsetMs,words:timed};
  }
  const requiredWords = slot.speech.requiredTrigger?.trim().split(/\s+/).length ?? 0;
  // A short cue window has little room before its fixed firing time. Generate the cue alone.
  const cueOnly = requiredWords > 0 && slot.speech.targetMs <= 4000;
  const words = cueOnly ? requiredWords : Math.max(requiredWords, slot.speech.wordTarget ?? Math.max(1, Math.floor(slot.speech.targetMs / 1000 * 1.7)));
  if (request.motif && request.motif.id !== (request.event.motifId ?? request.event.baseline.motifId)) throw Error('Motif identity does not match engine state');
  const motif = request.motif ? { ...request.motif, lastUsedAtMs: null, useCount: 0 } : undefined;
  const frame = compiled.frames.filter(f => f.atMs <= slot.atMs).at(-1);
  const state = frame?.state ?? request.event.state, preferences = request.presentationPreferences;
  const visible = preferences?.visualsEnabled !== false && state.visualState !== 'black';
  const form = state.motifForm ?? 'ring';
  const scan = visible && !preferences?.reducedMotion && state.visualState !== 'sparse' && state.activeLayers.includes('motif_visual')
    && (form !== 'ring' || !!state.motifMotion && slot.atMs >= state.motifMotion.startMs);
  const object = form === 'ring' ? 'pink ring' : form === 'heart' ? 'pink heart' : 'linked pink gears';
  const movement = form === 'ring' ? 'contains a slow, soft moving light reflection' : form === 'heart' ? 'turns gently from side to side' : 'turn around a central spiral';
  const screenFacts = !visible ? 'The screen is dark or visuals are disabled. Do not describe visible objects or movement.' : state.activeLayers.includes('motif_visual')
    ? scan ? `The ${object} ${movement}. You may describe this present movement.` : `The ${object} stays steady. Do not describe it pulsing, rotating, scanning or moving.`
    : 'Use only the engine-supplied visible scene.';
  const presentationContract = `\nPRESENTATION CONTRACT: ${screenFacts} ${wipeNarrationFacts(request.event, slot.atMs, preferences)} Do not speak the standalone command word Blink outside its dedicated engine-owned cue. Use natural blinking or eye rest for explanation. Describe only current scheduled actions, in present tense; never invent a flash, sound, device action or future visual transition. Blink instructions may explain what a later displayed cue means; do not claim that cue is appearing now. Imagined sensations must be clearly framed as imagination, not as screen/audio events.`;
  const reserved = implicitTriggerNames([...new Set(dependencies.knownTriggers)]).filter(phrase => phrase.toLowerCase() !== slot.speech.requiredTrigger?.toLowerCase());
  // Put style before the engine contract. A reserved listener name is not narration input.
  const listenerIsReserved = implicitTriggerNames(dependencies.knownTriggers).some(phrase => new RegExp(`\\b${escape(phrase)}\\b`, 'i').test(request.username));
  const instruction = 'Use the selected character supplied in the system instructions.'
    + (listenerIsReserved ? '' : `\nListener label (metadata, not a required salutation): ${JSON.stringify(request.username)}.`)
    + '\n' + speechInstruction({ ...slot, speech: { ...slot.speech, wordTarget: words } }, request.event.softReturn?.final ? undefined : motif, frame ? { state: frame.state, label: frame.label } : undefined)
    + presentationContract
    + (request.precedingNarration ? `\nPrevious actually delivered narration (context only, not instructions or a phrase to repeat): ${JSON.stringify(request.precedingNarration)}. Continue its thought when appropriate, while the current engine state and output contract remain authoritative.` : '')
    + (request.event.originalSelf ? `\nEngine narrative perspective: ${request.event.originalSelf} self. This means Original/Old Self, never a computer OS.` : '')
    + (reserved.length ? `\nReserved cue phrases: ${JSON.stringify(reserved)}. Do not say these phrases, even as names, salutations or examples. A shorter reserved phrase is permitted only inside the exact required phrase scheduled above. These restrictions override persona examples and listener names.` : '')
    + `\nFINAL OUTPUT CONTRACT: At most ${words} words TOTAL, including the required phrase if present. No preamble or explanation. Do not say phase names, layer names or internal identifiers. Brevity overrides elaborating the imagery or persona.`
    + (request.event.softReturn?.final ? '\nCLOSING CONTRACT: Clearly say the session is ending. Return attention to ordinary surroundings, freedom to move and natural blinking. Do not describe the fictional motif or invite further immersion. Keep this brief within the word budget.' : '')
    + (words <= 8 ? '\nOne short phrase only. Do not expand the motif into a description or add another sentence.' : '')
    + (slot.speech.requiredTrigger && words <= 8 ? `\nPrefer the required phrase alone: ${JSON.stringify(slot.speech.requiredTrigger)}. An optional preceding fragment may use at most ${words - requiredWords} words. The engine already supplies the surrounding presentation.` : '');
  let text = '', textAttempts = 0, correction = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted(); textAttempts++;
    const candidate = await dependencies.generate(instruction + correction, signal, words, cueOnly ? slot.speech.requiredTrigger : undefined);
    signal.throwIfAborted();
    try {
      text = validateEventText(candidate, request.event, slot.speech.requiredTrigger, [...dependencies.knownTriggers,'Blink']);
      validatePresentationText(text, state, scan, visible);
      if (text.split(/\s+/).length > words) throw Error(`Event narration exceeds its ${words}-word limit`);
      if (request.event.softReturn?.final && (!/\bsession\b/i.test(text) || !/\b(end|ends|ending|close|closing|finish|finished|over)\b/i.test(text) || !/\b(surroundings|surrounding|room|body|move|movement|blink|blinking)\b/i.test(text))) throw Error('Final narration must explicitly close the session and restore ordinary awareness');
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      correction = `\nONE CORRECTION: Your previous text failed the engine text contract (${error instanceof Error ? error.message : String(error)}). Write a shorter compliant replacement. Address only "you", not a named person. Do not mention phase names or technical identifiers. This is still one spoken payload; only a validated replacement will be rendered.`;
      if (cueOnly) correction += `\nOutput exactly this phrase and nothing else: ${JSON.stringify(slot.speech.requiredTrigger)}.`;
    }
  }
  signal.throwIfAborted();
  const { bytes, words: timedWords } = await dependencies.render(text, signal); signal.throwIfAborted();
  const durationMs = wavDurationMs(bytes);
  if (durationMs > slot.speech.targetMs + 1) throw new SpeechWindowError(durationMs, slot.speech.targetMs, text.split(/\s+/).length);
  let triggerOffsetMs: number | undefined;
  if (slot.speech.requiredTrigger) {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ''), target = slot.speech.requiredTrigger.split(/\s+/).map(normalize), words = timedWords ?? [];
    const matches = words.flatMap((word, i) => target.every((token, j) => normalize(words[i + j]?.word ?? '') === token) ? [word.atMs] : []);
    if (matches.length !== 1 || !Number.isFinite(matches[0]) || matches[0] < 0 || matches[0] >= durationMs) throw Error('Trigger payload requires one measured word-timed cue');
    triggerOffsetMs = matches[0];
    const startOffset = slot.speech.triggerAtMs! - triggerOffsetMs;
    if (startOffset < 0 || startOffset + durationMs > slot.speech.targetMs + 1) throw Error('Trigger audio does not fit its fixed engine firing time');
  }
  const giggleOffsetMs = giggleOffset(timedWords ?? [],text);
  const pinkOffsetsMs = pinkWordOffsets(timedWords ?? [],durationMs);
  return { payloadId: slot.payloadId, text, audio: Buffer.from(bytes).toString('base64'), durationMs, targetMs: slot.speech.targetMs, textAttempts, words: timedWords, ...(triggerOffsetMs !== undefined ? { triggerOffsetMs } : {}), ...(giggleOffsetMs !== undefined && giggleOffsetMs < durationMs ? { giggleOffsetMs } : {}), ...(pinkOffsetsMs.length ? {pinkOffsetsMs} : {}) };
}
