// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { EventSchema, type BambiEvent, type PresentationState, type SpeechSpec } from './contract';
import { referenceState } from './program';
import { deliveryProfiles, type DeliveryMode } from '../delivery';
import type { SessionPhase } from '../phases';
import type { MotifForm } from '../../visuals/event-motif';
import { narrativeDirection, type NarrativeFocus } from './narrative';

export const recipes = ['introduction', 'passage', 'heart', 'gears', 'blink', 'fractionation', 'mindwipe', 'reset', 'self', 'mantra', 'peak', 'quiet', 'dark_hold', 'recall', 'return', 'closing'] as const;
export type EpisodeRecipe = typeof recipes[number];
export const episodeMs: Record<EpisodeRecipe, number> = { introduction: 24000, passage: 30000, heart: 24000, gears: 24000, blink: 8000, fractionation: 34000, mindwipe: 15100, reset: 10300, self: 18000, mantra: 16200, peak: 20000, quiet: 10000, dark_hold: 12000, recall: 12000, return: 18000, closing: 30000 };
export const motifIdentity = { ring: { id: 'pink-orb', anchor: 'a softly glowing pink ring' }, heart: { id: 'pink-heart', anchor: 'a softly lit pink heart' }, gears: { id: 'pink-gears', anchor: 'linked pink gears around a central spiral' } } as const;
const silent: SpeechSpec = { mode: 'silent', targetMs: 0, instruction: '' };
const instant = { kind: 'hard_cut' as const, durationMs: 0, subtitle: 'clear' as const };
function withoutVoice(state: PresentationState): PresentationState {
  const activeLayers = state.activeLayers.filter(l => !['main_voice', 'left_voice', 'right_voice', 'echo_voice', 'mantra_voice'].includes(l));
  return { ...state, activeLayers, foreground: activeLayers.includes('motif_visual') ? 'motif_visual' : null, narrationState: 'paused', density: { ...state.density, speechDensity: 0 } };
}
export function createEpisode(recipe: EpisodeRecipe, id: string, atMs: number, durationMs: number, phase: SessionPhase, form: MotifForm, intensity: number, speak: boolean, variant = 0, previous?: PresentationState, focus: NarrativeFocus = phase === 'awakening' ? 'surroundings' : 'attention'): BambiEvent {
  const motif = motifIdentity[form], delivery: DeliveryMode = phase === 'awakening' ? 'return' : ['quiet', 'dark_hold', 'mantra', 'mindwipe'].includes(recipe) ? 'hold' : recipe === 'peak' ? 'drive' : recipe === 'introduction' ? 'settle' : 'guide';
  const narration = (targetMs: number, instruction: string, mode: SpeechSpec['mode'] = 'narrate', selected = delivery): SpeechSpec => speak && targetMs >= 1500 ? { mode, targetMs, instruction, delivery: selected, wordTarget: Math.max(1, Math.floor(targetMs / 1000 * 1.2 * deliveryProfiles[selected].speedMultiplier)) } : silent;
  const moving = form === 'ring' && !['quiet', 'dark_hold', 'recall', 'closing'].includes(recipe);
  let baseline = referenceState({ motifId: motif.id, motifForm: form,
    ...(moving ? { motifMotion: { kind: 'coin_scan', startMs: atMs, periodMs: 5000, strength: .7 } } : {}),
    density: { intensity, effectDensity: .2, speechDensity: .3, audioDensity: .25, visualDensity: .2 } });
  if (!speak) baseline = withoutVoice(baseline);
  const sparse = { ...baseline, visualState: 'sparse' as const, density: { ...baseline.density, effectDensity: .08, visualDensity: .08, audioDensity: .15 } };
  const empty = withoutVoice({ ...baseline, activeLayers: [], foreground: null, visualState: 'black', ambientState: 'silent', scene: 'Audio Only', density: { ...baseline.density, effectDensity: 0, visualDensity: 0, audioDensity: 0 } });
  const explanation = narrativeDirection(focus);
  let event: BambiEvent = { id, type: 'layer_shift', phase, atMs, timing: { prepMs: 0, activeMs: durationMs, returnMs: 0 }, state: baseline, baseline, speech: narration(Math.min(18000, durationMs * .65), explanation), audio: [], visual: [], haptics: [], entry: instant, exit: instant };
  if (recipe === 'introduction') event.speech = narration(Math.min(16000, durationMs * .7), `Introduce ${motif.anchor} and comfortable attention. Explain voluntary eye-rest cues without saying their command words. Natural blinking and moving remain welcome. Do not promise future effects.`);
  if (recipe === 'heart' || recipe === 'gears') event.speech = narration(Math.min(16000, durationMs * .65), `Introduce ${motif.anchor} in original narration. This object is now present; stay with its current appearance. Do not invent a cue or a future transition.`);
  if (recipe === 'blink') {
    const closed = { ...baseline, foreground: speak ? 'main_voice' as const : null, activeLayers: baseline.activeLayers.filter(l => l !== 'motif_visual'), visualState: 'black' as const };
    event = { ...event, type: 'blink_trigger', speech: silent, state: { ...baseline, activeLayers: [...baseline.activeLayers, 'transition_sfx'] }, blink: { sound: true, spoken: speak,
      openState: { ...baseline, activeLayers: [...baseline.activeLayers, 'transition_sfx'] }, closedState: { ...closed, activeLayers: [...closed.activeLayers, 'transition_sfx'] },
      steps: [{ kind: 'blink', count: 2, closedMs: 500, openMs: 1500 }, { kind: 'long_close', durationMs: 1000 }, { kind: 'stay_closed', durationMs: 2000 }, { kind: 'reopen', durationMs: 1000 }] } };
  }
  if (recipe === 'fractionation') {
    const a = { ...sparse, activeLayers: sparse.activeLayers.filter(l => l !== 'drone'), ambientState: 'silent' as const };
    event = { ...event, type: 'fractionation', speech: silent, fractionation: { stateA: a, stateB: { ...baseline, activeLayers: [...baseline.activeLayers, 'spiral'], visualState: 'layered', scene: 'Spiral Focus', density: { ...baseline.density, effectDensity: .5, visualDensity: .55 } },
      pattern: 'constant', cycles: [{ aMs: 8500, bMs: 8500 }, { aMs: 8500, bMs: 8500 }], transitionMs: 1000,
      speechA: narration(3000, 'One original short clause narrowing attention to the retained motif.', 'fragment', 'hold'), speechB: narration(4000, 'One original clause connecting breathing and the expanded familiar scene.', 'reanchor', 'guide') } };
  }
  if (recipe === 'mindwipe') event = { ...event, type: 'mindwipe', timing: { prepMs: 8000, activeMs: 3100, returnMs: 4000 },
    baseline: { ...baseline, activeLayers: [...baseline.activeLayers, 'transition_sfx'] }, state: empty,
    wipe: { offsetMs: 0, durationMs: 8000, text: 'THOUGHTS' },
    speech: narration(6000, 'The engine is showing a car-style windshield wiper that erases a single word in an arc with a rubbing sound; the background remains. Describe this current fictional image in short original clauses, then simplify into a quiet point. Finish before the engine-owned blank. Do not invent sounds, motion, cue words or timing.', 'fragment', 'hold') };
  if (recipe === 'reset') event = { ...event, type: 'reset', timing: { prepMs: 1000, activeMs: 7800, returnMs: 1500 }, state: sparse, speech: narration(6000, 'Close the previous fictional chapter and introduce a clean narrative starting point. No memory, settings or operating-system changes.', 'reanchor') };
  if (recipe === 'self') event = { ...event, type: 'original_self', motifId: motif.id, originalSelf: 'original', state: sparse, speech: narration(11000, 'Use Original Self / Old Self as a coherent fictional narrative perspective. No computer, installation or reboot metaphor.') };
  if (recipe === 'mantra') event = { ...event, type: 'mantra', speech: narration(2400, 'One original very short phrase supplied once. No cue names.', 'mantra', 'settle'), mantra: { count: 3, periodMs: 5400 } };
  if (recipe === 'peak') {
    event.state = { ...baseline, activeLayers: [...baseline.activeLayers, 'spiral', 'transition_sfx'], visualState: 'layered', scene: 'Spiral Focus', ambientState: 'active', density: { ...baseline.density, effectDensity: .65, speechDensity: .5, audioDensity: .5, visualDensity: .65 } };
    event.type = 'peak';
    event.audio = [{ offsetMs: 0, bus: 'drone', gain: 0, durationMs: 0 }, { offsetMs: 2500, bus: 'drone', gain: .6, durationMs: 3000 }, { offsetMs: 0, bus: 'EFFECTS', gain: 0, durationMs: 0 }, { offsetMs: 4000, bus: 'EFFECTS', gain: .45, durationMs: 300 }];
    event.rhythm = { offsetMs: 4300, untilMs: durationMs - 1000, stepMs: 1200 };
  }
  if (recipe === 'quiet' || recipe === 'dark_hold') {
    const dark = recipe === 'dark_hold';
    event = { ...event, type: 'silence', speech: silent, state: withoutVoice({ ...sparse, activeLayers: dark ? ['drone', 'transition_sfx'] : ['motif_visual', 'transition_sfx'], visualState: dark ? 'black' : 'motif', ambientState: dark ? 'active' : 'silent', density: { ...sparse.density, audioDensity: dark ? .5 : .1 } }), rhythm: { offsetMs: 200, untilMs: durationMs - 300, stepMs: 1200, endStepMs: variant > .5 ? 1500 : 1200 } };
  }
  if (recipe === 'recall') event = { ...event, type: 'motif_recall', motifId: motif.id, state: sparse, speech: narration(5000, `Give one brief callback to the established ${motif.anchor}, without retelling its introduction or describing its movement. The scene stays restrained.`, 'reanchor', 'hold') };
  if (recipe === 'return' || recipe === 'closing') {
    const final = recipe === 'closing', start: PresentationState = final || !previous ? sparse : { ...previous, narrationState: speak ? 'speaking' : 'paused', activeLayers: [...previous.activeLayers.filter(l => !['main_voice', 'left_voice', 'right_voice', 'echo_voice', 'mantra_voice'].includes(l)), ...(speak ? ['main_voice' as const] : [])], foreground: speak ? 'main_voice' : previous.activeLayers.includes('motif_visual') ? 'motif_visual' : null };
    const resting = start.activeLayers.includes('drone') ? sparse : { ...sparse, ambientState: 'silent' as const, activeLayers: sparse.activeLayers.filter(l => l !== 'drone') };
    event = { ...event, type: 'soft_return', state: start,
      speech: final && speak && durationMs >= 12000 ? { mode: 'reanchor', targetMs: Math.min(12000, durationMs * .7), delivery: 'return', fixedText: 'The session is ending. Notice your surroundings and move freely.', instruction: 'Engine-owned original closing.' } : narration(Math.min(10000, durationMs * .6), final ? 'Clearly close the session. Restore ordinary awareness and freedom to move.' : `${narrativeDirection(focus)} Connect the previous thought to a quieter delivery.`, 'reanchor', 'return'),
      softReturn: { final, steps: [{ offsetMs: 0, state: start }, { offsetMs: durationMs * .3, state: resting }, { offsetMs: durationMs * .6, state: { ...resting, ambientState: 'silent', activeLayers: resting.activeLayers.filter(l => l !== 'drone') } }, { offsetMs: durationMs * .8, state: final ? empty : { ...resting, ambientState: 'silent', activeLayers: resting.activeLayers.filter(l => l !== 'drone') } }] } };
  }
  if (event.speech.mode === 'silent' && !['fractionation', 'blink_trigger'].includes(event.type)) event.state = withoutVoice(event.state);
  return EventSchema.parse(event);
}

/** Preserve the committed time boundary while removing unavailable speech and its cues. */
export function quietFallback(event: BambiEvent): BambiEvent {
  const state = withoutVoice(event.baseline), durationMs = event.timing.prepMs + event.timing.activeMs + event.timing.returnMs;
  if (event.softReturn?.final) return createEpisode('closing', event.id, event.atMs, durationMs, event.phase, event.baseline.motifForm ?? 'ring', event.state.density.intensity, false);
  return EventSchema.parse({ id: event.id, atMs: event.atMs, phase: event.phase, type: 'layer_shift', timing: { prepMs: 0, activeMs: durationMs, returnMs: 0 }, state: { ...state, visualState: 'sparse' }, baseline: state, speech: silent, audio: [], visual: [], haptics: [], entry: instant, exit: instant });
}
