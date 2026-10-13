// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { eventDelivery } from '../../../packages/session-director/delivery';
import { ProgramSchema, parentPhaseMs, type BambiProgram } from '../../../packages/session-director/events/contract';
import {ResponsePresentation} from './trigger-presentation';
import { withHapticMappings, withProgramTriggers } from '../../../packages/session-director/events/program';
import { compileEvent, EventRuntime, type EngineSnapshot, type SpeechSlot } from '../../../packages/session-director/events/runtime';
import { presentationAt } from '../../../packages/session-director/events/presentation';
import type { EventSpeechRequest, RenderedEventSpeech } from '../../../packages/session-director/events/speech';
import {localContextRequest} from './privacy-state';
import type { AudioEngine } from '../../../packages/audio';
import type { VisualEngine } from '../../../packages/visuals';
import { spokenWordAt } from './captions';
import { OutputEvidence, type OutputOccurrence } from '../../../packages/speech/output-evidence';
import {speechTextAt} from '../../../packages/speech/reveal';
import { AdaptiveDirector } from '../../../packages/session-director/adaptive';
import { directionPreset, type SessionDirection } from '../../../packages/session-director/direction';
import { sessionPhaseAt } from '../../../packages/session-director/phases';
import { eventDurationMs } from '../../../packages/session-director/events/contract';
import { rhythmBeats } from '../../../packages/session-director/events/rhythm';
import { SpeechReadiness, readinessDelay } from '../../../packages/session-director/events/readiness';
import { motifSvg, motifTurn, gearTurn, type MotifForm } from '../../../packages/visuals/event-motif';
import {drawHeart} from '../../../packages/visuals/heart';
import { RegieMemory } from '../../../packages/session-director/regie/planner';
import { directionPool } from '../../../packages/session-director/regie/registry';
import { validateScenePlan, type PlanningContext } from '../../../packages/session-director/regie/plan';
import type { CompiledScene } from '../../../packages/session-director/regie/compiler';
import { placePreparedScene } from '../../../packages/session-director/regie/placement';
import {PlayfulInteraction,ChallengeWindowSchema} from '../../../packages/session-director/regie/interaction';

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
  cue: (phrase: string, ownsPresentation?: boolean) => void;
  pink: () => void;
  allowVisuals: () => boolean;
  paused: () => boolean;
  triggers: () => Parameters<typeof withProgramTriggers>[1];
  haptics: () => boolean;
  restore: () => void;
  allowSpeech: () => boolean;
  allowTriggers: () => boolean;
  allowTriggerSound: () => boolean;
  regieSounds?:()=>{wiper:boolean;snap:boolean;rhythm:boolean};
  regieBreathing?:()=>boolean;
}

/** Browser adapter for the existing session clock. HTTP results never mutate event timing. */
export class SessionEvents {
  private response:ResponsePresentation;
  private runtime: EventRuntime | null = null;
  private adaptive: AdaptiveDirector | null = null;
  private regieMemory=new RegieMemory();
  private playfulInteraction=new PlayfulInteraction();
  private regieDirection:SessionDirection|null=null;
  private regieRetryAtMs=0;
  private regieAccessSignature='';
  private regiePlans:{id:string;strategy:string;rationale:string;fromMs:number;toMs:number}[]=[];
  private readiness = new SpeechReadiness();
  private scheduledRhythm = new Set<string>();
  private scheduledSleep = new Set<string>();
  private figure = document.createElement('div');
  private figureForm: MotifForm = 'ring';
  private heart:HTMLCanvasElement|null=null;
  private heartAtMs=-Infinity;
  private gears: Element[] = [];
  private surround=document.createElement('div');
  private surroundGears:Element[]=[];
  private payloads = new Map<string, CachedPayload>();
  private preparedPayloads = new Map<string, CachedPayload>();
  private failed = new Set<string>();
  private wordsPerMs = new Map<string, number>();
  private request: AbortController | null = null;
  private epoch = 0;
  private evidence = new OutputEvidence();
  private occurrenceCounter = 0;
  private occurrence: OutputOccurrence | null = null;
  private importantPayloads = new Set<string>();
  private liveWindows = new Map<string, number>();
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
    this.response=new ResponsePresentation(stage);
    this.layer.className = 'event-black'; this.motif.className = 'event-motif';
    this.wash.className = 'event-wash'; this.text.className = 'event-text';
    this.surround.className='event-surround';this.surround.hidden=true;this.motif.append(this.surround);
    const orb = document.createElement('div'); orb.className = 'event-orb'; this.motif.append(orb);
    this.scanner.className = 'event-scanner'; this.scanner.hidden = true; orb.append(this.scanner);
    this.figure.className = 'event-figure'; this.figure.hidden = true; this.motif.append(this.figure);
    this.blinkCue.className = 'event-blink-cue'; this.blinkCue.append(this.blinkCueText);
    for (const node of [this.layer, this.motif, this.wash, this.text, this.blinkCue]) { node.hidden = true; node.setAttribute('aria-hidden', 'true'); stage.append(node); }
  }
  get active() { return this.started && this.runtime !== null; }
  get snapshot() { return this.lastSnapshot; }
  get program() { return this.runtime?.program; }
  get outputEvidence() { return this.evidence.snapshot(); }
  get decisions() { return this.adaptive?.decisions ?? []; }
  get scenePlans(){return [...this.regiePlans];}
  private get regieEnabled(){return !!this.regieDirection?.regie?.enabled&&this.hooks.allowSpeech();}
  get acceptsRegieInput(){return this.active&&this.regieEnabled&&this.regieDirection?.regie?.interactive!==false&&this.adaptive?.phaseAt(this.nowMs).phase!=='awakening';}
  get interactionContext(){return this.playfulInteraction.context;}
  get interactionCapturing(){return this.playfulInteraction.capturing;}
  private heardMs(atMs:number){const engine=this.hooks.audio();return this.pausedDisplayMs??Math.max(0,atMs-(engine.context.currentTime-engine.outputTime)*1000);}
  beginInteractionResponse(atMs:number){
    if(this.active&&this.playfulInteraction.begin(this.heardMs(atMs)))return true;
    // An ordinary utterance that started before the invitation finished must
    // not become a challenge answer merely because recognition finishes later.
    if(this.playfulInteraction.unresolved&&!this.playfulInteraction.capturing)this.playfulInteraction.clear();
    return false;
  }
  cancelInteractionCapture(){this.playfulInteraction.cancelCapture();}
  get voiceBusy() { return this.speechSources.length > 0; }
  get narrationPending() { return this.request !== null; }
  listenerResponseAt(atMs:number){
    if(!this.active)return false;
    const engine=this.hooks.audio(),heardMs=this.pausedDisplayMs??Math.max(0,atMs-(engine.context.currentTime-engine.outputTime)*1000);
    return this.runtime!.program.responseWindows?.some(w=>heardMs>=w.fromMs&&heardMs<w.toMs)||false;
  }
  get revealedNarration() { const c=this.caption;return c?speechTextAt(c.text,this.displayAtMs-c.startMs,c.endMs-c.startMs,c.words):null; }
  get reservedBlank() { return this.active && this.nowMs >= this.overrideUntilMs && this.lastSnapshot?.state.narrationState === 'paused'; }

  configureDirection(direction: SessionDirection, intensity: number) {
    if(!this.adaptive)return; // An imported program retains authored ownership.
    const signature=JSON.stringify({speech:this.hooks.allowSpeech(),visuals:this.hooks.allowVisuals(),reduced:this.hooks.visuals()?.reduced,triggers:this.hooks.allowTriggers(),sounds:this.hooks.regieSounds?.(),settings:this.hooks.settings()});
    if(this.regieDirection&&(JSON.stringify(direction)!==JSON.stringify(this.regieDirection)||this.adaptive.intensity!==intensity||this.regieDirection.regie?.enabled&&this.regieAccessSignature&&signature!==this.regieAccessSignature)){
      this.request?.abort();this.request=null;this.epoch++;this.regieMemory.invalidate();this.runtime?.discardFuture(Math.max(0,this.nowMs));this.regieRetryAtMs=0;
      this.playfulInteraction.clear();
    }
    this.regieAccessSignature=signature;this.regieDirection=direction;this.adaptive.configure(direction, intensity);
  }
  async prepare(durationMs: number, intensity: number, signal: AbortSignal, imported?: BambiProgram, continuous=false, direction = directionPreset('balanced'), prepared?: { payloads: RenderedEventSpeech[]; importantPayloads?: string[]; liveWindows?: {payloadId:string;readyAfterMs:number}[] }) {
    this.stop();
    this.regieDirection=imported?null:direction;
    if (!imported) this.adaptive = new AdaptiveDirector(durationMs, intensity, crypto.getRandomValues(new Uint32Array(1))[0],continuous,direction);
    let program = ProgramSchema.parse(imported ?? this.adaptive!.initial(this.directorOptions(0)));
    if(!imported&&this.regieEnabled)program=ProgramSchema.parse({...program,events:[],motifs:[]});
    if (!imported && this.hooks.haptics()) program = withHapticMappings(program);
    if (Math.abs(program.durationMs - durationMs) > 1) throw Error('Event program duration must match the chosen session duration');
    this.runtime = new EventRuntime(program);
    this.importantPayloads = new Set(prepared?.importantPayloads ?? []);
    if ((prepared?.liveWindows?.length ?? 0)>1) throw Error('Reference scene permits one live connection');
    for(const window of prepared?.liveWindows??[]) {
      const slot=this.runtime.slots.find(s=>s.payloadId===window.payloadId);
      if(!slot||!Number.isFinite(window.readyAfterMs)||window.readyAfterMs<0||window.readyAfterMs>=slot.atMs-150)throw Error('Invalid live preparation boundary');
    }
    this.liveWindows = new Map(prepared?.liveWindows?.map(w=>[w.payloadId,w.readyAfterMs]) ?? []);
    const epoch = this.epoch;
    const abort = () => { if (this.epoch === epoch) this.stop(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      if(this.regieEnabled&&!imported)await this.prepareScene(0,signal,true);
      if (prepared) {
        if (prepared.payloads.length > 64 || prepared.payloads.reduce((total,p)=>total+p.audio.length,0)>32000000 || (prepared.importantPayloads?.length??0)>64) throw Error('Prepared payload cap exceeded');
        for (const response of prepared.payloads) {
          const slot = this.runtime.slots.find(s => s.payloadId === response.payloadId);
          if (!slot || this.payloads.has(response.payloadId) || response.audio.length > 43000000) throw Error('Invalid prepared payload');
          const bytes = Uint8Array.from(atob(response.audio), c => c.charCodeAt(0));
          const buffer = await this.hooks.audio().context.decodeAudioData(bytes.buffer);
          signal.throwIfAborted(); if (epoch !== this.epoch) return;
          if (Math.abs(buffer.duration * 1000 - response.durationMs) > 1 || buffer.duration * 1000 > slot.speech.targetMs + 1) throw Error('Prepared audio exceeds measured window');
          this.payloads.set(response.payloadId, {response, buffer});
          this.preparedPayloads.set(response.payloadId, {response, buffer});
        }
      }
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
  pause() { this.pausedDisplayMs = this.displayAtMs; this.runtime?.pause(); this.request?.abort(); this.request = null; this.hooks.audio().stopEventCues(false, true); this.scheduledRhythm.clear(); this.hooks.clearDevices(); }
  resume() { this.pausedDisplayMs = null; this.runtime?.resume(); }
  seek(atMs: number) {
    if (!Number.isFinite(atMs) || atMs < 0) throw Error('Invalid engine time');
    this.cancelSpeech(); this.hooks.audio().stopEventCues(); this.hooks.visuals()?.clearTrigger();
    this.request?.abort(); this.request = null; this.epoch++; this.overrideUntilMs = 0;
    this.evidence.reset(this.epoch); this.occurrence = null;
    this.scheduledRhythm.clear(); this.lastDeliveredText = ''; this.nowMs = atMs;
    this.scheduledSleep.clear();
    if(this.regieEnabled&&this.runtime){
      const program=this.runtime.program;this.runtime.stop();this.runtime=new EventRuntime({...program,events:[],motifs:[],responseWindows:[],responsePrompts:[]});
      this.regieMemory.reset();this.payloads.clear();this.preparedPayloads.clear();this.failed.clear();this.regieRetryAtMs=0;
      this.playfulInteraction.clear();
    }
    if (!this.regieEnabled&&this.adaptive && this.runtime && !this.adaptive.complete(atMs)) {
      // Generative playback has no prerecorded future to scrub. Re-enter the destination
      // parent with a silent scene, then prepare new speech; never replay an expired cue.
      const previous = this.adaptive;
      this.adaptive = new AdaptiveDirector(previous.durationMs, previous.intensity, previous.seed,previous.continuous,previous.settings);
      this.readiness.clear(); this.payloads.clear(); this.failed.clear();
      const next = this.adaptive.plan(atMs, { ...this.directorOptions(atMs), speech: false, voiceAvailable: false });
      let program = ProgramSchema.parse({ version: 1, durationMs: previous.durationMs, ...(previous.continuous?{continuous:true}:{}), baseline: this.runtime.program.baseline, motifs: next.motifs, events: [next.event] });
      if (this.hooks.haptics()) program = withHapticMappings(program);
      this.runtime.stop(); this.runtime = new EventRuntime(program);
    }
    if (!this.adaptive && this.preparedPayloads.size) {
      const future=new Set(this.runtime?.slots.filter(s=>s.atMs>=atMs).map(s=>s.payloadId));
      this.payloads=new Map([...this.preparedPayloads].filter(([id])=>future.has(id)));this.failed.clear();this.readiness.clear();
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
    if(this.regieEnabled){this.regieMemory.invalidate();this.runtime!.discardFuture(Math.max(0,this.nowMs));this.regieRetryAtMs=0;}
    this.evidence.reset(this.epoch);
    this.hooks.audio().stopEventCues();
    this.scheduledSleep.clear();
    this.hooks.clearDevices(); this.resetPresentation(); this.hooks.audio().clearEventGains();
  }
  feedback(text:string,liveReply=false){
    if(!this.acceptsRegieInput||!text.trim())return false;
    const scheduled=this.playfulInteraction.scheduled,received=this.playfulInteraction.receive(text,this.heardMs(this.nowMs));
    if(received&&scheduled)this.runtime!.finishListeningWindow(scheduled.responseEventId,this.nowMs);
    else if(scheduled)this.playfulInteraction.clear();
    this.regieMemory.feedback(text);this.userTurn();if(received)this.overrideUntilMs=this.nowMs;
    return !liveReply||received;
  }
  /** Resume only after the direct response has finished on the output clock. */
  finishUserTurn(){if(this.active&&this.regieEnabled)this.overrideUntilMs=Math.min(this.overrideUntilMs,this.nowMs);}
  get heardSceneText(){return this.heardNarration().slice(-6000);}
  private cancelSpeech() {
    this.lastDeliveredText = this.heardNarration();
    this.occurrence = null;
    this.hooks.audio().setNarrationDelivery();
    this.hooks.audio().stopEventBreaths?.();this.hooks.visuals()?.clearBreath();
    for (const source of this.speechSources) { try { source.stop(); } catch {} }
    this.speechSources = []; this.caption = null; this.cueTimes = []; this.currentText = '';
    this.effectWindows = []; this.eyeCueRanges = [];
    this.pinkTimes = [];
  }
  private heardNarration() {
    if (!this.occurrence) return this.lastDeliveredText;
    const output = this.evidence.sample(this.occurrence.id, this.hooks.audio().outputTime, this.epoch);
    return output?.history || this.lastDeliveredText;
  }

  stop() {
    this.epoch++; this.request?.abort(); this.request = null; this.cancelSpeech();
    const hadRuntime = this.runtime !== null;
    this.runtime?.stop(); this.runtime = null; this.started = false; this.lastSnapshot = null;
    this.adaptive = null; this.readiness.clear(); this.scheduledRhythm.clear();this.scheduledSleep.clear();
    this.regieDirection=null;this.regieMemory.reset();this.regiePlans=[];this.regieRetryAtMs=0;this.regieAccessSignature='';
    this.playfulInteraction.clear();
    this.lastDeliveredText = ''; this.deliveredAtMs = -1;
    this.evidence.reset(this.epoch); this.occurrence = null; this.importantPayloads.clear(); this.liveWindows.clear();
    this.payloads.clear(); this.preparedPayloads.clear(); this.failed.clear(); this.wordsPerMs.clear(); this.overrideUntilMs = 0; this.pausedDisplayMs = null;
    this.resetPresentation();
    if (hadRuntime) { this.hooks.audio().setEventMode(false); this.hooks.clearDevices(); }
  }
  private resetPresentation() {
    this.response.clear();
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
    if (this.nowMs < (this.liveWindows.get(slot.payloadId) ?? 0) || this.started && this.liveWindows.has(slot.payloadId) && this.nowMs >= slot.atMs - 150) return;
    if (!this.runtime || !this.hooks.allowSpeech() || this.request || this.payloads.has(slot.payloadId) || this.failed.has(slot.payloadId) || !this.readiness.canRequest(slot.payloadId, this.nowMs)) return;
    const settings = this.hooks.settings();
    const controller = new AbortController(), epoch = this.epoch, requestId = crypto.randomUUID(); this.request = controller;
    const waitMs=this.liveWindows.has(slot.payloadId)&&this.started?Math.max(1,Math.min(90000,slot.atMs-this.nowMs-150)):90000;
    const timeout = setTimeout(() => controller.abort(), waitMs);
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
        body: JSON.stringify({ ...settings,localContext:localContextRequest(), event, requestId, payloadId: slot.payloadId, precedingNarration: this.heardNarration().slice(-1200), presentationPreferences: { visualsEnabled: this.hooks.allowVisuals(), reducedMotion: !!this.hooks.visuals()?.reduced, effectsEnabled: this.hooks.allowTriggerSound() && this.hooks.audio().wiperEnabled }, ...(motif ? { motif } : {}) }) });
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
      if (data.requestId !== undefined && data.requestId !== requestId || data.payloadId !== slot.payloadId || typeof data.audio !== 'string' || data.audio.length > 43000000 || typeof data.text !== 'string') throw Error('Invalid event speech response');
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
    const current = this.adaptive?.phaseAt(atMs) ?? sessionPhaseAt(atMs / 1000, (this.runtime?.program.durationMs ?? 1) / 1000), eligible = this.hooks.triggers();
    return { speech: this.hooks.allowSpeech(), visuals: this.hooks.allowVisuals(), reducedMotion: !!this.hooks.visuals()?.reduced,
      voiceAvailable: this.nowMs >= this.readiness.blockedUntilMs,
      triggers: typeof eligible === 'function' ? eligible(current.phase, current.progress * 100) : eligible[current.phase] ?? [] };
  }
  private advancePlan(atMs: number, busy: boolean) {
    if (!this.started || !this.adaptive || !this.runtime || busy || this.hooks.paused() || this.adaptive.complete(atMs)) return;
    if(this.adaptive.phaseAt(atMs).phase==='awakening')this.playfulInteraction.clear();
    if(this.regieEnabled&&this.adaptive.phaseAt(atMs).phase!=='awakening'){
      const heardMs=Math.max(0,atMs-(this.hooks.audio().context.currentTime-this.hooks.audio().outputTime)*1000);
      this.regieMemory.observe(heardMs,this.heardNarration());
      this.playfulInteraction.expire(heardMs);
      if(this.playfulInteraction.unresolved)return;
      const end=this.runtime.compiled.at(-1),nextMs=Math.max(atMs+700,end?end.event.atMs+eventDurationMs(end.event):atMs+700);
      if(!this.request&&atMs>=this.regieRetryAtMs&&nextMs<atMs+45000&&atMs>=this.overrideUntilMs)void this.prepareScene(nextMs);
      return;
    }
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
    if (nextMs > atMs + 45000 || this.adaptive.complete(nextMs)) return;
    const next = this.adaptive.plan(nextMs, this.directorOptions(nextMs));
    let event = next.event;
    if (this.hooks.haptics()) event = withHapticMappings({ version: 1, durationMs: this.adaptive.durationMs, ...(this.adaptive.continuous?{continuous:true}:{}), baseline: this.runtime.program.baseline, motifs: [...new Map([...this.runtime.program.motifs, ...next.motifs].map(m => [m.id, m])).values()], events: [event] }).events[0];
    this.runtime.append(event, next.motifs);
  }
  private async prepareScene(atMs:number,parentSignal?:AbortSignal,initial=false){
    if(!this.runtime||!this.adaptive||!this.regieDirection||this.request)return;
    const phase=this.adaptive.phaseAt(atMs).phase,cycle=this.adaptive.continuous?Math.floor(atMs/this.adaptive.durationMs)*this.adaptive.durationMs:0;
    const bound=parentPhaseMs(phase,this.adaptive.durationMs).end+cycle;
    const windowMs=Math.min(90000,bound-atMs-500);
    if(windowMs<1500){this.regieRetryAtMs=bound;return;}
    const controller=new AbortController(),signal=parentSignal?AbortSignal.any([parentSignal,controller.signal]):controller.signal;
    this.request=controller;const epoch=this.epoch,generation=this.regieMemory.generation,runtime=this.runtime;
    const options=this.directorOptions(atMs),settings=this.hooks.settings();
    const sounds=this.hooks.regieSounds?.()??{wiper:this.hooks.allowTriggerSound(),snap:this.hooks.allowTriggerSound(),rhythm:this.hooks.allowTriggerSound()};
    const context:PlanningContext={phase,windowMs,intensity:this.adaptive.intensity,participation:this.regieDirection.regie?.interactive===false?'uninterrupted':'interactive',journey:this.regieDirection.regie?.journey??'custom',userContext:this.regieDirection.regie?.intent??'',...this.regieMemory.context(),interaction:this.playfulInteraction.context,
      knownMotifs:runtime.program.motifs.filter(m=>m.firstIntroducedAtMs<atMs).map(m=>({id:m.id,meaning:m.textAnchor||'An established visual motif.'})),
      pool:directionPool(this.regieDirection,{mainVoice:options.speech,innerVoice:!!this.regieDirection.regie?.innerResponses,visuals:options.visuals,reducedMotion:options.reducedMotion,sounds,playfulRequests:this.regieDirection.regie?.playfulRequests!==false,breathing:!!this.hooks.regieBreathing?.(),
        triggers:this.hooks.allowTriggers()?[...new Set([...options.triggers,...(this.regieDirection.mechanisms.includes('blink')?['Blink']:[])])]:[]})};
    const requestId=crypto.randomUUID();
    const {allowedTriggers,precedingNarration,presentationPreferences,...requestSettings}=settings;
    try{
      const response=await fetch('/api/director/scene',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({...requestSettings,selectedTriggers:[...new Set([...settings.selectedTriggers,...context.pool.triggers.filter(t=>t!=='Blink')])],requestId,localContext:localContextRequest(),planningContext:context,atMs,durationMs:runtime.program.durationMs,continuous:!!runtime.program.continuous,baseline:runtime.program.baseline})});
      let scene:CompiledScene&{requestId:string;error?:string}=await response.json();
      if(!response.ok)throw Error(scene.error??'Scene preparation failed');
      signal.throwIfAborted();if(epoch!==this.epoch||runtime!==this.runtime||generation!==this.regieMemory.generation)return;
      if(scene.requestId!==requestId||scene.atMs!==atMs)throw Error('Stale scene response');
      validateScenePlan(scene.plan,context);
      const checked=ProgramSchema.parse({version:1,durationMs:runtime.program.durationMs,continuous:runtime.program.continuous,baseline:runtime.program.baseline,motifs:[...runtime.program.motifs,...scene.motifs],events:scene.events,responseWindows:scene.responseWindows,responsePrompts:scene.responsePrompts});
      if(scene.endMs>bound||scene.endMs<=scene.atMs||scene.endMs-scene.atMs>windowMs||scene.events.some(e=>e.haptics.length)||scene.payloads.length>64||scene.payloads.reduce((n,p)=>n+p.audio.length,0)>32000000)throw Error('Scene exceeds its preparation contract');
      // Commit only complete, decoded audio; no speculative scene reaches playback.
      const decoded=new Map<string,CachedPayload>(),slots=checked.events.flatMap(e=>compileEvent(e).speech);
      for(const data of scene.payloads){
        const slot=slots.find(s=>s.payloadId===data.payloadId);if(!slot||decoded.has(data.payloadId))throw Error('Invalid scene payload');
        const bytes=Uint8Array.from(atob(data.audio),c=>c.charCodeAt(0)),buffer=await this.hooks.audio().context.decodeAudioData(bytes.buffer);
        signal.throwIfAborted();
        if(Math.abs(buffer.duration*1000-data.durationMs)>1||buffer.duration*1000>slot.speech.targetMs+1)throw Error('Scene audio does not fit its measured window');
        decoded.set(data.payloadId,{response:data,buffer});
      }
      if(slots.some(s=>!decoded.has(s.payloadId)))throw Error('Scene has unprepared speech');
      if(epoch!==this.epoch||runtime!==this.runtime||generation!==this.regieMemory.generation)return;
      if(!initial&&scene.atMs<this.nowMs+150)scene=placePreparedScene(scene,this.nowMs+700,bound-500);
      const challenges=(scene.challenges??[]).map(w=>ChallengeWindowSchema.parse(w));
      if(challenges.length>1)throw Error('One real response may be awaited at a time');
      for(const w of challenges){
        const invitation=scene.events.find(e=>e.id===w.invitationEventId),listen=scene.events.find(e=>e.id===w.responseEventId);
        if(!invitation||!listen||listen.type!=='silence'||listen.atMs!==w.fromMs||listen.atMs+eventDurationMs(listen)!==w.toMs||w.context.attempt> w.context.maxAttempts||scene.responseWindows.some(r=>r.fromMs<w.toMs&&r.toMs>w.fromMs))throw Error('Invalid real listening window');
      }
      runtime.appendScene(scene);
      for(const [id,value]of decoded)this.payloads.set(id,value);
      this.regieMemory.accept(scene.plan,scene.sections,generation);
      if(scene.plan.resolution){const resolved=this.playfulInteraction.context;if(resolved)this.regieMemory.settleRequest(resolved.request,scene.plan.resolution);this.playfulInteraction.resolve(scene.plan);}
      if(challenges[0])this.playfulInteraction.schedule(challenges[0]);
      this.regiePlans.push({id:scene.plan.id,strategy:scene.plan.strategy,rationale:scene.plan.rationale,fromMs:scene.atMs,toMs:scene.endMs});if(this.regiePlans.length>32)this.regiePlans.shift();
    }catch(error){
      if(initial)throw error;
      if(epoch===this.epoch&&!signal.aborted){this.regieRetryAtMs=this.nowMs+5000;this.hooks.notice('The next scene was not ready. Your session continues while Bambi tries again.');}
    }finally{if(this.request===controller)this.request=null;}
  }
  private speak(slot: SpeechSlot, atMs: number) {
    if (!this.hooks.allowSpeech() || slot.speech.requiredTrigger && (!this.hooks.allowTriggers() || !this.hooks.settings().allowedTriggers.includes(slot.speech.requiredTrigger))) return;
    const cached = this.payloads.get(slot.payloadId); if (!cached) { if (!this.failed.has(slot.payloadId)) this.hooks.notice('Narration was not ready for this window. The session timing continues.'); return; }
    const requestedStartMs = slot.atMs + (slot.speech.fixedCue ? slot.speech.cueAtMs! - cached.response.cueOffsetMs! : slot.speech.requiredTrigger ? slot.speech.triggerAtMs! - cached.response.triggerOffsetMs! : 0);
    const bound = !!slot.speech.fixedCue || !!slot.speech.requiredTrigger || this.runtime!.compiled.find(c => c.event.id === slot.eventId)!.event.haptics.some(a => a.speechSlotId === slot.id);
    const startMs = bound ? requestedStartMs : Math.max(atMs, requestedStartMs);
    // A delayed decode or aligned cue never moves a fixed trigger/window.
    if (requestedStartMs < atMs - (bound ? 30 : 150) || startMs + cached.buffer.duration * 1000 > slot.endMs + 1) return;
    const engine = this.hooks.audio(), audioNow = engine.context.currentTime, start = audioNow + (startMs - atMs) / 1000;
    const deadline = audioNow + (slot.endMs - atMs) / 1000;
    this.hooks.clearSpeech(); this.cancelSpeech();
    const layers = this.lastSnapshot!.state.activeLayers;
    const buses = ['main_voice', 'left_voice', 'right_voice', 'echo_voice'] as const;
    for (const bus of buses) {
      if (!layers.includes(bus) && !(bus === 'main_voice' && layers.includes('mantra_voice'))) continue;
      const busStart = start + (bus === 'echo_voice' ? .08 : 0);
      if (busStart + cached.buffer.duration > deadline + .001) continue;
      const source = engine.playEventVoice(cached.buffer, busStart, deadline, bus, slot.speech.voiceTrack); this.speechSources.push(source);
      const cleanup = source.onended; source.onended = event => { cleanup?.call(source, event); this.speechSources = this.speechSources.filter(s => s !== source); };
    }
    if (!this.speechSources.length) return;
    this.playfulInteraction.invitationScheduled(slot.eventId);
    const breathEvent=this.runtime!.compiled.find(c=>c.event.id===slot.eventId)!.event,breath=breathEvent.breath;
    if(breath&&this.hooks.regieBreathing?.())engine.playEventBreath(breath,start+breath.offsetMs/1000,audioNow+(breathEvent.atMs+eventDurationMs(breathEvent)-atMs)/1000,cached.buffer);
    // The payload's measured cue offset has already aligned audio to this compiled word time.
    if (this.hooks.haptics()) {
      const compiled = this.runtime!.compiled.find(c => c.event.id === slot.eventId)!;
      for (const action of compiled.event.haptics.filter(a => a.speechSlotId === slot.id)) {
        const cueMs = compiled.event.atMs + action.offsetMs;
        if (this.runtime!.snapshot(cueMs).state.activeLayers.includes('haptics')) engine.onDeviceCue?.(action.command, audioNow + (cueMs - atMs) / 1000, action.command.operation === 'buzz' ? 'speech' : undefined);
      }
    }
    this.occurrence = {id:`${slot.id}:${this.occurrenceCounter++}`,requestId:cached.response.requestId??slot.payloadId,epoch:this.epoch,text:cached.response.text,sessionStartMs:startMs,audioStartSeconds:start,durationMs:cached.buffer.duration*1000,words:cached.response.words??[]};
    this.evidence.schedule(this.occurrence);
    if (this.importantPayloads.has(slot.payloadId)) engine.setNarrationDelivery('hold', start);
    this.currentText = cached.response.text; this.caption = { text: this.currentText, startMs, endMs: startMs + cached.buffer.duration * 1000, words: cached.response.words };
    // Publish the delivered narration, never a prefetched future episode.
    if (this.speechSources.length) this.hooks.narration(this.currentText);
    this.pinkTimes=this.speechSources.length?(cached.response.pinkOffsetsMs??[]).filter(ms=>Number.isFinite(ms)&&ms>=0&&ms<cached.buffer.duration*1000).map(ms=>startMs+ms):[];
    if (slot.speech.fixedCue) {
      const cueMs=slot.atMs+slot.speech.cueAtMs!, blink=this.runtime!.compiled.find(c=>c.event.id===slot.eventId)!.event.blink!;
      const step=blink.steps.find(s=>s.kind==='blink')! as Extract<typeof blink.steps[number],{kind:'blink'}>;
      this.eyeCueRanges.push({startMs:cueMs,endMs:cueMs+step.closedMs});
      if(blink.sound&&this.hooks.allowTriggerSound()){
        if(this.regieDirection?.regie?.enabled)engine.playSelectedEventSnap(audioNow+(cueMs-atMs)/1000,deadline);
        else engine.playEventCue('blink',audioNow+(cueMs-atMs)/1000,deadline);
      }
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
      if (this.hooks.allowTriggerSound()){
        const scheduled=slot.speech.triggerEffects==='snap_only'?engine.playSelectedEventSnap(audioNow+(cueMs-atMs)/1000,audioNow+(boundary-atMs)/1000,slot.speech.requiredTrigger):engine.playEventTrigger(slot.speech.requiredTrigger, audioNow + (cueMs - atMs) / 1000, audioNow + (boundary - atMs) / 1000, start+cached.buffer.duration);
        if(scheduled&&slot.speech.requiredTrigger.toUpperCase()==='BAMBI SLEEP')this.scheduledSleep.add(slot.eventId);
      }
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
      if (before?.state.narrationState !== 'paused') {
        const naturalEnd=this.occurrence && atMs >= this.occurrence.sessionStartMs+this.occurrence.durationMs;
        if (!naturalEnd) {this.cancelSpeech();this.hooks.clearSpeech();}
        this.hooks.audio().stopEventCues(); this.hooks.clearDevices();
      }
      if (!this.adaptive && !this.liveWindows.size) { this.request?.abort(); this.request = null; }
    }
    if (before?.state.activeLayers.includes('haptics') && !tick.snapshot.state.activeLayers.includes('haptics')) this.hooks.clearDevices();
    if (this.occurrence) {
      this.heardNarration();
      if (engineOutputComplete(this.occurrence, this.hooks.audio().outputTime)) { this.lastDeliveredText=this.heardNarration(); this.occurrence=null; this.hooks.audio().setNarrationDelivery(); }
    }
    if (tick.frames.some(f => f.transition.subtitle === 'clear')) this.caption = null;
    for (const slot of tick.speech) this.speak(slot, atMs);
    const rhythmEvent = this.runtime.compiled.find(c => c.event.id === tick.snapshot.eventId)?.event;
    if (rhythmEvent?.wipe && this.hooks.allowTriggerSound() && !this.hooks.paused()) {
      const wipe = rhythmEvent.wipe, cueMs = rhythmEvent.atMs + wipe.offsetMs, key = `${rhythmEvent.id}:wipe:${cueMs}`;
      // Do not replay a transient wipe after seeking into its middle or after a late tick.
      if (!this.scheduledRhythm.has(key) && cueMs >= atMs - 150 && cueMs <= atMs + 250) {
        const audioNow = this.hooks.audio().context.currentTime;
        if (this.hooks.audio().playWiper(audioNow + (cueMs - atMs) / 1000, audioNow + (cueMs + wipe.durationMs - atMs) / 1000, wipe.text)) this.scheduledRhythm.add(key);
      }
    }
    if (rhythmEvent?.rhythm && this.hooks.allowTriggerSound() && !this.hooks.paused()) {
      for (const beat of rhythmBeats(rhythmEvent)) {
        const key = `${rhythmEvent.id}:${beat.atMs}`;
        if (beat.atMs < atMs || beat.atMs > atMs + 250 || this.scheduledRhythm.has(key)) continue;
        const boundCues = this.runtime.slots.filter(s => s.eventId === rhythmEvent.id && s.speech.requiredTrigger).map(s => s.atMs + s.speech.triggerAtMs!);
        this.scheduledRhythm.add(key);
        if (boundCues.some(cue => Math.abs(cue - beat.atMs) < 400)) continue;
        const audioNow = this.hooks.audio().context.currentTime;
        if(rhythmEvent.rhythm?.sound==='selected_tick')this.hooks.audio().playSelectedEventTick(audioNow+(beat.atMs-atMs)/1000,audioNow+(rhythmEvent.atMs+eventDurationMs(rhythmEvent)-atMs)/1000);
        else this.hooks.audio().playEventCue(beat.kind, audioNow + (beat.atMs - atMs) / 1000, audioNow + (rhythmEvent.atMs + eventDurationMs(rhythmEvent) - atMs) / 1000);
      }
    }
    const engine = this.hooks.audio(), heardMs = atMs - (engine.context.currentTime - engine.outputTime) * 1000;
    for(const cueMs of this.pinkTimes.filter(ms=>ms<=heardMs))if(heardMs-cueMs<=150&&this.hooks.allowVisuals())this.hooks.pink();
    this.pinkTimes=this.pinkTimes.filter(ms=>ms>heardMs);
    for (const frame of tick.frames) if (atMs - frame.atMs <= 150 && tick.snapshot.state.activeLayers.includes('transition_sfx')) {
      const current = this.runtime.compiled.find(c => c.event.id === tick.snapshot.eventId)!;
      const kind = current.event.blink?.sound ? ({ 'blink:cue': 'blink', 'blink:long_close': 'close', 'blink:reopen': 'open' } as const)[frame.label as 'blink:cue' | 'blink:long_close' | 'blink:reopen'] : undefined;
      if (kind && !this.regieDirection?.regie?.enabled && !(kind === 'blink' && current.event.blink?.spoken) && this.hooks.allowTriggerSound()) engine.playEventCue(kind, engine.context.currentTime, engine.context.currentTime + (current.event.atMs + current.event.timing.activeMs - atMs) / 1000);
    }
    for (const cue of this.cueTimes.filter(c => c.atMs <= heardMs)) {
      if (this.hooks.allowTriggers() && heardMs - cue.atMs <= 150 && heardMs < cue.endMs && this.runtime.triggers.fire(cue.phrase, cue.atMs)) {
        this.hooks.cue(cue.phrase,!!this.regieDirection?.regie?.enabled);
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
    if(this.request && this.liveWindows.size && this.runtime.slots.filter(s=>this.liveWindows.has(s.payloadId)).every(s=>atMs>=s.atMs-150)) {this.request.abort();this.request=null;}
    if (!this.request && (this.adaptive || this.liveWindows.size || tick.snapshot.state.narrationState === 'speaking') && !this.hooks.paused()) {
      const next = this.runtime.slots.find(s => s.atMs > atMs && (!this.liveWindows.has(s.payloadId) || atMs < s.atMs - 150) && s.atMs < atMs + 45000 && atMs >= (this.liveWindows.get(s.payloadId) ?? 0) && !this.payloads.has(s.payloadId) && !this.failed.has(s.payloadId) && this.readiness.canRequest(s.payloadId, atMs));
      if (next) void this.render(next);
    }
    // Bound live PCM cache to current/future windows, preserving one mantra payload until its last iteration.
    const future = new Set(this.runtime.slots.filter(s => s.endMs >= atMs).map(s => s.payloadId));
    for (const id of this.payloads.keys()) if (!future.has(id)) this.payloads.delete(id);
    for (const id of this.failed) if (!future.has(id)) this.failed.delete(id);
    this.readiness.prune(future);
    for (const key of this.scheduledRhythm) if (Number(key.slice(key.lastIndexOf(':') + 1)) < atMs - 500) this.scheduledRhythm.delete(key);
    const retainedEvents=new Set(this.runtime.compiled.map(c=>c.event.id));for(const id of this.scheduledSleep)if(!retainedEvents.has(id))this.scheduledSleep.delete(id);
  }
  present(atMs: number, subtitles: boolean) {
    if (!this.active || !this.runtime || !this.lastSnapshot || atMs < this.overrideUntilMs) return;
    const current = this.runtime.compiled.find(c => c.event.id === this.lastSnapshot!.eventId);
    const engine = this.hooks.audio(), heardMs = this.pausedDisplayMs ?? Math.max(0, atMs - (engine.context.currentTime - engine.outputTime) * 1000);
    this.displayAtMs = heardMs;
    const revealed=this.revealedNarration;if(revealed!==null)this.hooks.displayNarration(revealed);
    const display = this.runtime.snapshot(heardMs);let displayEvent = this.runtime.compiled.find(c => c.event.id === display.eventId);
    // A skipped/late or revoked sleep cue must not create an orphan blackout.
    if(this.regieDirection?.regie?.enabled&&display.state.visualState==='black'&&displayEvent?.event.speech.requiredTrigger?.toUpperCase()==='BAMBI SLEEP'&&
      (!this.scheduledSleep.has(displayEvent.event.id)||!this.hooks.allowTriggers()||!this.hooks.allowTriggerSound()||this.hooks.regieSounds?.().snap===false)){
      display.state=structuredClone(displayEvent.event.softReturn?.steps[0].state??displayEvent.event.baseline);displayEvent=undefined;
    }
    const p = presentationAt(display, displayEvent, heardMs), state = display.state;
    const visuals = this.hooks.visuals();
    if (visuals) { visuals.scene = state.scene; if(state.spiralStyle)visuals.stableSettings.style=state.spiralStyle; visuals.motion = p.motion; visuals.density = state.density.visualDensity; visuals.opacity = p.canvas; visuals.fixation = 'none'; visuals.voiceSync = false; visuals.tickSync = false; }
    const enabled = this.hooks.allowVisuals();
    const prompt=this.runtime.program.responsePrompts?.find(p=>heardMs>=p.fromMs&&heardMs<p.toMs);
    if(prompt)this.response.show(prompt.text,prompt.fromMs/1000,prompt.toMs/1000);else this.response.clear();
    this.response.present(heardMs/1000,enabled&&display.label!=='blank');
    this.canvas.style.visibility = enabled && p.canvas > 0 ? '' : 'hidden';
    this.canvas.style.filter = `blur(${visuals?.reduced ? 0 : p.blurPx}px)`; this.canvas.style.transform = `scale(${visuals?.reduced ? 1 : p.zoom})`;
    this.layer.hidden = !enabled || p.black === 0; this.layer.style.opacity = String(p.black);
    this.motif.hidden = !enabled || p.motif === 0; this.motif.style.opacity = String(p.motif);
    const form = state.motifForm ?? 'ring';
    const still=!!visuals?.reduced||p.motion===0;
    const volume=form==='heart'&&state.motifMotion?.kind==='heart_turn';
    if (form !== this.figureForm || volume!==!!this.heart) { this.figureForm = form;this.heart=null;this.heartAtMs=-Infinity;if(volume){this.figure.innerHTML='';this.heart=document.createElement('canvas');this.heart.width=this.heart.height=384;this.heart.setAttribute('aria-hidden','true');this.heart.dataset.heart='volume';this.heart.style.width=this.heart.style.height='100%';this.figure.append(this.heart);}else this.figure.innerHTML = form === 'ring' ? '' : motifSvg(form); this.gears = Array.from(this.figure.querySelectorAll('[data-gear]')); }
    const surrounded=volume&&state.motifMotion?.surround==='gears';
    if(surrounded&&!this.surroundGears.length){this.surround.innerHTML=motifSvg('gears').replaceAll('motif-pink','surround-pink');this.surroundGears=Array.from(this.surround.querySelectorAll('[data-gear]'));}
    this.surround.hidden=!enabled||p.motif===0||!surrounded;
    this.motif.dataset.surround=surrounded?'gears':'none';
    if(surrounded){const density=state.density.visualDensity;this.surround.style.opacity=String(.12+density*.38);this.surround.style.transform=`translate(-50%,-50%) scale(${1.22-density*.22})`;for(const gear of this.surroundGears)gear.setAttribute('transform',`rotate(${gearTurn(heardMs,Number(gear.getAttribute('data-radius')),Number(gear.getAttribute('data-direction')),still)})`);}
    this.motif.dataset.form = form; this.figure.hidden = form === 'ring';
    this.figure.style.transform = `translate(-50%,-50%) rotateY(${volume?0:motifTurn(form, heardMs, still || state.visualState === 'sparse')}deg)${volume?` scale(${state.motifMotion!.strength})`:''}`;
    if(this.heart&&enabled&&p.motif>0&&(heardMs<this.heartAtMs||heardMs-this.heartAtMs>=1000/30||this.hooks.paused())){const context=this.heart.getContext('2d');if(context)drawHeart(context,Math.max(0,heardMs-state.motifMotion!.startMs),state.motifMotion!.periodMs,still);this.heartAtMs=heardMs;}
    for (const gear of this.gears) gear.setAttribute('transform', `rotate(${gearTurn(heardMs, Number(gear.getAttribute('data-radius')), Number(gear.getAttribute('data-direction')), still || state.visualState === 'sparse')})`);
    this.scanner.hidden = !enabled || !!visuals?.reduced || !p.scanner;
    if (p.scanner) { this.scanner.style.opacity = String(p.scanner.opacity); this.scanner.style.transform = `translate(-50%,-50%) translateX(${p.scanner.offset}%) rotateY(${p.scanner.rotationY}deg)`; }
    this.wash.hidden = !enabled || p.overlay === 0; this.wash.style.opacity = String(p.overlay);
    this.blinkCueText.textContent = p.blinkCue ?? '';
    this.blinkCue.hidden = !enabled || !p.blinkCue || p.blinkCue === 'BLINK' && !!displayEvent?.event.blink?.spoken && !this.eyeCueRanges.some(w=>heardMs>=w.startMs&&heardMs<w.endMs);
    const motif = this.runtime.program.motifs.find(m => m.id === (current?.event.motifId ?? state.motifId));
    this.text.textContent = p.authoredText ?? (state.activeLayers.includes('trigger_text') ? '' : motif?.textAnchor ?? '');
    this.text.hidden = !enabled || p.text === 0; this.text.style.opacity = String(p.text);
    if (this.preparedPayloads.size) this.stage.dataset.scene = state.scene;
    this.stage.dataset.event = this.lastSnapshot.label; this.stage.dataset.eventLayers = state.activeLayers.join(',');
    const caption = document.getElementById('caption')!, word = document.getElementById('word')!;
    caption.textContent = '';
    word.textContent = subtitles && this.caption ? spokenWordAt(this.caption.text, heardMs - this.caption.startMs, this.caption.endMs - this.caption.startMs, this.caption.words) : '';
    const status = document.getElementById('event-status'); if (status) status.textContent = `${this.lastSnapshot.label} · ${state.activeLayers.length} layers`;
  }
}

function engineOutputComplete(occurrence: OutputOccurrence, outputTime: number) { return (outputTime-occurrence.audioStartSeconds)*1000>=occurrence.durationMs; }
