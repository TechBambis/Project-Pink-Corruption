// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { ProgramSchema, type BambiProgram } from '../../../packages/session-director/events/contract';
import { createReferenceProgram, withHapticMappings, withProgramTriggers } from '../../../packages/session-director/events/program';
import { EventRuntime, type EngineSnapshot, type SpeechSlot } from '../../../packages/session-director/events/runtime';
import { presentationAt } from '../../../packages/session-director/events/presentation';
import type { EventSpeechRequest, RenderedEventSpeech } from '../../../packages/session-director/events/speech';
import type { AudioEngine } from '../../../packages/audio';
import type { VisualEngine } from '../../../packages/visuals';
import { triggerEffectFor } from '../../../packages/visuals/trigger-effects';

type Settings = Omit<EventSpeechRequest, 'event' | 'payloadId' | 'motif'>;
interface CachedPayload { response: RenderedEventSpeech; buffer: AudioBuffer }
interface Hooks {
  audio: () => AudioEngine;
  visuals: () => VisualEngine | null;
  settings: () => Settings;
  notice: (text: string) => void;
  clearSpeech: () => void;
  clearDevices: () => void;
  cue: (phrase: string) => void;
  pink: () => void;
  allowVisuals: () => boolean;
  paused: () => boolean;
  triggers: () => Parameters<typeof withProgramTriggers>[1];
  haptics: () => boolean;
  restore: () => void;
  allowSpeech: () => boolean;
  allowTriggers: () => boolean;
  allowTriggerSound: () => boolean;
}

/** Browser adapter for the existing session clock. HTTP results never mutate event timing. */
export class SessionEvents {
  private runtime: EventRuntime | null = null;
  private payloads = new Map<string, CachedPayload>();
  private failed = new Set<string>();
  private wordsPerMs = new Map<string, number>();
  private request: AbortController | null = null;
  private epoch = 0;
  private started = false;
  private lastSnapshot: EngineSnapshot | null = null;
  private currentText = '';
  private caption: { text: string; startMs: number; endMs: number } | null = null;
  private eyeCueRanges: {startMs:number;endMs:number}[] = [];
  private cueTimes: { phrase: string; atMs: number; endMs: number }[] = [];
  private pinkTimes: number[] = [];
  private lastCue: { phrase: string; atMs: number } | null = null;
  private speechSources: AudioBufferSourceNode[] = [];
  private overrideUntilMs = 0;
  private nowMs = 0;
  private displayAtMs = 0;
  private pausedDisplayMs: number | null = null;
  private effectWindows: {startMs:number;endMs:number}[] = [];
  private layer = document.createElement('div');
  private motif = document.createElement('div');
  private wash = document.createElement('div');
  private text = document.createElement('div');
  private blinkCue = document.createElement('div');
  private blinkCueText = document.createElement('span');
  private scanner = document.createElement('div');
  constructor(private stage: HTMLElement, private canvas: HTMLCanvasElement, private hooks: Hooks) {
    this.layer.className = 'event-black'; this.motif.className = 'event-motif';
    this.wash.className = 'event-wash'; this.text.className = 'event-text';
    const orb = document.createElement('div'); orb.className = 'event-orb'; this.motif.append(orb);
    this.scanner.className = 'event-scanner'; this.scanner.hidden = true; orb.append(this.scanner);
    this.blinkCue.className = 'event-blink-cue'; this.blinkCue.append(this.blinkCueText);
    for (const node of [this.layer, this.motif, this.wash, this.text, this.blinkCue]) { node.hidden = true; node.setAttribute('aria-hidden', 'true'); stage.append(node); }
  }
  get active() { return this.started && this.runtime !== null; }
  get snapshot() { return this.lastSnapshot; }
  get program() { return this.runtime?.program; }
  get voiceBusy() { return this.speechSources.length > 0; }
  get reservedBlank() { return this.active && this.nowMs >= this.overrideUntilMs && this.lastSnapshot?.state.narrationState === 'paused'; }

  async prepare(durationMs: number, intensity: number, signal: AbortSignal, imported?: BambiProgram) {
    this.stop();
    let program = ProgramSchema.parse(imported ?? withProgramTriggers(createReferenceProgram(durationMs, intensity), this.hooks.triggers()));
    if (!imported && this.hooks.haptics()) program = withHapticMappings(program);
    if (Math.abs(program.durationMs - durationMs) > 1) throw Error('Event program duration must match the chosen session duration');
    this.runtime = new EventRuntime(program);
    const epoch = this.epoch;
    const abort = () => { if (this.epoch === epoch) this.stop(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const first = this.runtime.slots[0]; if (first) await this.render(first);
      signal.throwIfAborted();
    } finally { signal.removeEventListener('abort', abort); }
  }
  start() { if (!this.runtime) return; this.started = true; this.nowMs = 0; this.displayAtMs = 0; this.pausedDisplayMs = null; this.hooks.audio().setEventMode(true); this.tick(0); this.present(0, true); }
  pause() { this.pausedDisplayMs = this.displayAtMs; this.runtime?.pause(); this.request?.abort(); this.request = null; this.hooks.clearDevices(); }
  resume() { this.pausedDisplayMs = null; this.runtime?.resume(); }
  seek(atMs: number) { this.cancelSpeech(); this.hooks.audio().stopEventCues(); this.hooks.visuals()?.clearTrigger(); this.request?.abort(); this.request = null; this.epoch++; this.overrideUntilMs = 0; this.runtime?.seek(atMs); this.nowMs = atMs; this.displayAtMs = atMs; if (this.pausedDisplayMs !== null) this.pausedDisplayMs = atMs; this.lastSnapshot = this.runtime?.snapshot(atMs) ?? null; this.hooks.clearDevices(); }

  /** Explicit user conversation interrupts the current episode, never grants a model control of events. */
  userTurn() {
    if (!this.active) return;
    const event = this.runtime!.compiled.find(c => c.event.id === this.lastSnapshot?.eventId)?.event;
    this.overrideUntilMs = event ? event.atMs + event.timing.prepMs + event.timing.activeMs + event.timing.returnMs : this.nowMs;
    this.cancelSpeech(); this.request?.abort(); this.request = null; this.epoch++;
    this.hooks.audio().stopEventCues();
    this.hooks.clearDevices(); this.resetPresentation(); this.hooks.audio().clearEventGains();
  }
  private cancelSpeech() {
    for (const source of this.speechSources) { try { source.stop(); } catch {} }
    this.speechSources = []; this.caption = null; this.cueTimes = []; this.lastCue = null; this.currentText = '';
    this.effectWindows = []; this.eyeCueRanges = [];
    this.pinkTimes = [];
  }
  stop() {
    this.epoch++; this.request?.abort(); this.request = null; this.cancelSpeech();
    const hadRuntime = this.runtime !== null;
    this.runtime?.stop(); this.runtime = null; this.started = false; this.lastSnapshot = null;
    this.payloads.clear(); this.failed.clear(); this.wordsPerMs.clear(); this.overrideUntilMs = 0; this.pausedDisplayMs = null;
    this.resetPresentation();
    if (hadRuntime) { this.hooks.audio().setEventMode(false); this.hooks.clearDevices(); }
  }
  private resetPresentation() {
    for (const node of [this.layer, this.motif, this.wash, this.text, this.blinkCue]) node.hidden = true;
    this.scanner.hidden = true;
    this.canvas.style.removeProperty('visibility'); this.canvas.style.removeProperty('filter'); this.canvas.style.removeProperty('transform');
    this.stage.style.removeProperty('--event-canvas-alpha');
    delete this.stage.dataset.event; delete this.stage.dataset.eventLayers;
    const visuals = this.hooks.visuals(); if (visuals) { visuals.fixation = 'none'; visuals.clearTrigger(); visuals.clearDescent(); visuals.clearBreath(); visuals.clearVoiceReaction(); }
    this.hooks.restore();
  }
  private async render(slot: SpeechSlot) {
    if (!this.runtime || !this.hooks.allowSpeech() || this.request || this.payloads.has(slot.payloadId) || this.failed.has(slot.payloadId)) return;
    const controller = new AbortController(), epoch = this.epoch; this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    const event = structuredClone(this.runtime.compiled.find(c => c.event.id === slot.eventId)!.event);
    // Measured pace corrects later payload word budgets; scheduled windows never change.
    for (const spec of [event.speech, event.fractionation?.speechA, event.fractionation?.speechB]) {
      if (!spec || spec.mode === 'silent') continue;
      const pace = this.wordsPerMs.get(spec.mode);
      if (pace) spec.wordTarget = Math.max(spec.requiredTrigger?.trim().split(/\s+/).length ?? 1, Math.min(spec.wordTarget ?? 500, Math.floor(pace * spec.targetMs * .85)));
    }
    const motif = this.runtime.program.motifs.find(m => m.id === (event.motifId ?? event.baseline.motifId));
    try {
      const response = await fetch('/api/events/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...this.hooks.settings(), event, payloadId: slot.payloadId, presentationPreferences: { visualsEnabled: this.hooks.allowVisuals(), reducedMotion: !!this.hooks.visuals()?.reduced }, ...(motif ? { motif } : {}) }) });
      const data: RenderedEventSpeech & { error?: string; speechBudget?: { wordsPerMs: number } } = await response.json();
      if (epoch !== this.epoch || controller.signal.aborted) return;
      if (!response.ok) {
        if (Number.isFinite(data.speechBudget?.wordsPerMs) && data.speechBudget!.wordsPerMs > 0) this.wordsPerMs.set(slot.speech.mode, data.speechBudget!.wordsPerMs);
        throw Error(data.error ?? 'Could not prepare event narration');
      }
      if (epoch !== this.epoch || controller.signal.aborted) return;
      if (data.payloadId !== slot.payloadId || typeof data.audio !== 'string' || data.audio.length > 43000000 || typeof data.text !== 'string') throw Error('Invalid event speech response');
      const bytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
      const buffer = await this.hooks.audio().context.decodeAudioData(bytes.buffer);
      if (epoch !== this.epoch || controller.signal.aborted) return;
      if (buffer.duration * 1000 > slot.speech.targetMs + 1) throw Error('Event speech exceeds its engine window');
      if (slot.speech.fixedCue && (data.text !== slot.speech.fixedCue || !Number.isFinite(data.cueOffsetMs) || data.cueOffsetMs! < 0 || data.cueOffsetMs! >= buffer.duration * 1000)) throw Error('Missing measured eye cue alignment');
      if (slot.speech.requiredTrigger && (!Number.isFinite(data.triggerOffsetMs) || data.triggerOffsetMs! < 0 || data.triggerOffsetMs! >= buffer.duration * 1000)) throw Error('Missing measured trigger alignment');
      if (buffer.duration > 0) this.wordsPerMs.set(slot.speech.mode, data.text.trim().split(/\s+/).length / (buffer.duration * 1000));
      this.payloads.set(slot.payloadId, { response: data, buffer });
    } catch (error) {
      if (epoch === this.epoch && !controller.signal.aborted) { this.failed.add(slot.payloadId); this.hooks.notice('Event narration skipped: ' + (error instanceof Error ? error.message : String(error))); }
    } finally { clearTimeout(timeout); if (this.request === controller) this.request = null; }
  }
  private speak(slot: SpeechSlot, atMs: number) {
    if (!this.hooks.allowSpeech() || slot.speech.requiredTrigger && (!this.hooks.allowTriggers() || !this.hooks.settings().allowedTriggers.includes(slot.speech.requiredTrigger))) return;
    const cached = this.payloads.get(slot.payloadId); if (!cached) { if (!this.failed.has(slot.payloadId)) this.hooks.notice('Narration was not ready for this window. The session timing continues.'); return; }
    const startMs = slot.atMs + (slot.speech.fixedCue ? slot.speech.cueAtMs! - cached.response.cueOffsetMs! : slot.speech.requiredTrigger ? slot.speech.triggerAtMs! - cached.response.triggerOffsetMs! : 0);
    // A delayed decode or aligned cue never moves a fixed trigger/window.
    if (startMs < atMs - 30 || startMs + cached.buffer.duration * 1000 > slot.endMs + 1) return;
    const engine = this.hooks.audio(), audioNow = engine.context.currentTime, start = audioNow + (startMs - atMs) / 1000;
    const deadline = audioNow + (slot.endMs - atMs) / 1000;
    this.hooks.clearSpeech(); this.cancelSpeech();
    const layers = this.lastSnapshot!.state.activeLayers;
    const buses = ['main_voice', 'left_voice', 'right_voice', 'echo_voice'] as const;
    for (const bus of buses) {
      if (!layers.includes(bus) && !(bus === 'main_voice' && layers.includes('mantra_voice'))) continue;
      const busStart = start + (bus === 'echo_voice' ? .08 : 0);
      if (busStart + cached.buffer.duration > deadline + .001) continue;
      const source = engine.playEventVoice(cached.buffer, busStart, deadline, bus); this.speechSources.push(source);
      const cleanup = source.onended; source.onended = event => { cleanup?.call(source, event); this.speechSources = this.speechSources.filter(s => s !== source); };
    }
    this.currentText = cached.response.text; this.caption = { text: this.currentText, startMs, endMs: startMs + cached.buffer.duration * 1000 };
    this.pinkTimes=this.speechSources.length?(cached.response.pinkOffsetsMs??[]).filter(ms=>Number.isFinite(ms)&&ms>=0&&ms<cached.buffer.duration*1000).map(ms=>startMs+ms):[];
    if (slot.speech.fixedCue) {
      const cueMs=slot.atMs+slot.speech.cueAtMs!, blink=this.runtime!.compiled.find(c=>c.event.id===slot.eventId)!.event.blink!;
      const step=blink.steps.find(s=>s.kind==='blink')! as Extract<typeof blink.steps[number],{kind:'blink'}>;
      this.eyeCueRanges.push({startMs:cueMs,endMs:cueMs+step.closedMs});
      if(blink.sound&&this.hooks.allowTriggerSound())engine.playEventCue('blink',audioNow+(cueMs-atMs)/1000,deadline);
    }
    const giggle = cached.response.giggleOffsetMs;
    if (this.hooks.allowTriggerSound() && Number.isFinite(giggle) && giggle! >= 0 && giggle! < cached.buffer.duration * 1000) {
      const cueMs=startMs+giggle!, endMs=Math.min(slot.endMs,cueMs+900);
      if (engine.playGiggle(audioNow+(cueMs-atMs)/1000,audioNow+(endMs-atMs)/1000)) this.effectWindows.push({startMs:cueMs-30,endMs});
    }
    if (slot.speech.requiredTrigger) {
      const cueMs = slot.atMs + slot.speech.triggerAtMs!, compiled = this.runtime!.compiled.find(c => c.event.id === slot.eventId)!;
      const boundary = compiled.frames.find(f => f.atMs > cueMs)?.atMs ?? compiled.event.atMs + compiled.event.timing.prepMs + compiled.event.timing.activeMs + compiled.event.timing.returnMs;
      this.cueTimes.push({ phrase: slot.speech.requiredTrigger, atMs: cueMs, endMs: boundary });
      if (this.hooks.allowTriggerSound()) engine.playEventTrigger(slot.speech.requiredTrigger, audioNow + (cueMs - atMs) / 1000, audioNow + (boundary - atMs) / 1000, start+cached.buffer.duration);
    }
  }
  tick(atMs: number, busy = false) {
    if (!this.active || !this.runtime) return;
    this.nowMs = atMs;
    const tick = this.runtime.tick(atMs), before = this.lastSnapshot;
    this.lastSnapshot = tick.snapshot;
    if (tick.snapshot.complete) { this.stop(); return; }
    if (tick.snapshot.paused) return;
    if (busy) {
      // Human conversation/listening can span several authored episodes. Keep its presentation
      // authoritative until the current episode ends; never allow a later blank to mute a reply.
      if (atMs >= this.overrideUntilMs) { this.userTurn(); this.overrideUntilMs = Math.max(this.overrideUntilMs, atMs + 150); }
      this.cancelSpeech(); this.request?.abort(); this.request = null; return;
    }
    if (atMs < this.overrideUntilMs) { this.cancelSpeech(); return; }
    if (this.overrideUntilMs) { this.overrideUntilMs = 0; this.hooks.clearSpeech(); }
    this.hooks.audio().setEventGains(presentationAt(tick.snapshot, this.runtime.compiled.find(c => c.event.id === tick.snapshot.eventId), atMs).gains);
    if (!this.hooks.allowSpeech()) { this.cancelSpeech(); this.request?.abort(); this.request = null; }
    if (!this.hooks.allowTriggers() && this.cueTimes.length) this.cancelSpeech();
    if (!this.hooks.allowTriggerSound()) this.hooks.audio().stopEventCues();
    else if (!this.hooks.allowTriggers()) this.hooks.audio().stopEventCues(true);
    if (tick.snapshot.state.narrationState === 'paused') {
      if (before?.state.narrationState !== 'paused') { this.cancelSpeech(); this.hooks.audio().stopEventCues(); this.hooks.clearSpeech(); this.hooks.clearDevices(); }
      this.request?.abort(); this.request = null;
    }
    if (before?.state.activeLayers.includes('haptics') && !tick.snapshot.state.activeLayers.includes('haptics')) this.hooks.clearDevices();
    if (tick.frames.some(f => f.transition.subtitle === 'clear')) this.caption = null;
    for (const slot of tick.speech) this.speak(slot, atMs);
    const engine = this.hooks.audio(), heardMs = atMs - (engine.context.currentTime - engine.outputTime) * 1000;
    for(const cueMs of this.pinkTimes.filter(ms=>ms<=heardMs))if(heardMs-cueMs<=150&&this.hooks.allowVisuals())this.hooks.pink();
    this.pinkTimes=this.pinkTimes.filter(ms=>ms>heardMs);
    for (const frame of tick.frames) if (atMs - frame.atMs <= 150 && tick.snapshot.state.activeLayers.includes('transition_sfx')) {
      const current = this.runtime.compiled.find(c => c.event.id === tick.snapshot.eventId)!;
      const kind = current.event.blink?.sound ? ({ 'blink:cue': 'blink', 'blink:long_close': 'close', 'blink:reopen': 'open' } as const)[frame.label as 'blink:cue' | 'blink:long_close' | 'blink:reopen'] : undefined;
      if (kind && !(kind === 'blink' && current.event.blink?.spoken) && this.hooks.allowTriggerSound()) engine.playEventCue(kind, engine.context.currentTime, engine.context.currentTime + (current.event.atMs + current.event.timing.activeMs - atMs) / 1000);
    }
    for (const cue of this.cueTimes.filter(c => c.atMs <= heardMs)) {
      if (this.hooks.allowTriggers() && heardMs - cue.atMs <= 150 && heardMs < cue.endMs && this.runtime.triggers.fire(cue.phrase, cue.atMs)) {
        this.lastCue = { phrase: cue.phrase, atMs: cue.atMs }; this.hooks.cue(cue.phrase);
      }
    }
    this.cueTimes = this.cueTimes.filter(c => c.atMs > heardMs);
    this.effectWindows=this.effectWindows.filter(w=>w.endMs>atMs);
    if(this.effectWindows.some(w=>atMs>=w.startMs&&atMs<w.endMs)&&tick.snapshot.state.narrationState==='speaking'&&this.hooks.allowTriggerSound()) {
      this.lastSnapshot.state.activeLayers=[...new Set([...this.lastSnapshot.state.activeLayers,'transition_sfx' as const])];
      const gains=presentationAt(tick.snapshot,this.runtime.compiled.find(c=>c.event.id===tick.snapshot.eventId),atMs).gains;
      this.hooks.audio().setEventGains({...gains,EFFECTS:.6});
    }
    for (const action of tick.haptics) if (this.hooks.haptics() && tick.snapshot.state.activeLayers.includes('haptics')) engine.onDeviceCue?.(action.command, engine.context.currentTime);
    // Late results may be cached for a future loop, but can never start expired speech.
    if (!this.request && tick.snapshot.state.narrationState === 'speaking' && !this.hooks.paused()) {
      const next = this.runtime.slots.find(s => s.atMs > atMs && s.atMs < atMs + 45000 && !this.payloads.has(s.payloadId) && !this.failed.has(s.payloadId));
      if (next) void this.render(next);
    }
    // Bound live PCM cache to current/future windows, preserving one mantra payload until its last iteration.
    const future = new Set(this.runtime.slots.filter(s => s.endMs >= atMs).map(s => s.payloadId));
    for (const id of this.payloads.keys()) if (!future.has(id)) this.payloads.delete(id);
  }
  present(atMs: number, subtitles: boolean) {
    if (!this.active || !this.runtime || !this.lastSnapshot || atMs < this.overrideUntilMs) return;
    const current = this.runtime.compiled.find(c => c.event.id === this.lastSnapshot!.eventId);
    const engine = this.hooks.audio(), heardMs = this.pausedDisplayMs ?? Math.max(0, atMs - (engine.context.currentTime - engine.outputTime) * 1000);
    this.displayAtMs = heardMs;
    const display = this.runtime.snapshot(heardMs), displayEvent = this.runtime.compiled.find(c => c.event.id === display.eventId);
    const p = presentationAt(display, displayEvent, heardMs), state = display.state;
    const visuals = this.hooks.visuals();
    if (visuals) { visuals.scene = state.scene; visuals.motion = p.motion; visuals.density = state.density.visualDensity; visuals.opacity = p.canvas; visuals.fixation = 'none'; visuals.voiceSync = false; visuals.tickSync = false; }
    const enabled = this.hooks.allowVisuals();
    this.canvas.style.visibility = enabled && p.canvas > 0 ? '' : 'hidden';
    this.canvas.style.filter = `blur(${visuals?.reduced ? 0 : p.blurPx}px)`; this.canvas.style.transform = `scale(${visuals?.reduced ? 1 : p.zoom})`;
    this.layer.hidden = !enabled || p.black === 0; this.layer.style.opacity = String(p.black);
    this.motif.hidden = !enabled || p.motif === 0; this.motif.style.opacity = String(p.motif);
    this.scanner.hidden = !enabled || !!visuals?.reduced || !p.scanner;
    if (p.scanner) { this.scanner.style.opacity = String(p.scanner.opacity); this.scanner.style.transform = `translate(-50%,-50%) translateX(${p.scanner.offset}%) rotateY(${p.scanner.rotationY}deg)`; }
    this.wash.hidden = !enabled || p.overlay === 0; this.wash.style.opacity = String(p.overlay);
    this.blinkCueText.textContent = p.blinkCue ?? '';
    this.blinkCue.hidden = !enabled || !p.blinkCue || p.blinkCue === 'BLINK' && !!displayEvent?.event.blink?.spoken && !this.eyeCueRanges.some(w=>heardMs>=w.startMs&&heardMs<w.endMs);
    const motif = this.runtime.program.motifs.find(m => m.id === (current?.event.motifId ?? state.motifId));
    this.text.textContent = p.authoredText ?? (state.activeLayers.includes('trigger_text') ? this.lastCue?.phrase ?? '' : motif?.textAnchor ?? '');
    this.text.hidden = !enabled || p.text === 0; this.text.style.opacity = String(p.text);
    if (this.lastCue && this.hooks.allowTriggers() && heardMs >= this.lastCue.atMs && heardMs < this.lastCue.atMs + Math.max(700, triggerEffectFor(this.lastCue.phrase).flash)) {
      this.text.textContent = this.lastCue.phrase; this.text.hidden = !enabled; this.text.style.opacity = '1'; this.text.classList.add('event-trigger-text');
    } else this.text.classList.remove('event-trigger-text');
    this.stage.dataset.event = this.lastSnapshot.label; this.stage.dataset.eventLayers = state.activeLayers.join(',');
    const caption = document.getElementById('caption')!, word = document.getElementById('word')!;
    caption.textContent = subtitles && this.caption && heardMs >= this.caption.startMs && heardMs < this.caption.endMs ? this.caption.text : '';
    word.textContent = '';
    const status = document.getElementById('event-status'); if (status) status.textContent = `${this.lastSnapshot.label} · ${state.activeLayers.length} layers`;
  }
}
