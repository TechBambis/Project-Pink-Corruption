// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { deliveryModes } from '../delivery';
import { sessionPhases, phaseStarts, type SessionPhase } from '../phases';
import { buses, type Bus } from '../../audio';
import { sceneNames } from '../../safety/actions';
import { DeviceCommandSchema } from '../../devices/commands';

export const layerIds = ['main_voice', 'left_voice', 'right_voice', 'echo_voice', 'mantra_voice', 'drone', 'noise', 'music', 'transition_sfx', 'base_visual', 'motif_visual', 'spiral', 'overlay', 'center_text', 'trigger_text', 'haptics'] as const;
export type LayerId = typeof layerIds[number];
export const contentBuses = buses.filter((bus): bus is Exclude<Bus, 'MASTER' | 'MIC_MONITOR'> => bus !== 'MASTER' && bus !== 'MIC_MONITOR');
const ms = z.number().finite().min(0).max(86400000);
const unit = z.number().finite().min(0).max(1);
const id = z.string().min(1).max(100);
export const DensitySchema = z.object({ intensity: unit, effectDensity: unit, speechDensity: unit, audioDensity: unit, visualDensity: unit }).strict();
export const PresentationStateSchema = z.object({
  activeLayers: z.array(z.enum(layerIds)).max(layerIds.length),
  foreground: z.enum(layerIds).nullable(),
  density: DensitySchema,
  visualState: z.enum(['normal', 'sparse', 'black', 'motif', 'layered']),
  narrationState: z.enum(['speaking', 'paused']),
  ambientState: z.enum(['active', 'reduced', 'silent']),
  scene: z.enum(sceneNames),
  motifId: id.optional(),
  motifForm: z.enum(['ring', 'heart', 'gears']).optional(),
  motifMotion: z.object({ kind: z.literal('coin_scan'), startMs: ms, periodMs: z.number().finite().min(1000).max(30000), strength: unit }).strict().optional(),
}).strict().superRefine((state, ctx) => {
  if (new Set(state.activeLayers).size !== state.activeLayers.length) ctx.addIssue({ code: 'custom', message: 'Active layers must be unique' });
  if (state.foreground && !state.activeLayers.includes(state.foreground)) ctx.addIssue({ code: 'custom', message: 'Foreground must be an active layer' });
  if (state.narrationState === 'paused' && state.activeLayers.some(layer => ['main_voice', 'left_voice', 'right_voice', 'echo_voice', 'mantra_voice'].includes(layer))) ctx.addIssue({ code: 'custom', message: 'Paused narration cannot contain semantic voice layers' });
});
export type PresentationState = z.infer<typeof PresentationStateSchema>;
export const layerCount = (state: PresentationState) => state.activeLayers.length;

export const SpeechSpecSchema = z.object({
  mode: z.enum(['narrate', 'fragment', 'mantra', 'reanchor', 'silent']),
  targetMs: ms,
  wordTarget: z.number().int().min(1).max(500).optional(),
  instruction: z.string().max(2000),
  delivery: z.enum(deliveryModes).optional(),
  fixedCue: z.literal('Blink').optional(),
  fixedText: z.string().min(1).max(300).optional(),
  cueAtMs: ms.optional(),
  requiredTrigger: z.string().min(1).max(100).optional(),
  triggerAtMs: ms.optional(),
  triggerCooldownMs: ms.optional(),
}).strict().superRefine((speech, ctx) => {
  if (!!speech.fixedCue !== (speech.cueAtMs !== undefined) || speech.fixedCue && (speech.mode === 'silent' || speech.requiredTrigger || speech.cueAtMs! >= speech.targetMs)) ctx.addIssue({ code: 'custom', message: 'Fixed cue needs its own spoken window and firing offset' });
  if (speech.mode === 'silent' && (speech.targetMs !== 0 || speech.requiredTrigger || speech.wordTarget || speech.fixedCue)) ctx.addIssue({ code: 'custom', message: 'Silent windows have zero text budget and no spoken trigger' });
  if (speech.fixedText && (speech.mode === 'silent' || speech.fixedCue || speech.requiredTrigger || /[\[\]<>]/.test(speech.fixedText))) ctx.addIssue({ code: 'custom', message: 'Fixed narration must be plain spoken text without a cue' });
  if (speech.mode !== 'silent' && speech.targetMs <= 0) ctx.addIssue({ code: 'custom', message: 'Spoken windows need a positive budget' });
  if (speech.requiredTrigger && (speech.triggerAtMs === undefined || speech.triggerAtMs >= speech.targetMs || speech.triggerCooldownMs === undefined)) ctx.addIssue({ code: 'custom', message: 'Spoken triggers need an engine firing offset and cooldown' });
  if (!speech.requiredTrigger && (speech.triggerAtMs !== undefined || speech.triggerCooldownMs !== undefined)) ctx.addIssue({ code: 'custom', message: 'Trigger timing requires an authored trigger' });
});
export type SpeechSpec = z.infer<typeof SpeechSpecSchema>;
export const TransitionSchema = z.object({
  kind: z.enum(['crossfade', 'hard_cut', 'audio_first', 'visual_first', 'silence_cut', 'blur', 'zoom', 'motif_callback', 'fractionation_switch', 'reset', 'soft_return']),
  durationMs: ms,
  subtitle: z.enum(['clear', 'retain']).default('clear'),
}).strict();
export type Transition = z.infer<typeof TransitionSchema>;
const audioAction = z.object({ offsetMs: ms, bus: z.enum(contentBuses as [typeof contentBuses[number], ...typeof contentBuses[number][]]), gain: unit, durationMs: ms }).strict();
const visualAction = z.object({ offsetMs: ms, opacity: unit.optional(), motion: unit.optional(), blurPx: z.number().finite().min(0).max(20).optional(), zoom: z.number().finite().min(.5).max(2).optional(), text: z.string().max(200).optional(), durationMs: ms }).strict();
const hapticAction = z.object({ offsetMs: ms, command: DeviceCommandSchema, speechSlotId: z.string().min(1).max(128).optional() }).strict();
const fractionation = z.object({
  stateA: PresentationStateSchema, stateB: PresentationStateSchema,
  pattern: z.enum(['constant', 'accelerating', 'decelerating', 'irregular']),
  cycles: z.array(z.object({ aMs: ms, bMs: ms }).strict()).min(1).max(32),
  transitionMs: ms, speechA: SpeechSpecSchema, speechB: SpeechSpecSchema,
}).strict();
const blink = z.object({
  openState: PresentationStateSchema, closedState: PresentationStateSchema,
  sound: z.boolean().optional(),
  spoken: z.boolean().optional(),
  steps: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('blink'), count: z.number().int().min(1).max(2), closedMs: ms, openMs: ms }).strict(),
    z.object({ kind: z.enum(['long_close', 'stay_closed', 'reopen']), durationMs: ms }).strict(),
  ])).min(1).max(32),
}).strict();
const mantra = z.object({ count: z.number().int().min(1).max(16), periodMs: ms, perLoop: z.array(PresentationStateSchema).max(16).optional() }).strict();
const softReturn = z.object({ steps: z.array(z.object({ offsetMs: ms, state: PresentationStateSchema }).strict()).min(1).max(32), final: z.boolean() }).strict();

export const EventSchema = z.object({
  id, type: z.enum(['fractionation', 'mindwipe', 'reset', 'original_self', 'mantra', 'peak', 'silence', 'motif_recall', 'soft_return', 'blink_trigger', 'layer_shift']),
  phase: z.enum(sessionPhases), atMs: ms,
  timing: z.object({ prepMs: ms, activeMs: ms, returnMs: ms }).strict(),
  state: PresentationStateSchema, baseline: PresentationStateSchema,
  speech: SpeechSpecSchema,
  audio: z.array(audioAction).max(128), visual: z.array(visualAction).max(128), haptics: z.array(hapticAction).max(128),
  entry: TransitionSchema, exit: TransitionSchema,
  rhythm: z.object({ offsetMs: ms, untilMs: ms, stepMs: z.number().finite().min(500).max(5000), endStepMs: z.number().finite().min(500).max(5000).optional() }).strict().optional(),
  fractionation: fractionation.optional(), blink: blink.optional(), mantra: mantra.optional(), softReturn: softReturn.optional(),
  motifId: id.optional(), originalSelf: z.enum(['original', 'old']).optional(),
}).strict().superRefine((event, ctx) => {
  const { prepMs, activeMs, returnMs } = event.timing, total = prepMs + activeMs + returnMs;
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (total <= 0 || total > 86400000) issue('Event must have a finite positive total duration');
  if (event.entry.durationMs > prepMs || event.exit.durationMs > returnMs) issue('Transition envelopes must fit preparation/return windows');
  for (const key of ['fractionation', 'blink', 'mantra', 'softReturn'] as const) {
    const expected = { fractionation: 'fractionation', blink: 'blink_trigger', mantra: 'mantra', softReturn: 'soft_return' }[key];
    if ((event.type === expected) !== (event[key] !== undefined)) issue(`Only ${expected} events require ${key} configuration`);
  }
  if (event.type === 'fractionation' && event.fractionation) {
    const f = event.fractionation;
    if (f.cycles.some(c => c.aMs <= 0 || c.bMs <= 0)) issue('Fractionation dwells must be positive');
    if (f.cycles.reduce((sum, c) => sum + c.aMs + c.bMs, 0) !== activeMs) issue('Fractionation cycle dwells must fill active duration');
    if (f.cycles.some(c => f.transitionMs > Math.min(c.aMs, c.bMs) || f.speechA.targetMs > c.aMs - f.transitionMs || f.speechB.targetMs > c.bMs - f.transitionMs)) issue('Fractionation speech/transitions must fit each dwell');
    const sizes = f.cycles.map(c => c.aMs + c.bMs);
    if (f.pattern === 'constant' && sizes.some(n => n !== sizes[0])) issue('Constant fractionation requires equal periods');
    if (f.pattern === 'accelerating' && sizes.some((n, i) => i > 0 && n > sizes[i - 1])) issue('Accelerating fractionation cannot lengthen periods');
    if (f.pattern === 'decelerating' && sizes.some((n, i) => i > 0 && n < sizes[i - 1])) issue('Decelerating fractionation cannot shorten periods');
  }
  if (event.speech.fixedCue || event.fractionation?.speechA.fixedCue || event.fractionation?.speechB.fixedCue) issue('Fixed eye cues are compiled only from blink steps');
  if (event.blink) {
    if (event.blink.spoken && event.speech.mode !== 'silent') issue('Spoken blink steps own their individual cue windows');
    if (event.blink.spoken && event.blink.steps.some(s=>s.kind==='blink' && s.closedMs+s.openMs<1200)) issue('Spoken blink needs room for a word-timed cue');
    const duration = event.blink.steps.reduce((sum, step) => sum + (step.kind === 'blink' ? step.count * (step.closedMs + step.openMs) : step.durationMs), 0);
    if (duration !== activeMs || event.blink.steps.some(s => s.kind === 'blink' ? s.closedMs <= 0 || s.openMs <= 0 : s.durationMs <= 0)) issue('Blink steps must be positive and fill active duration');
    if (event.blink.steps.at(-1)?.kind !== 'reopen') issue('Blink sequence must have a deterministic reopening');
  }
  if (event.mantra) {
    if (event.speech.mode !== 'mantra' || event.mantra.periodMs <= 0 || event.mantra.count * event.mantra.periodMs !== activeMs || event.speech.targetMs > event.mantra.periodMs) issue('Mantra iterations and speech must fit explicit periods');
    if (event.mantra.perLoop && event.mantra.perLoop.length !== event.mantra.count) issue('Every mantra loop needs its declared presentation');
  }
  if (event.type === 'silence' && (event.speech.mode !== 'silent' || event.state.narrationState !== 'paused')) issue('Silence never generates text');
  if (event.type === 'mindwipe' && (event.speech.mode !== 'fragment' || prepMs <= 0 || returnMs <= 0 || event.state.narrationState !== 'paused')) issue('Mindwipe needs preparation, no-text blank and reanchor return');
  if (event.type !== 'mindwipe' && event.type !== 'fractionation' && event.speech.targetMs > activeMs) issue('Speech must fit active window');
  if (event.type === 'mindwipe' && event.speech.targetMs > prepMs) issue('Mindwipe preparation speech must fit preparation');
  if (event.type === 'peak' && !event.state.foreground) issue('A layered peak needs one active foreground');
  if (event.type === 'reset' && returnMs <= 0) issue('Reset needs an explicit completion/return window');
  if (event.softReturn?.final && event.phase !== 'awakening') issue('Final return belongs to the fixed awakening phase');
  if (event.speech.fixedText && !event.softReturn?.final || event.fractionation?.speechA.fixedText || event.fractionation?.speechB.fixedText) issue('Fixed narration belongs only to the final closing');
  if (event.rhythm && (event.rhythm.offsetMs >= event.rhythm.untilMs || event.rhythm.untilMs > total || !event.state.activeLayers.includes('transition_sfx'))) issue('Rhythm must fit its declared effect lane and event');
  if (event.rhythm && (event.rhythm.untilMs - event.rhythm.offsetMs) / Math.min(event.rhythm.stepMs, event.rhythm.endStepMs ?? event.rhythm.stepMs) > 256) issue('Rhythm exceeds its bounded beat budget');
  if (['motif_recall', 'original_self'].includes(event.type) && !event.motifId) issue('Recall/viewpoint needs a known motif');
  if ((event.type === 'original_self') !== (event.originalSelf !== undefined)) issue('Original Self referent belongs only to original_self events');
  if (event.softReturn && (event.softReturn.steps[0].offsetMs !== 0 || event.softReturn.steps.some((s, i, a) => s.offsetMs >= activeMs || i > 0 && s.offsetMs <= a[i - 1].offsetMs))) issue('Soft return stages must be ordered within active window');
  for (const a of [...event.audio, ...event.visual]) if (a.offsetMs + a.durationMs > total) issue('Automation exceeds event duration');
  for (const a of event.haptics) if (a.offsetMs + (a.command.durationMs ?? 0) > total) issue('Haptic action exceeds event duration');
});
export type BambiEvent = z.infer<typeof EventSchema>;
export type BambiEventType = BambiEvent['type'];
export const eventDurationMs = (event: BambiEvent) => event.timing.prepMs + event.timing.activeMs + event.timing.returnMs;

export const MotifSchema = z.object({ id, visualPreset: z.enum(sceneNames), audioPreset: z.string().max(100).optional(), textAnchor: z.string().max(200), firstIntroducedAtMs: ms }).strict();
export const ProgramSchema = z.object({
  version: z.literal(1), durationMs: ms.refine(n => n > 0), baseline: PresentationStateSchema,
  motifs: z.array(MotifSchema).max(32), events: z.array(EventSchema).max(500),
}).strict().superRefine((program, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set<string>(), motifs = new Map(program.motifs.map(m => [m.id, m]));
  if (motifs.size !== program.motifs.length) issue('Duplicate motif identity');
  let end = 0;
  for (const event of [...program.events].sort((a, b) => a.atMs - b.atMs)) {
    if (ids.has(event.id)) issue('Duplicate event identity'); ids.add(event.id);
    const i = sessionPhases.indexOf(event.phase), from = phaseStarts[i] * program.durationMs, to = (phaseStarts[i + 1] ?? 1) * program.durationMs;
    if (event.atMs < from || event.atMs + eventDurationMs(event) > to + .001) issue('Event extends outside its fixed parent phase');
    if (event.atMs < end) issue('Foreground events cannot overlap; compose stages explicitly');
    end = event.atMs + eventDurationMs(event);
    if (event.motifId && (!motifs.has(event.motifId) || motifs.get(event.motifId)!.firstIntroducedAtMs > event.atMs)) issue('Motif must be introduced before recall');
    if (event.phase === 'awakening' && !['soft_return', 'layer_shift', 'silence', 'motif_recall'].includes(event.type)) issue('Awakening cannot start a new temporary reinforcing mechanism');
  }
});
export type BambiProgram = z.infer<typeof ProgramSchema>;
export function parentPhaseMs(phase: SessionPhase, durationMs: number) { const i = sessionPhases.indexOf(phase); return { start: phaseStarts[i] * durationMs, end: (phaseStarts[i + 1] ?? 1) * durationMs }; }
