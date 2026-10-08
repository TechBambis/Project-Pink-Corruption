// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

export type Experience = 'conversation' | 'guided' | 'files';
export interface ExperienceState { mode: string; narration: boolean; events: boolean; aiMode: string; }

/** Derive the product choice from existing saved engine preferences. */
export function selectedExperience(state: ExperienceState): Experience {
  return state.mode !== 'conversation' ? 'files' : state.narration || state.events ? 'guided' : 'conversation';
}

export function needsExperienceChange(choice: Experience, state: ExperienceState): boolean {
  return choice !== selectedExperience(state)
    || choice === 'files' && state.mode === 'official'
    || choice === 'conversation' && state.aiMode === 'off'
    || choice === 'guided' && (!state.events || !state.narration || ['off', 'text'].includes(state.aiMode));
}

/** Explicit choices change only the controls needed for that experience. */
export function experienceSettings(choice: Experience, state: ExperienceState, join: boolean): Record<string, string | boolean> {
  if (choice === 'files') return {mode: join ? 'hybrid' : 'local'};
  return {
    mode: 'conversation',
    'narration-enabled': choice === 'guided',
    'session-events': choice === 'guided',
    'conversation-style': choice === 'guided' ? 'reactive' : 'situational',
    ...(state.aiMode === 'off' || choice === 'guided' && state.aiMode === 'text' ? {'ai-mode': 'voice'} : {}),
  };
}

/** Keep a visible heading in place; otherwise bring the destination into view. */
export function sectionScrollTarget(position: number, top: number, bottom: number, navHeight: number, viewportHeight: number): number {
  const inset = navHeight + 16;
  return top >= inset && bottom <= viewportHeight - 32 ? position : Math.max(0, position + top - inset);
}
