// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { EventSchema, ProgramSchema, eventDurationMs, type BambiEvent, type BambiProgram, type PresentationState, type SpeechSpec, type Transition } from './contract';
import { deliveryProfiles, eventDelivery } from '../delivery';

export type EngineMarker = '[frac:on]' | '[frac:off]' | '[mindwipe:start]' | '[mindwipe:blank]' | '[mindwipe:reanchor]' | '[reset:begin]' | '[reset:complete]' | '[self:original]' | '[blink:start]' | '[silence:break]' | '[motif:recall]' | '[peak:layer]' | '[soft:return]' | `[mantra:loop:${number}]`;
export function parseEngineMarker(value: string): EngineMarker | undefined {
  if (value === '[os:init]') return '[self:original]'; // Older authored packs, never a computer-OS state.
  if (['[frac:on]', '[frac:off]', '[mindwipe:start]', '[mindwipe:blank]', '[mindwipe:reanchor]', '[reset:begin]', '[reset:complete]', '[self:original]', '[blink:start]', '[silence:break]', '[motif:recall]', '[peak:layer]', '[soft:return]'].includes(value)) return value as EngineMarker;
  const match = /^\[mantra:loop:(\d+)\]$/.exec(value);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 16) return value as EngineMarker;
}
export interface EventFrame { atMs: number; state: PresentationState; label: string; marker?: EngineMarker; transition: Transition }
export interface SpeechSlot { id: string; payloadId: string; eventId: string; phase: BambiEvent['phase']; atMs: number; endMs: number; speech: SpeechSpec; iteration: number }
export interface CompiledEvent { event: BambiEvent; frames: EventFrame[]; speech: SpeechSlot[]; entryState?: PresentationState }
const instant: Transition = { kind: 'hard_cut', durationMs: 0, subtitle: 'clear' };
const markerFor = (event: BambiEvent): EngineMarker | undefined => ({ fractionation: undefined, layer_shift: undefined, mindwipe: '[mindwipe:start]', reset: '[reset:begin]', original_self: '[self:original]', mantra: `[mantra:loop:${event.mantra?.count ?? 1}]`, peak: '[peak:layer]', silence: '[silence:break]', motif_recall: '[motif:recall]', soft_return: '[soft:return]', blink_trigger: '[blink:start]' }[event.type] as EngineMarker | undefined);

export function compileEvent(raw: BambiEvent): CompiledEvent {
  const event = EventSchema.parse(raw), { prepMs, activeMs, returnMs } = event.timing;
  const frames: EventFrame[] = [], speech: SpeechSlot[] = [];
  const frame = (offset: number, state: PresentationState, label: string, marker?: EngineMarker, transition: Transition = instant) => frames.push({ atMs: event.atMs + offset, state: structuredClone(state), label, marker, transition });
  const slot = (offset: number, spec: SpeechSpec, duration = spec.targetMs, payloadSuffix = '', iteration = 0) => {
    if (spec.mode === 'silent') return;
    speech.push({ id: `${event.id}:speech:${speech.length}`, payloadId: `${event.id}:payload${payloadSuffix}`, eventId: event.id, phase: event.phase, atMs: event.atMs + offset, endMs: event.atMs + offset + duration, speech: structuredClone(spec), iteration });
  };
  if (prepMs > 0) {
    const prepState = event.preparationState??(['peak', 'original_self', 'motif_recall', 'layer_shift', 'soft_return'].includes(event.type) ? event.state : event.baseline);
    frame(0, prepState, 'prepare', event.type === 'mindwipe' ? '[mindwipe:start]' : event.type === 'reset' ? '[reset:begin]' : undefined, event.entry);
  }
  if (event.fractionation) {
    let cursor = prepMs;
    for (const [i, cycle] of event.fractionation.cycles.entries()) {
      const f = event.fractionation, transition: Transition = { kind: 'fractionation_switch', durationMs: f.transitionMs, subtitle: 'clear' };
      frame(cursor, f.stateA, `narrow:${i}`, '[frac:on]', transition); slot(cursor + f.transitionMs, f.speechA, f.speechA.targetMs, `:A:${i}`, i);
      cursor += cycle.aMs;
      frame(cursor, f.stateB, `expanded:${i}`, '[frac:off]', transition); slot(cursor + f.transitionMs, f.speechB, f.speechB.targetMs, `:B:${i}`, i); cursor += cycle.bMs;
    }
  } else if (event.blink) {
    let cursor = prepMs;
    for (const step of event.blink.steps) {
      if (step.kind === 'blink') for (let i = 0; i < step.count; i++) {
        // A voiced cue has an engine firing time; text is shown only after its audio is scheduled.
        const cueAt = event.blink.spoken ? 250 : 0;
        if (cueAt) frame(cursor,event.blink.openState,'blink:lead',cursor===prepMs?'[blink:start]':undefined);
        frame(cursor+cueAt,event.blink.openState,'blink:cue',!cueAt&&cursor===prepMs?'[blink:start]':undefined);
        if (event.blink.spoken) slot(cursor,{mode:'fragment',targetMs:step.closedMs+step.openMs,wordTarget:1,instruction:'Engine-authored spoken eye cue; no LLM text.',fixedCue:'Blink',cueAtMs:cueAt},step.closedMs+step.openMs,':eye:Blink',i);
        frame(cursor+cueAt+step.closedMs,event.blink.openState,'blink:open'); cursor += step.closedMs+step.openMs;
      } else { frame(cursor, step.kind === 'reopen' ? event.blink.openState : event.blink.closedState, `blink:${step.kind}`, cursor === prepMs ? '[blink:start]' : undefined); cursor += step.durationMs; }
    }
    slot(prepMs, event.speech);
  } else if (event.mantra) {
    for (let i = 0; i < event.mantra.count; i++) {
      const offset = prepMs + i * event.mantra.periodMs;
      frame(offset, event.mantra.perLoop?.[i] ?? event.state, `mantra:${i + 1}`, i === 0 ? markerFor(event) : undefined);
      slot(offset, event.speech, event.speech.targetMs, '', i); // Same payload identity for all iterations.
    }
  } else if (event.type === 'mindwipe') {
    slot(0, event.speech);
    frame(prepMs, event.state, 'blank', '[mindwipe:blank]');
    frame(prepMs + activeMs, event.baseline, 'reanchor', '[mindwipe:reanchor]', event.exit);
    slot(prepMs + activeMs, { mode: 'reanchor', targetMs: returnMs, instruction: 'One original simple reanchor to the supplied motif. Restore ordinary orientation if this is a closing state.' }, returnMs, ':anchor');
  } else if (event.softReturn) {
    for (const step of event.softReturn.steps) frame(prepMs + step.offsetMs, step.state, 'soft_return', step.offsetMs === 0 ? '[soft:return]' : undefined, { ...event.entry, kind: 'soft_return', durationMs: 0 });
    slot(prepMs, event.speech);
  } else {
    frame(prepMs, event.state, event.type, markerFor(event), prepMs ? instant : event.entry);
    slot(prepMs, event.speech);
    if (event.type === 'reset') frame(prepMs + activeMs, event.baseline, 'reset:complete', '[reset:complete]', event.exit);
  }
  if (returnMs > 0 && event.type !== 'mindwipe' && event.type !== 'reset') frame(prepMs + activeMs, event.baseline, 'return', undefined, event.exit);
  frames.sort((a, b) => a.atMs - b.atMs);
  for (const window of speech) {
    const states = [frames.filter(f => f.atMs <= window.atMs).at(-1), ...frames.filter(f => f.atMs > window.atMs && f.atMs < window.endMs)].filter(Boolean);
    if (states.some(f => f!.state.narrationState === 'paused' || !f!.state.activeLayers.some(l => ['main_voice', 'mantra_voice', 'left_voice', 'right_voice', 'echo_voice'].includes(l)))) throw Error('Speech window overlaps an engine-only interval');
  }
  for (const action of event.haptics.filter(a => a.speechSlotId)) {
    const window = speech.find(s => s.id === action.speechSlotId), atMs = event.atMs + action.offsetMs;
    if (!window || atMs < window.atMs || atMs + (action.command.durationMs ?? 0) > window.endMs) throw Error('Speech-bound haptic must fit its speech window');
  }
  return { event, frames, speech };
}

export interface MotifState { id: string; firstIntroducedAtMs: number; lastUsedAtMs: number | null; useCount: number; visualPreset: string; audioPreset?: string; textAnchor: string }
export interface TriggerState { id: string; status: 'planned' | 'introduced' | 'reinforcing' | 'established_for_session' | 'cooldown'; firstUsedAtMs?: number; lastUsedAtMs?: number; useCount: number; cooldownMs: number; preferredPhases: BambiEvent['phase'][] }
export class TriggerLifecycle {
  private states = new Map<string, TriggerState>();
  plan(id: string, cooldownMs: number, phase?: BambiEvent['phase']) { if (!Number.isFinite(cooldownMs) || cooldownMs < 0) throw Error('Invalid trigger cooldown'); if (!this.states.has(id)) this.states.set(id, { id, cooldownMs, useCount: 0, status: 'planned', preferredPhases: [] }); const state = this.states.get(id)!; if (phase && !state.preferredPhases.includes(phase)) state.preferredPhases.push(phase); }
  fire(id: string, atMs: number) {
    const state = this.states.get(id); if (!state || !Number.isFinite(atMs) || atMs < 0 || state.lastUsedAtMs !== undefined && atMs - state.lastUsedAtMs < state.cooldownMs) return false;
    state.firstUsedAtMs ??= atMs; state.lastUsedAtMs = atMs; state.useCount++; state.status = state.useCount === 1 ? 'introduced' : state.useCount < 3 ? 'reinforcing' : 'established_for_session'; return true;
  }
  snapshot(atMs: number) { return [...this.states.values()].map(s => ({ ...s, status: s.lastUsedAtMs !== undefined && atMs - s.lastUsedAtMs < s.cooldownMs ? 'cooldown' as const : s.status })); }
  clear() { this.states.clear(); }
}

export interface EngineSnapshot {
  state: PresentationState; eventId: string | null; label: string; paused: boolean; complete: boolean;
  fractionation: boolean; blink: boolean; mindwipe: boolean; reset: boolean; originalSelf: 'original' | 'old' | null; mantra: boolean; peak: boolean;
}
/** Evaluates only the existing session clock. No wall timers and no model-driven transitions. */
export class EventRuntime {
  readonly program: BambiProgram; readonly compiled: CompiledEvent[];
  readonly triggers = new TriggerLifecycle(); readonly motifs = new Map<string, MotifState>();
  private delivered = new Set<string>(); private stopped = false; private paused = false; private lastMs = -1; private generation = 0;
  constructor(raw: BambiProgram) {
    this.program = ProgramSchema.parse(raw); this.compiled = this.program.events.map(compileEvent).sort((a, b) => a.event.atMs - b.event.atMs);
    for (const [i, current] of this.compiled.entries()) {
      const previous = this.compiled[i - 1];
      current.entryState = structuredClone(previous && previous.event.atMs + eventDurationMs(previous.event) === current.event.atMs ? previous.frames.at(-1)?.state ?? this.program.baseline : this.program.baseline);
    }
    for (const m of this.program.motifs) this.motifs.set(m.id, { ...m, lastUsedAtMs: null, useCount: 0 });
    const cues = new Map<string, { atMs: number; cooldownMs: number }>();
    for (const slot of this.slots) if (slot.speech.requiredTrigger) {
      const id = slot.speech.requiredTrigger, atMs = slot.atMs + slot.speech.triggerAtMs!, previous = cues.get(id);
      if (previous && atMs - previous.atMs < previous.cooldownMs) throw Error('Authored trigger schedule violates cooldown');
      cues.set(id, { atMs, cooldownMs: slot.speech.triggerCooldownMs! });
      this.triggers.plan(id, slot.speech.triggerCooldownMs!, slot.phase);
    }
  }
  get slots() { return this.compiled.flatMap(c => c.speech); }
  /** Append a bounded adaptive window without replacing delivered history or the clock. */
  append(event: BambiEvent, motifs: BambiProgram['motifs'] = []) {
    if (this.stopped) throw Error('Cannot append to a stopped runtime');
    const previous = this.compiled.at(-1);
    if (event.atMs < Math.max(this.lastMs, previous ? previous.event.atMs + eventDurationMs(previous.event) : 0)) throw Error('Adaptive event overlaps committed playback');
    const retained = this.compiled.filter(c => c.event.atMs + eventDurationMs(c.event) >= this.lastMs - 60000).slice(-63);
    const known = new Map(this.program.motifs.map(m => [m.id, m]));
    for (const motif of motifs) if (!known.has(motif.id)) known.set(motif.id, motif);
    const checked = ProgramSchema.parse({ ...this.program, motifs: [...known.values()], events: [...retained.map(c => c.event), event] });
    const compiled = compileEvent(event);
    compiled.entryState = structuredClone(previous && previous.event.atMs + eventDurationMs(previous.event) === event.atMs ? previous.frames.at(-1)?.state ?? this.program.baseline : this.program.baseline);
    const reservations = new Map<string, { atMs: number; cooldownMs: number }>();
    for (const slot of [...this.slots, ...compiled.speech]) if (slot.speech.requiredTrigger) {
      const phrase = slot.speech.requiredTrigger, atMs = slot.atMs + slot.speech.triggerAtMs!, prior = reservations.get(phrase);
      if (prior && atMs - prior.atMs < prior.cooldownMs) throw Error('Adaptive trigger violates cooldown');
      reservations.set(phrase, { atMs, cooldownMs: slot.speech.triggerCooldownMs! });
    }
    this.program.events = checked.events; this.program.motifs = checked.motifs;
    this.compiled.splice(0, this.compiled.length, ...retained, compiled);
    const liveSlots = new Set(this.slots.map(s => s.id));
    for (const id of this.delivered) if (!liveSlots.has(id)) this.delivered.delete(id);
    for (const motif of motifs) if (!this.motifs.has(motif.id)) this.motifs.set(motif.id, { ...motif, lastUsedAtMs: null, useCount: 0 });
    for (const slot of compiled.speech) if (slot.speech.requiredTrigger) this.triggers.plan(slot.speech.requiredTrigger, slot.speech.triggerCooldownMs!, slot.phase);
  }
  /** Commit a fully measured composition atomically, including its input windows.
   * Validation and cue reservation finish before any live program is changed. */
  appendScene(scene:Pick<BambiProgram,'events'|'motifs'|'responseWindows'|'responsePrompts'>) {
    if(this.stopped||!scene.events.length||scene.events.length>64)throw Error('Invalid scene append');
    const previous=this.compiled.at(-1),boundary=Math.max(this.lastMs,previous?previous.event.atMs+eventDurationMs(previous.event):0);
    if(scene.events.some(e=>e.atMs<boundary))throw Error('Scene overlaps committed playback');
    const retained=this.compiled.filter(c=>c.event.atMs+eventDurationMs(c.event)>=this.lastMs-60000).slice(-(128-scene.events.length));
    const motifs=new Map(this.program.motifs.map(m=>[m.id,m]));
    for(const m of scene.motifs){const old=motifs.get(m.id);if(old&&JSON.stringify(old)!==JSON.stringify(m))throw Error('Cannot redefine an introduced motif');motifs.set(m.id,m);}
    const responseWindows=[...(this.program.responseWindows??[]).filter(w=>w.toMs>=this.lastMs),...(scene.responseWindows??[])];
    const responsePrompts=[...(this.program.responsePrompts??[]).filter(w=>w.toMs>=this.lastMs),...(scene.responsePrompts??[])];
    const checked=ProgramSchema.parse({...this.program,events:[...retained.map(c=>c.event),...scene.events],motifs:[...motifs.values()],responseWindows,responsePrompts});
    const additions=scene.events.map(compileEvent),reservations=new Map<string,{atMs:number;cooldownMs:number}>();
    for(const slot of [...this.slots,...additions.flatMap(c=>c.speech)])if(slot.speech.requiredTrigger){
      const phrase=slot.speech.requiredTrigger,atMs=slot.atMs+slot.speech.triggerAtMs!,prior=reservations.get(phrase);
      if(prior&&atMs-prior.atMs<prior.cooldownMs)throw Error('Scene trigger violates cooldown');
      reservations.set(phrase,{atMs,cooldownMs:slot.speech.triggerCooldownMs!});
    }
    let prior=previous;
    for(const c of additions){c.entryState=structuredClone(prior&&prior.event.atMs+eventDurationMs(prior.event)===c.event.atMs?prior.frames.at(-1)?.state??this.program.baseline:this.program.baseline);prior=c;}
    this.program.events=checked.events;this.program.motifs=checked.motifs;this.program.responseWindows=checked.responseWindows;this.program.responsePrompts=checked.responsePrompts;
    this.compiled.splice(0,this.compiled.length,...retained,...additions);
    const live=new Set(this.slots.map(s=>s.id));for(const id of this.delivered)if(!live.has(id))this.delivered.delete(id);
    for(const m of scene.motifs)if(!this.motifs.has(m.id))this.motifs.set(m.id,{...m,lastUsedAtMs:null,useCount:0});
    for(const slot of additions.flatMap(c=>c.speech))if(slot.speech.requiredTrigger)this.triggers.plan(slot.speech.requiredTrigger,slot.speech.triggerCooldownMs!,slot.phase);
  }
  /** Feedback may discard future sections, preserving any section already begun.
   * The caller also cancels pending HTTP/audio under its generation epoch. */
  discardFuture(afterMs:number) {
    if(this.stopped||!Number.isFinite(afterMs)||afterMs<this.lastMs)throw Error('Cannot discard heard event history');
    const retained=this.compiled.filter(c=>c.event.atMs<=afterMs);
    this.program.events=retained.map(c=>c.event);this.compiled.splice(0,this.compiled.length,...retained);
    this.program.responseWindows=this.program.responseWindows?.filter(w=>w.fromMs<=afterMs);
    this.program.responsePrompts=this.program.responsePrompts?.filter(w=>w.fromMs<=afterMs);
    this.program.motifs=this.program.motifs.filter(m=>m.firstIntroducedAtMs<=afterMs);
    for(const [id,m] of this.motifs)if(m.firstIntroducedAtMs>afterMs)this.motifs.delete(id);
    this.generation++;
  }
  /** A readiness fallback may replace only an episode that has not started. */
  finishListeningWindow(eventId:string,atMs:number){
    const index=this.compiled.findIndex(c=>c.event.id===eventId),old=this.compiled[index]?.event;
    if(this.stopped||!old||old.type!=='silence'||old.speech.mode!=='silent'||old.atMs>atMs||atMs<this.lastMs||atMs>=old.atMs+eventDurationMs(old))return;
    const end=Math.max(old.atMs+1,atMs),event=EventSchema.parse({...old,timing:{prepMs:0,activeMs:end-old.atMs,returnMs:0}});
    const prompts=this.program.responsePrompts?.map(p=>p.fromMs===old.atMs?{...p,toMs:Math.min(p.toMs,end)}:p);
    const checked=ProgramSchema.parse({...this.program,events:this.program.events.map(e=>e.id===eventId?event:e),responsePrompts:prompts});
    const compiled=compileEvent(event);compiled.entryState=this.compiled[index].entryState;
    this.program.events=checked.events;this.program.responsePrompts=checked.responsePrompts;this.compiled[index]=compiled;this.generation++;
  }
  /** A readiness fallback may replace only an episode that has not started. */
  replacePending(event: BambiEvent) {
    const index = this.compiled.findIndex(c => c.event.id === event.id), old = this.compiled[index];
    if (this.stopped || !old || event.atMs <= this.lastMs || event.atMs !== old.event.atMs || eventDurationMs(event) !== eventDurationMs(old.event)) throw Error('Cannot replace delivered event timing');
    const checked = ProgramSchema.parse({ ...this.program, events: this.program.events.map(e => e.id === event.id ? event : e) });
    const compiled = compileEvent(event); compiled.entryState = old.entryState;
    this.compiled[index] = compiled; this.program.events = checked.events;
  }
  get revision() { return this.generation; }
  pause() { this.paused = true; }
  resume() { if (!this.stopped) this.paused = false; }
  stop() { this.stopped = true; this.paused = false; this.generation++; this.delivered.clear(); this.triggers.clear(); this.motifs.clear(); }
  seek(atMs: number) { this.generation++; this.lastMs = atMs; this.delivered = new Set(this.slots.filter(s => s.atMs <= atMs).map(s => s.id)); this.triggers.clear(); for (const slot of this.slots) if (slot.speech.requiredTrigger) this.triggers.plan(slot.speech.requiredTrigger, slot.speech.triggerCooldownMs!); }
  snapshot(atMs: number): EngineSnapshot {
    if (this.paused) atMs = Math.max(0, this.lastMs);
    const complete = this.stopped || !this.program.continuous && atMs >= this.program.durationMs;
    const current = !complete ? this.compiled.find(c => atMs >= c.event.atMs && atMs < c.event.atMs + eventDurationMs(c.event)) : undefined;
    const frame = current?.frames.filter(f => f.atMs <= atMs).at(-1), type = current?.event.type;
    const state = structuredClone(frame?.state ?? this.program.baseline);
    const previous = frame && current?.frames.filter(f => f.atMs < frame.atMs).at(-1);
    if (frame && frame.transition.durationMs > atMs - frame.atMs && !['hard_cut', 'silence_cut'].includes(frame.transition.kind)) {
      const from = previous?.state ?? current!.entryState ?? current!.event.baseline;
      state.activeLayers = [...new Set([...from.activeLayers, ...state.activeLayers])].filter(layer => state.narrationState !== 'paused' || !['main_voice', 'left_voice', 'right_voice', 'echo_voice', 'mantra_voice'].includes(layer));
    }
    return { state, eventId: current?.event.id ?? null, label: frame?.label ?? (complete ? 'complete' : 'baseline'), paused: this.paused, complete,
      fractionation: type === 'fractionation', blink: type === 'blink_trigger', mindwipe: type === 'mindwipe', reset: type === 'reset', originalSelf: type === 'original_self' ? current!.event.originalSelf! : null, mantra: type === 'mantra', peak: type === 'peak' };
  }
  tick(atMs: number) {
    if (!Number.isFinite(atMs) || atMs < 0) throw Error('Invalid engine time');
    if (atMs < this.lastMs) this.seek(atMs);
    const snapshot = this.snapshot(atMs);
    if (this.stopped || this.paused) return { snapshot, speech: [] as SpeechSlot[], frames: [] as EventFrame[], audio: [] as BambiEvent['audio'], visual: [] as BambiEvent['visual'], haptics: [] as BambiEvent['haptics'] };
    if (snapshot.complete) { this.stop(); return { snapshot: this.snapshot(atMs), speech: [], frames: [], audio: [], visual: [], haptics: [] }; }
    const previousState = this.lastMs >= 0 ? this.snapshot(this.lastMs).state : undefined;
    let retainedMotif = previousState?.activeLayers.includes('motif_visual') ? previousState.motifId : undefined;
    const current = this.compiled.find(c => c.event.id === snapshot.eventId);
    const frames = current?.frames.filter(f => f.atMs > this.lastMs && f.atMs <= atMs) ?? [];
    for (const frame of frames) {
      const id = frame.state.activeLayers.includes('motif_visual') ? frame.state.motifId ?? current?.event.motifId : undefined;
      if (id && (id !== retainedMotif || frame.marker === '[motif:recall]')) {
        const motif = this.motifs.get(id); if (motif) { motif.lastUsedAtMs = frame.atMs; motif.useCount++; }
      }
      retainedMotif = id;
    }
    const speech = this.slots.filter(slot => {
      if (slot.atMs > atMs || this.delivered.has(slot.id)) return false;
      this.delivered.add(slot.id); // Late/expired slots are consumed, never replayed after a seek/blank.
      return atMs - slot.atMs <= 150 && atMs < slot.endMs && snapshot.state.narrationState !== 'paused';
    });
    const due = <T extends { offsetMs: number }>(items: T[]) => current ? items.filter(a => current.event.atMs + a.offsetMs > this.lastMs && current.event.atMs + a.offsetMs <= atMs && atMs - current.event.atMs - a.offsetMs <= 150) : [];
    // Bound cues are dispatched only by successful speech playback, never by timeline ticks alone.
    const result = { snapshot, speech, frames, audio: due(current?.event.audio ?? []), visual: due(current?.event.visual ?? []), haptics: due(current?.event.haptics.filter(a => !a.speechSlotId) ?? []) };
    this.lastMs = atMs; return result;
  }
}

/** Generation receives this data, not marker execution, timers or a device API. */
export function speechInstruction(slot: SpeechSlot, motif?: MotifState, frame?: Pick<EventFrame, 'state' | 'label'>) {
  return [
    'Write original narration only. Engine timing, controls, repeats and audiovisual events are authoritative.',
    `Parent phase: ${slot.phase}. Speech mode: ${slot.speech.mode}. Target spoken duration: ${(slot.speech.targetMs / 1000).toFixed(2)} seconds.`,
    frame ? `Engine-selected narration context: ${JSON.stringify({ intensity: frame.state.density.intensity, effectDensity: frame.state.density.effectDensity, visualState: frame.state.visualState, narrationState: frame.state.narrationState, ambientState: frame.state.ambientState })}. Match its narrative intensity and speech mode; do not read technical settings aloud.` : '',
    slot.speech.wordTarget ? `Word budget: at most ${slot.speech.wordTarget} words in total.` : '',
    slot.speech.instruction,
    `Engine delivery: ${slot.speech.delivery ?? eventDelivery(slot.speech.mode, slot.phase)}. ${deliveryProfiles[slot.speech.delivery ?? eventDelivery(slot.speech.mode, slot.phase)].syntax} Speed and pauses remain engine-controlled.`,
    motif ? `Established original motif: ${JSON.stringify(motif.textAnchor)}. Preserve its identity.` : '',
    slot.speech.requiredTrigger ? `Required phrase: ${JSON.stringify(slot.speech.requiredTrigger)}. Use exactly once, as the final clause. Do not use any other trigger.` : 'Do not introduce or use named triggers.',
    'No markers, stage directions, sound/device metadata, timing decisions or instructions to change application settings. Fictional states are not factual changes to the listener.',
    slot.speech.mode === 'mantra' ? 'Supply one payload only; the engine repeats the cached audio.' : '',
  ].filter(Boolean).join('\n');
}
