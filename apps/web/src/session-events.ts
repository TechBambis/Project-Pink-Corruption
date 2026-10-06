// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { eventDelivery } from '../../../packages/session-director/delivery';
import { ProgramSchema, type BambiProgram } from '../../../packages/session-director/events/contract';
import { withHapticMappings, withProgramTriggers } from '../../../packages/session-director/events/program';
import { EventRuntime, type EngineSnapshot, type SpeechSlot } from '../../../packages/session-director/events/runtime';
import { presentationAt } from '../../../packages/session-director/events/presentation';
import type { EventSpeechRequest, RenderedEventSpeech } from '../../../packages/session-director/events/speech';
import type { AudioEngine } from '../../../packages/audio';
import type { VisualEngine } from '../../../packages/visuals';
import { spokenWordAt } from './captions';
import {speechTextAt} from '../../../packages/speech/reveal';
import { AdaptiveDirector } from '../../../packages/session-director/adaptive';
import { sessionPhaseAt } from '../../../packages/session-director/phases';
import { eventDurationMs } from '../../../packages/session-director/events/contract';
import { rhythmBeats } from '../../../packages/session-director/events/rhythm';
import { SpeechReadiness, readinessDelay } from '../../../packages/session-director/events/readiness';
import { motifSvg, motifTurn, gearTurn, type MotifForm } from '../../../packages/visuals/event-motif';

type Settings = Omit<EventSpeechRequest, 'event' | 'payloadId' | 'motif'>;
interface CachedPayload { response: RenderedEventSpeech; buffer: AudioBuffer }
interface Hooks {
  audio: () => AudioEngine;
  visuals: () => VisualEngine | null;
  settings: () => Settings;
  notice: (text: string) => void;
  narration: (text: string) => void;
  displayNarration: (text: string) => void;
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
  private adaptive: AdaptiveDirector | null = null;
  private readiness = new SpeechReadiness();
  private scheduledRhythm = new Set<string>();
  private figure = document.createElement('div');
  private figureForm: MotifForm = 'ring';
  private gears: Element[] = [];
  private payloads = new Map<string, CachedPayload>();
  private failed = new Set<string>();
  private wordsPerMs = new Map<string, number>();
  private request: AbortController | null = null;
  private epoch = 0;
  private started = false;
  private lastSnapshot: EngineSnapshot | null = null;
  private currentText = '';
  private lastDeliveredText = '';
  private caption: { text: string; startMs: number; endMs: number; words?: { word: string; atMs: number }[] } | null = null;
  private eyeCueRanges: {startMs:number;endMs:number}[] = [];
  private cueTimes: { phrase: string; atMs: number; endMs: number }[] = [];
  private pinkTimes: number[] = [];
  private speechSources: AudioBufferSourceNode[] = [];
  private hapticsEnabled = false;
  private overrideUntilMs = 0;
  private nowMs = 0;
  private deliveredAtMs = -1;
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
    this.figure.className = 'event-figure'; this.figure.hidden = true; this.motif.append(this.figure);
    this.blinkCue.className = 'event-blink-cue'; this.blinkCue.append(this.blinkCueText);
    for (const node of [this.layer, this.motif, this.wash, this.text, this.blinkCue]) { node.hidden = true; node.setAttribute('aria-hidden', 'true'); stage.append(node); }
  }
  get active() { return this.started && this.runtime !== null; }
  get snapshot() { return this.lastSnapshot; }
  get program() { return this.runtime?.program; }
  get decisions() { return this.adaptive?.decisions ?? []; }
  get voiceBusy() { return this.speechSources.length > 0; }
  get narrationPending() { return this.request !== null; }
  get revealedNarration() { const c=this.caption;return c?speechTextAt(c.text,this.displayAtMs-c.startMs,c.endMs-c.startMs,c.words):null; }
  get reservedBlank() { return this.active && this.nowMs >= this.overrideUntilMs && this.lastSnapshot?.state.narrationState === 'paused'; }

  async prepare(durationMs: number, intensity: number, signal: AbortSignal, imported?: BambiProgram) {
    this.stop();
    if (!imported) this.adaptive = new AdaptiveDirector(durationMs, intensity, crypto.getRandomValues(new Uint32Array(1))[0]);
    let program = ProgramSchema.parse(imported ?? this.adaptive!.initial(this.directorOptions(0)));
    if (!imported && this.hooks.haptics()) program = withHapticMappings(program);
    if (Math.abs(program.durationMs - durationMs) > 1) throw Error('Event program duration must match the chosen session duration');
    this.runtime = new EventRuntime(program);
    const epoch = this.epoch;
    const abort = () => { if (this.epoch === epoch) this.stop(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const first = this.runtime.slots[0];
      if (first) for (let attempt = 0; attempt < 4; attempt++) {
        await this.render(first);
        signal.throwIfAborted();
        if (this.payloads.has(first.payloadId) || this.failed.has(first.payloadId)) break;
        const retryAt = this.readiness.blockedUntilMs;
        await readinessDelay(Math.max(1, retryAt - this.nowMs), signal); this.nowMs = retryAt;
      }
      if (first && this.adaptive && !this.payloads.has(first.payloadId)) this.runtime.replacePending(this.adaptive.fallback(this.runtime.compiled[0].event));
      signal.throwIfAborted();
    } finally { signal.removeEventListener('abort', abort); }
  }
  start() { if (!this.runtime) return; this.started = true; this.nowMs = 0; this.deliveredAtMs = -1; this.displayAtMs = 0; this.pausedDisplayMs = null; this.hooks.audio().setEventMode(true); this.tick(0); this.present(0, true); }
  pause() { this.pausedDisplayMs = this.displayAtMs; this.runtime?.pause(); this.request?.abort(); this.request = null; this.hooks.audio().stopEventCues(); this.scheduledRhythm.clear(); this.hooks.clearDevices(); }
  resume() { this.pausedDisplayMs = null; this.runtime?.resume(); }
  seek(atMs: number) {
    if (!Number.isFinite(atMs) || atMs < 0) throw Error('Invalid engine time');
    this.cancelSpeech(); this.hooks.audio().stopEventCues(); this.hooks.visuals()?.clearTrigger();
    this.request?.abort(); this.request = null; this.epoch++; this.overrideUntilMs = 0;
    this.scheduledRhythm.clear(); this.lastDeliveredText = ''; this.nowMs = atMs;
    if (this.adaptive && this.runtime && atMs < this.adaptive.durationMs) {
      // Generative playback has no prerecorded future to scrub. Re-enter the destination
      // parent with a silent scene, then prepare new speech; never replay an expired cue.
      const previous = this.adaptive;
      this.adaptive = new AdaptiveDirector(previous.durationMs, previous.intensity, previous.seed);
      this.readiness.clear(); this.payloads.clear(); this.failed.clear();
      const next = this.adaptive.plan(atMs, { ...this.directorOptions(atMs), speech: false, voiceAvailable: false });
      let program = ProgramSchema.parse({ version: 1, durationMs: previous.durationMs, baseline: this.runtime.program.baseline, motifs: next.motifs, events: [next.event] });
      if (this.hooks.haptics()) program = withHapticMappings(program);
      this.runtime.stop(); this.runtime = new EventRuntime(program);
    }
    this.runtime?.seek(atMs); this.deliveredAtMs = atMs; this.displayAtMs = atMs;
    if (this.pausedDisplayMs !== null) { this.pausedDisplayMs = atMs; this.runtime?.pause(); }
    this.lastSnapshot = this.runtime?.snapshot(atMs) ?? null; this.hooks.clearDevices();
  }

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
    this.speechSources = []; this.caption = null; this.cueTimes = []; this.currentText = '';
    this.effectWindows = []; this.eyeCueRanges = [];
    this.pinkTimes = [];
  }
  stop() {
    this.epoch++; this.request?.abort(); this.request = null; this.cancelSpeech();
    const hadRuntime = this.runtime !== null;
    this.runtime?.stop(); this.runtime = null; this.started = false; this.lastSnapshot = null;
    this.adaptive = null; this.readiness.clear(); this.scheduledRhythm.clear();
    this.lastDeliveredText = ''; this.deliveredAtMs = -1;
    this.payloads.clear(); this.failed.clear(); this.wordsPerMs.clear(); this.overrideUntilMs = 0; this.pausedDisplayMs = null;
    this.resetPresentation();
    if (hadRuntime) { this.hooks.audio().setEventMode(false); this.hooks.clearDevices(); }
  }
  private resetPresentation() {
    for (const node of [this.layer, this.motif, this.wash, this.text, this.blinkCue]) node.hidden = true;
    this.scanner.hidden = true;
    this.figure.hidden = true;
    this.canvas.style.removeProperty('visibility'); this.canvas.style.removeProperty('filter'); this.canvas.style.removeProperty('transform');
    this.stage.style.removeProperty('--event-canvas-alpha');
    delete this.stage.dataset.event; delete this.stage.dataset.eventLayers;
    const visuals = this.hooks.visuals(); if (visuals) { visuals.fixation = 'none'; visuals.clearTrigger(); visuals.clearDescent(); visuals.clearBreath(); visuals.clearVoiceReaction(); }
    this.hooks.restore();
  }
  private async render(slot: SpeechSlot) {
    if (!this.runtime || !this.hooks.allowSpeech() || this.request || this.payloads.has(slot.payloadId) || this.failed.has(slot.payloadId) || !this.readiness.canRequest(slot.payloadId, this.nowMs)) return;
    const settings = this.hooks.settings();
    const controller = new AbortController(), epoch = this.epoch; this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    const event = structuredClone(this.runtime.compiled.find(c => c.event.id === slot.eventId)!.event);
    // Measured pace corrects later payload word budgets; scheduled windows never change.
    for (const spec of [event.speech, event.fractionation?.speechA, event.fractionation?.speechB]) {
      if (!spec || spec.mode === 'silent') continue;
      const pace = this.wordsPerMs.get(`${spec.mode}:${spec.delivery??eventDelivery(spec.mode,event.phase)}:${settings.speed}:${settings.voice}:${settings.preset}`);
      if (pace) spec.wordTarget = Math.max(spec.requiredTrigger?.trim().split(/\s+/).length ?? 1, Math.min(spec.wordTarget ?? 500, Math.floor(pace * spec.targetMs * .85)));
    }
    const motif = this.runtime.program.motifs.find(m => m.id === (event.motifId ?? event.baseline.motifId));
    try {
      const response = await fetch('/api/events/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...settings, event, payloadId: slot.payloadId, precedingNarration: this.lastDeliveredText.slice(-1200), presentationPreferences: { visualsEnabled: this.hooks.allowVisuals(), reducedMotion: !!this.hooks.visuals()?.reduced }, ...(motif ? { motif } : {}) }) });
      const data: RenderedEventSpeech & { error?: string; speechBudget?: { wordsPerMs: number } } = await response.json();
      if (epoch !== this.epoch || controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 429 || /HTTP 429|renderer is busy/i.test(data.error ?? '')) {
          if (this.readiness.busy(slot.payloadId, this.nowMs, this.started ? slot.atMs - 300 : Infinity)) return;
        }
        if (Number.isFinite(data.speechBudget?.wordsPerMs) && data.speechBudget!.wordsPerMs > 0) this.wordsPerMs.set(`${slot.speech.mode}:${slot.speech.delivery??eventDelivery(slot.speech.mode,event.phase)}:${settings.speed}:${settings.voice}:${settings.preset}`, data.speechBudget!.wordsPerMs);
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
      if (buffer.duration > 0) this.wordsPerMs.set(`${slot.speech.mode}:${slot.speech.delivery??eventDelivery(slot.speech.mode,event.phase)}:${settings.speed}:${settings.voice}:${settings.preset}`, data.text.trim().split(/\s+/).length / (buffer.duration * 1000));
      this.payloads.set(slot.payloadId, { response: data, buffer });
      this.readiness.succeeded(slot.payloadId);
    } catch (error) {
      if (epoch === this.epoch && !controller.signal.aborted) { this.failed.add(slot.payloadId); this.hooks.notice('Event narration skipped: ' + (error instanceof Error ? error.message : String(error))); }
    } finally { clearTimeout(timeout); if (this.request === controller) this.request = null; }
  }
  private directorOptions(atMs: number) {
    const current = sessionPhaseAt(atMs / 1000, (this.adaptive?.durationMs ?? this.runtime?.program.durationMs ?? 1) / 1000), eligible = this.hooks.triggers();
    return { speech: this.hooks.allowSpeech(), visuals: this.hooks.allowVisuals(), reducedMotion: !!this.hooks.visuals()?.reduced,
      voiceAvailable: this.nowMs >= this.readiness.blockedUntilMs,
      triggers: typeof eligible === 'function' ? eligible(current.phase, current.progress * 100) : eligible[current.phase] ?? [] };
  }
  private advancePlan(atMs: number, busy: boolean) {
    if (!this.started || !this.adaptive || !this.runtime || busy || this.hooks.paused() || atMs >= this.adaptive.durationMs) return;
    const playing = this.runtime.compiled.find(c => c.event.atMs <= atMs && atMs < c.event.atMs + eventDurationMs(c.event));
    if (playing) this.adaptive.observe(playing.event, this.runtime.snapshot(atMs).state, atMs, this.hooks.allowVisuals(), this.voiceBusy);
    // Check against the last delivered tick as well: a suspended tab may jump over entry.
    const pending = this.runtime.compiled.find(c => c.event.atMs > (this.lastSnapshot ? this.deliveredAtMs : -1) && c.event.atMs + eventDurationMs(c.event) > atMs);
    if (pending) {
      if (pending.event.atMs - atMs <= 300 && pending.speech.some(s => !this.payloads.has(s.payloadId))) {
        this.epoch++; this.request?.abort(); this.request = null;
        this.runtime.replacePending(this.adaptive.fallback(pending.event));
      }
      return;
    }
    const end = this.runtime.compiled.at(-1)!, nextMs = Math.max(atMs + 300, end.event.atMs + eventDurationMs(end.event));
    if (nextMs > atMs + 45000 || nextMs >= this.adaptive.durationMs) return;
    const next = this.adaptive.plan(nextMs, this.directorOptions(nextMs));
    let event = next.event;
    if (this.hooks.haptics()) event = withHapticMappings({ version: 1, durationMs: this.adaptive.durationMs, baseline: this.runtime.program.baseline, motifs: [...new Map([...this.runtime.program.motifs, ...next.motifs].map(m => [m.id, m])).values()], events: [event] }).events[0];
    this.runtime.append(event, next.motifs);
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
    if (!this.speechSources.length) return;
    // The payload's measured cue offset has already aligned audio to this compiled word time.
    if (this.hooks.haptics()) {
      const compiled = this.runtime!.compiled.find(c => c.event.id === slot.eventId)!;
      for (const action of compiled.event.haptics.filter(a => a.speechSlotId === slot.id)) {
        const cueMs = compiled.event.atMs + action.offsetMs;
        if (this.runtime!.snapshot(cueMs).state.activeLayers.includes('haptics')) engine.onDeviceCue?.(action.command, audioNow + (cueMs - atMs) / 1000, action.command.operation === 'buzz' ? 'speech' : undefined);
      }
    }
    this.currentText = cached.response.text; this.caption = { text: this.currentText, startMs, endMs: startMs + cached.buffer.duration * 1000, words: cached.response.words };
    // Publish the delivered narration, never a prefetched future episode.
    if (this.speechSources.length) { this.lastDeliveredText = this.currentText; this.hooks.narration(this.currentText); }
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
    this.nowMs = atMs;
    this.advancePlan(atMs, busy);
    if (!this.active || !this.runtime) return;
    this.nowMs = atMs;
    const tick = this.runtime.tick(atMs), before = this.lastSnapshot;
    this.lastSnapshot = tick.snapshot;
    if (tick.snapshot.complete) { this.stop(); return; }
    if (tick.snapshot.paused) return;
    this.deliveredAtMs = atMs;
    const hapticsEnabled = this.hooks.haptics();
    if (this.hapticsEnabled && !hapticsEnabled) this.hooks.clearDevices();
    this.hapticsEnabled = hapticsEnabled;
    if (busy) {
      // Human conversation/listening can span several authored episodes. Keep its presentation
      // authoritative until the current episode ends; never allow a later blank to mute a reply.
      if (atMs >= this.overrideUntilMs) { this.userTurn(); this.overrideUntilMs = Math.max(this.overrideUntilMs, atMs + 150); }
      this.cancelSpeech(); this.request?.abort(); this.request = null; return;
    }
    if (atMs < this.overrideUntilMs) { this.cancelSpeech(); return; }
    if (this.overrideUntilMs) { this.overrideUntilMs = 0; this.hooks.clearSpeech(); }
    this.hooks.audio().setEventGains(presentationAt(tick.snapshot, this.runtime.compiled.find(c => c.event.id === tick.snapshot.eventId), atMs).gains);
    if (!this.hooks.allowSpeech()) { if (this.voiceBusy) this.hooks.clearDevices(); this.cancelSpeech(); this.request?.abort(); this.request = null; }
    if (!this.hooks.allowTriggers() && this.cueTimes.length) { this.hooks.clearDevices(); this.cancelSpeech(); }
    if (!this.hooks.allowTriggerSound()) this.hooks.audio().stopEventCues();
    else if (!this.hooks.allowTriggers()) this.hooks.audio().stopEventCues(true);
    if (tick.snapshot.state.narrationState === 'paused') {
      if (before?.state.narrationState !== 'paused') { this.cancelSpeech(); this.hooks.audio().stopEventCues(); this.hooks.clearSpeech(); this.hooks.clearDevices(); }
      if (!this.adaptive) { this.request?.abort(); this.request = null; }
    }
    if (before?.state.activeLayers.includes('haptics') && !tick.snapshot.state.activeLayers.includes('haptics')) this.hooks.clearDevices();
    if (tick.frames.some(f => f.transition.subtitle === 'clear')) this.caption = null;
    for (const slot of tick.speech) this.speak(slot, atMs);
    const rhythmEvent = this.runtime.compiled.find(c => c.event.id === tick.snapshot.eventId)?.event;
    if (rhythmEvent?.rhythm && this.hooks.allowTriggerSound() && !this.hooks.paused()) {
      for (const beat of rhythmBeats(rhythmEvent)) {
        const key = `${rhythmEvent.id}:${beat.atMs}`;
        if (beat.atMs < atMs || beat.atMs > atMs + 250 || this.scheduledRhythm.has(key)) continue;
        const boundCues = this.runtime.slots.filter(s => s.eventId === rhythmEvent.id && s.speech.requiredTrigger).map(s => s.atMs + s.speech.triggerAtMs!);
        this.scheduledRhythm.add(key);
        if (boundCues.some(cue => Math.abs(cue - beat.atMs) < 400)) continue;
        const audioNow = this.hooks.audio().context.currentTime;
        this.hooks.audio().playEventCue(beat.kind, audioNow + (beat.atMs - atMs) / 1000, audioNow + (rhythmEvent.atMs + eventDurationMs(rhythmEvent) - atMs) / 1000);
      }
    }
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
        this.hooks.cue(cue.phrase);
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
    if (!this.request && (this.adaptive || tick.snapshot.state.narrationState === 'speaking') && !this.hooks.paused()) {
      const next = this.runtime.slots.find(s => s.atMs > atMs && s.atMs < atMs + 45000 && !this.payloads.has(s.payloadId) && !this.failed.has(s.payloadId) && this.readiness.canRequest(s.payloadId, atMs));
      if (next) void this.render(next);
    }
    // Bound live PCM cache to current/future windows, preserving one mantra payload until its last iteration.
    const future = new Set(this.runtime.slots.filter(s => s.endMs >= atMs).map(s => s.payloadId));
    for (const id of this.payloads.keys()) if (!future.has(id)) this.payloads.delete(id);
    for (const id of this.failed) if (!future.has(id)) this.failed.delete(id);
    this.readiness.prune(future);
    for (const key of this.scheduledRhythm) if (Number(key.slice(key.lastIndexOf(':') + 1)) < atMs - 500) this.scheduledRhythm.delete(key);
  }
  present(atMs: number, subtitles: boolean) {
    if (!this.active || !this.runtime || !this.lastSnapshot || atMs < this.overrideUntilMs) return;
    const current = this.runtime.compiled.find(c => c.event.id === this.lastSnapshot!.eventId);
    const engine = this.hooks.audio(), heardMs = this.pausedDisplayMs ?? Math.max(0, atMs - (engine.context.currentTime - engine.outputTime) * 1000);
    this.displayAtMs = heardMs;
    const revealed=this.revealedNarration;if(revealed!==null)this.hooks.displayNarration(revealed);
    const display = this.runtime.snapshot(heardMs), displayEvent = this.runtime.compiled.find(c => c.event.id === display.eventId);
    const p = presentationAt(display, displayEvent, heardMs), state = display.state;
    const visuals = this.hooks.visuals();
    if (visuals) { visuals.scene = state.scene; visuals.motion = p.motion; visuals.density = state.density.visualDensity; visuals.opacity = p.canvas; visuals.fixation = 'none'; visuals.voiceSync = false; visuals.tickSync = false; }
    const enabled = this.hooks.allowVisuals();
    this.canvas.style.visibility = enabled && p.canvas > 0 ? '' : 'hidden';
    this.canvas.style.filter = `blur(${visuals?.reduced ? 0 : p.blurPx}px)`; this.canvas.style.transform = `scale(${visuals?.reduced ? 1 : p.zoom})`;
    this.layer.hidden = !enabled || p.black === 0; this.layer.style.opacity = String(p.black);
    this.motif.hidden = !enabled || p.motif === 0; this.motif.style.opacity = String(p.motif);
    const form = state.motifForm ?? 'ring';
    if (form !== this.figureForm) { this.figureForm = form; this.figure.innerHTML = form === 'ring' ? '' : motifSvg(form); this.gears = Array.from(this.figure.querySelectorAll('[data-gear]')); }
    this.motif.dataset.form = form; this.figure.hidden = form === 'ring';
    this.figure.style.transform = `translate(-50%,-50%) rotateY(${motifTurn(form, heardMs, !!visuals?.reduced || state.visualState === 'sparse')}deg)`;
    for (const gear of this.gears) gear.setAttribute('transform', `rotate(${gearTurn(heardMs, Number(gear.getAttribute('data-radius')), Number(gear.getAttribute('data-direction')), !!visuals?.reduced || state.visualState === 'sparse')})`);
    this.scanner.hidden = !enabled || !!visuals?.reduced || !p.scanner;
    if (p.scanner) { this.scanner.style.opacity = String(p.scanner.opacity); this.scanner.style.transform = `translate(-50%,-50%) translateX(${p.scanner.offset}%) rotateY(${p.scanner.rotationY}deg)`; }
    this.wash.hidden = !enabled || p.overlay === 0; this.wash.style.opacity = String(p.overlay);
    this.blinkCueText.textContent = p.blinkCue ?? '';
    this.blinkCue.hidden = !enabled || !p.blinkCue || p.blinkCue === 'BLINK' && !!displayEvent?.event.blink?.spoken && !this.eyeCueRanges.some(w=>heardMs>=w.startMs&&heardMs<w.endMs);
    const motif = this.runtime.program.motifs.find(m => m.id === (current?.event.motifId ?? state.motifId));
    this.text.textContent = p.authoredText ?? (state.activeLayers.includes('trigger_text') ? '' : motif?.textAnchor ?? '');
    this.text.hidden = !enabled || p.text === 0; this.text.style.opacity = String(p.text);
    this.stage.dataset.event = this.lastSnapshot.label; this.stage.dataset.eventLayers = state.activeLayers.join(',');
    const caption = document.getElementById('caption')!, word = document.getElementById('word')!;
    caption.textContent = '';
    word.textContent = subtitles && this.caption ? spokenWordAt(this.caption.text, heardMs - this.caption.startMs, this.caption.endMs - this.caption.startMs, this.caption.words) : '';
    const status = document.getElementById('event-status'); if (status) status.textContent = `${this.lastSnapshot.label} · ${state.activeLayers.length} layers`;
  }
}
