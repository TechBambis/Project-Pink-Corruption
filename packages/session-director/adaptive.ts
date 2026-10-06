// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { sessionPhaseAt, type SessionPhase } from './phases';
import { parentPhaseMs, ProgramSchema, type BambiEvent, type BambiProgram, type PresentationState } from './events/contract';
import { createEpisode, episodeMs, motifIdentity, quietFallback, recipes, type EpisodeRecipe } from './events/episodes';
import { compileEvent } from './events/runtime';
import { referenceState, withProgramTriggers } from './events/program';
import type { MotifForm } from '../visuals/event-motif';

export interface DirectorOptions { speech: boolean; visuals: boolean; reducedMotion: boolean; triggers: string[]; voiceAvailable: boolean }
export interface DirectorDecision { atMs: number; recipe: EpisodeRecipe; eventId: string; fallback?: boolean; candidates: { recipe: EpisodeRecipe; score: number; reasons: string[]; rejected?: string }[] }
const allowed: Record<EpisodeRecipe, SessionPhase[]> = {
  introduction: ['induction', 'deepening', 'conditioning', 'anchor'], passage: ['induction', 'deepening', 'conditioning', 'anchor', 'awakening'],
  heart: ['induction', 'deepening', 'conditioning'], gears: ['deepening', 'conditioning'], blink: ['induction', 'deepening'], fractionation: ['deepening', 'conditioning'],
  mindwipe: ['conditioning'], reset: ['conditioning', 'anchor'], self: ['conditioning'], mantra: ['deepening', 'conditioning', 'anchor'], peak: ['conditioning'],
  quiet: ['induction', 'deepening', 'conditioning', 'anchor', 'awakening'], dark_hold: ['deepening', 'conditioning'], recall: ['induction', 'deepening', 'conditioning', 'anchor', 'awakening'], return: ['deepening', 'conditioning', 'anchor', 'awakening'], closing: ['awakening'],
};
const dense = new Set<EpisodeRecipe>(['peak', 'fractionation', 'gears']);
const restrained = new Set<EpisodeRecipe>(['quiet', 'dark_hold', 'recall', 'return']);
/** Pure policy state contains delivered presentation history, not listener-state inference. */
export class AdaptiveDirector {
  readonly decisions: DirectorDecision[] = [];
  readonly introduced = new Set<MotifForm>();
  private seen = new Set<string>();
  private assigned = new Map<string, EpisodeRecipe>();
  private used = new Map<EpisodeRecipe, number>();
  private cueReservations = new Map<string, number>();
  private randomState: number;
  private serial = 0;
  private observedAt = 0;
  private load = 0;
  private denseMs = 0;
  private quietMs = 0;
  private lastRecipe: EpisodeRecipe | null = null;
  private form: MotifForm = 'ring';
  private previous: PresentationState | undefined;
  constructor(readonly durationMs: number, readonly intensity: number, readonly seed: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw Error('Invalid adaptive session budget');
    this.randomState = seed >>> 0 || 1;
  }
  private random() { let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0; return this.randomState / 4294967296; }
  get history() { return { load: this.load, denseMs: this.denseMs, quietMs: this.quietMs, lastRecipe: this.lastRecipe, form: this.form, introduced: [...this.introduced] }; }
  observe(event: BambiEvent, state: PresentationState, atMs: number, visible: boolean, heard: boolean) {
    const dt = Math.min(1000, Math.max(0, atMs - this.observedAt)); this.observedAt = atMs;
    this.previous = structuredClone(state);
    const density = (visible ? state.density.visualDensity * .45 : 0) + state.density.audioDensity * .35 + (heard ? state.density.speechDensity * .2 : 0);
    this.load += (density - this.load) * (1 - Math.exp(-dt / 30000));
    this.denseMs = density > .3 ? this.denseMs + dt : Math.max(0, this.denseMs - dt * 2);
    this.quietMs = density < .15 ? this.quietMs + dt : 0;
    const form = state.motifForm ?? 'ring';
    if (visible && state.activeLayers.includes('motif_visual') || heard) { this.introduced.add(form); this.form = form; }
    if (!this.seen.has(event.id) && (visible || heard || state.narrationState === 'paused')) {
      this.seen.add(event.id); const recipe = this.assigned.get(event.id) ?? 'passage'; this.lastRecipe = recipe; this.used.set(recipe, atMs);
      if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
      if (this.assigned.size > 128) this.assigned.delete(this.assigned.keys().next().value!);
    }
  }
  plan(atMs: number, options: DirectorOptions): { event: BambiEvent; motifs: BambiProgram['motifs'] } {
    if (atMs >= this.durationMs) throw Error('Session is complete');
    const { phase, progress } = sessionPhaseAt(atMs / 1000, this.durationMs / 1000), bounds = parentPhaseMs(phase, this.durationMs), remaining = bounds.end - atMs;
    const closing = phase === 'awakening' && (progress >= .7 || remaining <= 30000);
    const intro = !this.introduced.size && phase !== 'awakening'
      && (options.visuals || options.speech && options.voiceAvailable)
      && atMs - (this.used.get('introduction') ?? -Infinity) >= 45000;
    const candidates = recipes.map(recipe => {
      const reasons: string[] = []; let score = .3;
      let rejected: string | undefined;
      if (!allowed[recipe].includes(phase)) rejected = 'parent phase';
      if (!['passage', 'introduction', 'closing'].includes(recipe) && episodeMs[recipe] > remaining) rejected = 'parent budget';
      if (recipe === 'peak' && episodeMs.peak + episodeMs.return > remaining) rejected = 'recovery budget';
      if (recipe === 'peak' && this.intensity < .35) rejected = 'low intensity budget';
      if (recipe === 'closing' && !closing || closing && recipe !== 'closing') rejected = 'closing obligation';
      if (intro && recipe !== 'introduction' || !intro && recipe === 'introduction') rejected = 'motif introduction';
      if (['recall', 'fractionation', 'peak', 'mantra', 'self'].includes(recipe) && !this.introduced.size) rejected = 'no delivered motif';
      if (['mindwipe', 'mantra', 'self', 'blink'].includes(recipe) && (!options.speech || !options.voiceAvailable)) rejected = 'speech unavailable';
      if (['heart', 'gears', 'blink', 'peak'].includes(recipe) && !options.visuals) rejected = 'visuals disabled';
      if (['gears', 'peak'].includes(recipe) && options.reducedMotion) rejected = 'reduced motion';
      if (recipe === 'heart' && this.introduced.has('heart') || recipe === 'gears' && this.introduced.has('gears')) rejected = 'already introduced';
      if (recipe === 'quiet' && this.quietMs > 10000 || recipe === 'dark_hold' && this.quietMs > 10000) rejected = 'sufficient quiet already';
      const since = atMs - (this.used.get(recipe) ?? -Infinity);
      if (since < (recipe === 'passage' ? 0 : recipe === 'peak' ? 90000 : 45000)) rejected = 'recent episode cooldown';
      if (recipe === 'passage') { score += .5; reasons.push('connected baseline'); }
      if (recipe === 'blink') { score += .85; reasons.push('voluntary eye-rest cue'); }
      if (recipe === 'mantra') { score += .6; reasons.push('repeat a simple established anchor'); }
      if (recipe === 'self' && progress > .15 && progress < .7) { score += .6; reasons.push('coherent narrative perspective'); }
      if (recipe === 'reset' && progress > .5) { score += .6; reasons.push('chapter transition'); }
      if (recipe === 'mindwipe') { score += this.load * 3; reasons.push('prepared simplification after density'); }
      if (recipe === 'heart' || recipe === 'gears') { score += .8; reasons.push('new coherent motif'); }
      if (recipe === 'recall' && this.introduced.size) { score += .55; reasons.push('familiar anchor'); }
      if (dense.has(recipe)) { score += Math.max(0, .35 - this.load) * 2; reasons.push('density headroom'); }
      if (restrained.has(recipe)) { score += this.load * 2 + Math.min(1, this.denseMs / 45000); reasons.push('contrast/recovery need'); }
      if (this.lastRecipe === 'peak' && recipe === 'return') { score += 4; reasons.push('peak recovery obligation'); }
      if (this.lastRecipe === recipe) { score -= 1.2; reasons.push('repeat penalty'); }
      if (!options.voiceAvailable && (recipe === 'quiet' || recipe === 'dark_hold' || recipe === 'return')) { score += .8; reasons.push('renderer recovery'); }
      if (phase === 'anchor' && recipe === 'recall' || phase === 'awakening' && recipe === 'passage') { score += 1; reasons.push('parent direction'); }
      if (intro || closing) score += 10;
      return { recipe, score, reasons, ...(rejected ? { rejected } : {}) };
    });
    const eligible = candidates.filter(c => !c.rejected).sort((a,b) => b.score - a.score);
    if (!eligible.length) throw Error('No valid adaptive episode');
    const shortlist = eligible.filter(c => c.score >= eligible[0].score - .35), selected = shortlist[Math.floor(this.random() * shortlist.length)];
    const recipe = selected.recipe;
    let form = recipe === 'heart' ? 'heart' as const : recipe === 'gears' ? 'gears' as const : this.form;
    if (recipe === 'recall') { const forms = [...this.introduced]; form = forms[Math.floor(this.random() * forms.length)]; }
    const span = recipe === 'closing' ? remaining : Math.min(remaining, episodeMs[recipe] + (recipe === 'passage' ? Math.floor(this.random() * 8000) : 0));
    const id = `adaptive-${++this.serial}-${recipe}`;
    let event = createEpisode(recipe, id, atMs, span, phase, form, this.intensity, options.speech && (options.voiceAvailable || recipe === 'closing'), this.random(), this.previous);
    const cue = options.triggers.find(phrase => atMs - (this.cueReservations.get(phrase) ?? -Infinity) >= 12000);
    const motif = motifIdentity[form], motifs = [{ id: motif.id, visualPreset: 'Soft Pink' as const, textAnchor: motif.anchor, firstIntroducedAtMs: atMs }];
    if (cue && options.speech && options.voiceAvailable && (event.type === 'fractionation' || event.type === 'motif_recall')) {
      event = withProgramTriggers({ version: 1, durationMs: this.durationMs, baseline: referenceState(), events: [event], motifs }, { [phase]: [cue] }).events[0];
      for (const slot of compileEvent(event).speech) if (slot.speech.requiredTrigger) this.cueReservations.set(cue, slot.atMs + slot.speech.triggerAtMs!);
    }
    // Compile now: errors cannot leave a partial live plan or a stranded blank.
    compileEvent(event);
    this.assigned.set(id, recipe);
    this.decisions.push({ atMs, recipe, eventId: id, candidates });
    if (this.decisions.length > 128) this.decisions.shift();
    return { event, motifs };
  }
  fallback(event: BambiEvent) {
    const decision = this.decisions.find(d => d.eventId === event.id); if (decision) decision.fallback = true;
    this.assigned.set(event.id, 'quiet');
    return quietFallback(event);
  }
  initial(options: DirectorOptions): BambiProgram {
    const { event, motifs } = this.plan(0, options);
    return ProgramSchema.parse({ version: 1, durationMs: this.durationMs, baseline: referenceState(), events: [event], motifs });
  }
}
