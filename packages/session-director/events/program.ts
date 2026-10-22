// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { sessionPhases } from '../phases';
import { ProgramSchema, parentPhaseMs, eventDurationMs, type BambiEvent, type BambiProgram, type PresentationState, type SpeechSpec } from './contract';
import { compileEvent } from './runtime';
import { narrationDeliveryAt, deliveryProfiles, eventDelivery, type DeliveryMode } from '../delivery';

export function referenceState(overrides: Partial<PresentationState> = {}): PresentationState {
  return { activeLayers: ['main_voice', 'drone', 'motif_visual'], foreground: 'main_voice', density: { intensity: .5, effectDensity: .25, speechDensity: .3, audioDensity: .3, visualDensity: .2 }, visualState: 'motif', narrationState: 'speaking', ambientState: 'reduced', scene: 'Soft Pink', motifId: 'pink-orb', ...overrides };
}
const silentSpeech: SpeechSpec = { mode: 'silent', targetMs: 0, instruction: '' };
const narrate = (targetMs: number, instruction: string, mode: SpeechSpec['mode'] = 'narrate', delivery: DeliveryMode = eventDelivery(mode, 'induction')): SpeechSpec => ({ mode, targetMs, instruction, delivery, wordTarget: Math.max(1, Math.floor(targetMs / 1000 * 1.7 * deliveryProfiles[delivery].speedMultiplier * .85)) });
const instant = { kind: 'hard_cut' as const, durationMs: 0, subtitle: 'clear' as const };

/** Original engine-authored development preset. Durations are reviewable design choices, not source measurements. */
export function createReferenceProgram(durationMs: number, intensity = .6): BambiProgram {
  const baseline = referenceState({ motifMotion: { kind: 'coin_scan', startMs: Math.max(32000, Math.round(durationMs * .1)), periodMs: 5000, strength: .8 }, density: { intensity, effectDensity: .25, speechDensity: .3, audioDensity: .3, visualDensity: .2 } });
  const narrow = referenceState({ visualState: 'sparse', scene: 'Minimal Dark', density: { intensity, effectDensity: .12, speechDensity: .2, audioDensity: .15, visualDensity: .08 } });
  const blackSpeaking = { ...narrow, activeLayers: ['main_voice', 'drone'] as PresentationState['activeLayers'], visualState: 'black' as const };
  const blank = referenceState({ activeLayers: [], foreground: null, visualState: 'black', narrationState: 'paused', ambientState: 'silent', scene: 'Audio Only', density: { intensity, effectDensity: 0, speechDensity: 0, audioDensity: 0, visualDensity: 0 } });
  const peak = referenceState({ activeLayers: ['main_voice', 'drone', 'motif_visual', 'spiral', 'center_text'], visualState: 'layered', scene: 'Spiral Focus', density: { intensity, effectDensity: .7, speechDensity: .6, audioDensity: .55, visualDensity: .7 } });
  const events: BambiEvent[] = [];
  let serial = 0;
  const make = (phase: BambiEvent['phase'], atMs: number, type: BambiEvent['type'], activeMs: number, instruction: string): BambiEvent => {
    const delivery = type === 'peak' ? 'drive' : narrationDeliveryAt(atMs / 1000, durationMs / 1000);
    const state = type !== 'layer_shift' ? baseline : delivery === 'drive' ? { ...peak, activeLayers: peak.activeLayers.filter(layer => layer !== 'center_text'), density: { ...peak.density, effectDensity: .45, visualDensity: .45 } } : delivery === 'hold' ? { ...baseline, visualState: 'sparse' as const, density: { ...baseline.density, effectDensity: .1, visualDensity: .08 } } : baseline;
    return { id: `reference-${++serial}`, type, phase, atMs, timing: { prepMs: 0, activeMs, returnMs: 0 }, state, baseline, speech: narrate(Math.min(18000, activeMs), instruction, 'narrate', delivery), audio: [], visual: [], haptics: [], entry: instant, exit: instant };
  };
  const fraction = (phase: BambiEvent['phase'], atMs: number, accelerating: boolean): BambiEvent => {
    const cycles = accelerating ? [{ aMs: 9000, bMs: 8000 }, { aMs: 6000, bMs: 5000 }] : [{ aMs: 9000, bMs: 8000 }, { aMs: 9000, bMs: 8000 }];
    return { ...make(phase, atMs, 'fractionation', cycles.reduce((n, c) => n + c.aMs + c.bMs, 0), ''), speech: silentSpeech,
      fractionation: { stateA: blackSpeaking, stateB: baseline, pattern: accelerating ? 'accelerating' : 'constant', cycles, transitionMs: 1000, speechA: narrate(3000, 'One original clause narrowing attention toward quiet and the retained voice.', 'fragment'), speechB: narrate(4000, 'An original clause expanding attention toward breathing and the surrounding scene.', 'reanchor') } };
  };
  const soft = (phase: BambiEvent['phase'], atMs: number, activeMs: number, final: boolean): BambiEvent => ({
    ...make(phase, atMs, 'soft_return', activeMs, final ? 'Give a clear original closing: ordinary awareness of body and surroundings, freedom to move, and the session gently closing. No new triggers or continued fictional control.' : 'Gently connect the previous passage to a calmer familiar scene.',),
    state: final ? baseline : peak,
    speech: narrate(Math.min(18000, final ? Math.floor(activeMs * .7) : activeMs), final ? 'Gently restore ordinary awareness of body and surroundings. Freedom to move, natural blinking, and the session closing. No new triggers.' : 'Connect the previous passage to a calmer familiar scene.', 'reanchor', 'return'),
    softReturn: { final, steps: [
      { offsetMs: 0, state: final ? baseline : { ...peak, activeLayers: peak.activeLayers.filter(l => l !== 'center_text') } },
      { offsetMs: Math.floor(activeMs * .25), state: { ...baseline, visualState: 'sparse', density: { ...baseline.density, visualDensity: .12 } } },
      { offsetMs: Math.floor(activeMs * .5), state: { ...baseline, activeLayers: ['main_voice', 'motif_visual'], ambientState: 'silent', density: { ...baseline.density, effectDensity: .08, audioDensity: .1 } } },
      { offsetMs: Math.floor(activeMs * .75), state: final ? { ...baseline, activeLayers: ['motif_visual'], foreground: 'motif_visual', narrationState: 'paused', ambientState: 'silent', density: { ...baseline.density, speechDensity: 0, audioDensity: 0 } } : baseline },
    ] },
  });
  for (const phase of sessionPhases) {
    const { start, end } = parentPhaseMs(phase, durationMs); let cursor = start;
    const add = (event: BambiEvent) => { if (cursor + eventDurationMs(event) <= end + .001) { events.push(event); cursor += eventDurationMs(event); return true; } return false; };
    // The opening is long enough to introduce a motif before any recall/cue state.
    if (phase === 'induction') {
      const intro = Math.min(24000, end - cursor); add(make(phase, cursor, 'layer_shift', intro, 'Explain the eye-rest cues without speaking their command words: the voice will cue each quick lid closure with matching text and sound, followed by a brief eye rest and reopening. Natural blinking remains welcome. Introduce the softly glowing pink ring in the remaining word budget.'));
      add({ ...make(phase, cursor, 'blink_trigger', 8000, 'Invite comfortable voluntary blinking and a brief eye rest, then reopening. Natural blinking remains welcome.'), speech: silentSpeech,
        blink: { sound: true, spoken: true, openState: { ...baseline, activeLayers: [...baseline.activeLayers, 'transition_sfx'] }, closedState: { ...blackSpeaking, activeLayers: [...blackSpeaking.activeLayers, 'transition_sfx'] }, steps: [{ kind: 'blink', count: 2, closedMs: 500, openMs: 1500 }, { kind: 'long_close', durationMs: 1000 }, { kind: 'stay_closed', durationMs: 2000 }, { kind: 'reopen', durationMs: 1000 }] } });
    }
    if (phase === 'deepening') { add(fraction(phase, cursor, false)); add({ ...make(phase, cursor, 'silence', 3100, ''), state: { ...blank, activeLayers: ['motif_visual'], visualState: 'motif' }, speech: silentSpeech }); }
    if (phase === 'conditioning') {
      add(fraction(phase, cursor, true));
      add({ ...make(phase, cursor, 'mindwipe', 3100, ''), timing: { prepMs: 8000, activeMs: 3100, returnMs: 4000 }, baseline: { ...baseline, activeLayers: [...baseline.activeLayers, 'transition_sfx'] }, state: blank, wipe: { offsetMs: 0, durationMs: 8000, text: 'THOUGHTS' }, speech: narrate(6000, 'The current fictional scene shows two car-style windshield wipers erasing one word in an arc with a rubbing sound over the retained background. Describe that present image in short original clauses, simplify into a quiet point, and finish before the reserved no-text blank. No invented effects or timing.', 'fragment') });
      add({ ...make(phase, cursor, 'reset', 7800, 'Close the previous fictional chapter and introduce one fresh, clear starting point.'), timing: { prepMs: 1000, activeMs: 7800, returnMs: 1500 }, state: narrow });
      add({ ...make(phase, cursor, 'original_self', 14300, 'Introduce Original Self / Old Self as a fictional narrative perspective. Maintain one coherent referent. No computer or installation metaphors.'), motifId: 'pink-orb', originalSelf: 'original', state: narrow });
      add({ ...make(phase, cursor, 'mantra', 16200, ''), speech: narrate(1600, 'One original very short calming mantra, supplied only once.', 'mantra'), mantra: { count: 3, periodMs: 5400 } });
      add({ ...make(phase, cursor, 'peak', 20910, 'A short original foreground passage recalling the previously introduced glowing ring; preserve one clear voice.'), state: peak });
      add(soft(phase, cursor, 12000, false));
    }
    if (phase === 'anchor') add({ ...make(phase, cursor, 'motif_recall', 4000, 'Recall the familiar glowing pink ring in one original anchor.',), motifId: 'pink-orb', speech: narrate(1600, 'One original simple phrase recalling the established ring.', 'reanchor') });
    if (phase === 'awakening') {
      add(soft(phase, cursor, end - cursor, true));
    } else {
      let passage = 0;
      while (end - cursor > .001) {
        // Distribute contrast across the existing main phase rather than clustering every mechanism at its start.
        if (phase === 'conditioning' && passage > 0 && passage % 2 === 0 && end - cursor >= 45000) {
          const recurrence = Math.floor(passage / 2) % 3;
          if (recurrence === 1) add({ ...make(phase, cursor, 'motif_recall', 6000, 'Return to the familiar steady ring. The moving reflection rests during this callback; no spiral or flashes.'), motifId: 'pink-orb', state: { ...baseline, visualState: 'sparse', density: { ...baseline.density, effectDensity: .12, visualDensity: .08 } } });
          else if (recurrence === 2) { add({ ...make(phase, cursor, 'silence', 3100, ''), state: { ...blank, activeLayers: ['motif_visual'], visualState: 'motif' }, speech: silentSpeech }); add({ ...make(phase, cursor, 'peak', 14000, 'The familiar ring and spiral now share the scene. Give one original clear foreground clause; do not invent further effects.'), state: peak }); add(soft(phase, cursor, 8000, false)); }
          else add(fraction(phase, cursor, true));
        }

        const scanStart = baseline.motifMotion!.startMs;
        const span = Math.min(30000, end - cursor, cursor < scanStart && scanStart < end ? scanStart - cursor : Infinity);
        const event = make(phase, cursor, 'layer_shift', span, cursor === scanStart
          ? 'Begin with a brief present-tense description of the soft light moving inside the pink ring. Its turn starts with this spoken window and repeats slowly. Describe this visible movement; do not announce another change.'
          : 'Continue original connected narration appropriate to the current parent phase. Describe only the supplied current presentation. Do not invent cues, flashes, movement, sounds or state transitions.');
        if (span < 1500) event.speech = silentSpeech;
        add(event); passage++;
      }
    }
  }
  return ProgramSchema.parse({ version: 1, durationMs, baseline, motifs: [{ id: 'pink-orb', firstIntroducedAtMs: 0, visualPreset: 'Soft Pink', textAnchor: 'a familiar glowing pink ring' }], events });
}

/** Eligibility comes from the existing trigger settings; the model never chooses a cue. */
export function withProgramTriggers(raw: BambiProgram, eligible: Partial<Record<BambiEvent['phase'], string[]>> | ((phase: BambiEvent['phase'], progress: number) => string[])) {
  const program = structuredClone(raw);
  for (const event of program.events) {
    const cycle = program.continuous ? Math.floor(event.atMs/program.durationMs)*program.durationMs : 0;
    const bounds = parentPhaseMs(event.phase, program.durationMs), progress = (event.atMs - cycle - bounds.start) / (bounds.end - bounds.start) * 100;
    const phrase = (typeof eligible === 'function' ? eligible(event.phase, progress) : eligible[event.phase])?.[0];
    if (!phrase) continue;
    const cue = { requiredTrigger: phrase, triggerAtMs: 1500, triggerCooldownMs: 12000 };
    if (event.fractionation) event.fractionation.speechA = { ...event.fractionation.speechA, targetMs: 4000, wordTarget: 4, ...cue };
    // A callback can carry the same established cue with fewer layers than its earlier context.
    if (event.type === 'motif_recall' && event.timing.activeMs >= 4000) event.speech = { ...event.speech, targetMs: 4000, wordTarget: 4, ...cue };
    if (event.fractionation) {
      event.fractionation.stateA.activeLayers = [...new Set([...event.fractionation.stateA.activeLayers, 'transition_sfx' as const])];
      // Sleep closes the visible scene at the spoken cue, not before the word.
      if(phrase.toUpperCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()==='BAMBI SLEEP') {
        event.fractionation.stateA={...event.fractionation.stateA,visualState:'motif',scene:event.baseline.scene,motifId:event.baseline.motifId,
          activeLayers:[...new Set([...event.fractionation.stateA.activeLayers,'motif_visual' as const])]};
      }
    }
    if (event.type === 'motif_recall' && event.speech.requiredTrigger) event.state.activeLayers = [...new Set([...event.state.activeLayers, 'transition_sfx' as const])];
  }
  return ProgramSchema.parse(program);
}

/** Optional development mappings. Speech-bound accents use compiled, measured word cue times. */
export function withHapticMappings(raw: BambiProgram) {
  const program = structuredClone(raw);
  const armed = (state: PresentationState): PresentationState => ({ ...state, activeLayers: [...new Set([...state.activeLayers, 'haptics' as const])] });
  for (const event of program.events) {
    let offsets: number[] = [];
    if (event.fractionation) {
      let t = event.timing.prepMs;
      for (const cycle of event.fractionation.cycles) { offsets.push(t); t += cycle.aMs + cycle.bMs; }
      event.fractionation.stateA = armed(event.fractionation.stateA);
    } else if (event.blink) { offsets = [event.timing.prepMs + (event.blink.spoken ? 250 : 0)]; event.blink.openState = armed(event.blink.openState); event.blink.closedState = armed(event.blink.closedState); }
    else if (event.type === 'peak') { offsets = [event.timing.prepMs]; event.state = armed(event.state); }
    else if (event.type === 'reset') { offsets = [event.timing.prepMs]; event.state = armed(event.state); }
    else if (event.type === 'mindwipe') { offsets = [event.timing.prepMs + event.timing.activeMs]; event.baseline = armed(event.baseline); }
    const spokenCues = compileEvent(event).speech.filter(slot => slot.speech.requiredTrigger || slot.speech.fixedCue);
    if (spokenCues.length) {
      event.state = armed(event.state);
      if(event.softReturn)for(const step of event.softReturn.steps)step.state=armed(step.state);
    }
    const command = { type: 'device', channel: 'vib', operation: 'buzz', intensity: .1, durationMs: 150 } as const;
    event.haptics = spokenCues.length
      ? spokenCues.map(slot => ({ offsetMs: slot.atMs - event.atMs + (slot.speech.triggerAtMs ?? slot.speech.cueAtMs!), speechSlotId: slot.id, command }))
      : offsets.map(offsetMs => ({ offsetMs, command }));
  }
  return ProgramSchema.parse(program);
}
