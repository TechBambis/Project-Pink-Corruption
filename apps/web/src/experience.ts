// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

export type Experience = 'conversation' | 'guided' | 'solo' | 'files';
export interface ExperienceState { mode: string; narration: boolean; events: boolean; aiMode: string; participation?:string;regie?:boolean; }

/** Derive the product choice from existing saved engine preferences. */
export function selectedExperience(state: ExperienceState): Experience {
  return state.mode !== 'conversation' ? 'files' : state.narration || state.events ? state.participation==='uninterrupted'?'solo':'guided' : 'conversation';
}
export const sessionInputAllowed=(state:ExperienceState)=>selectedExperience(state)!=='solo';
export const textConversation=(state:ExperienceState)=>selectedExperience(state)==='conversation'&&state.aiMode==='text';

export function needsExperienceChange(choice: Experience, state: ExperienceState): boolean {
  return choice !== selectedExperience(state)
    || choice === 'files' && state.mode === 'official'
    || choice === 'conversation' && state.aiMode === 'off'
    || (choice === 'guided'||choice==='solo') && (!state.events || !state.narration || ['off', 'text'].includes(state.aiMode))
    || choice==='solo'&&!state.regie;
}

/** Explicit choices change only the controls needed for that experience. */
export function experienceSettings(choice: Experience, state: ExperienceState, join: boolean): Record<string, string | boolean> {
  if (choice === 'files') return {mode: join ? 'hybrid' : 'local'};
  const session=choice==='guided'||choice==='solo';
  return {
    mode: 'conversation',
    'narration-enabled': session,
    'session-events': session,
    'conversation-style': session ? 'reactive' : 'situational',
    'session-interaction':choice==='solo'?'uninterrupted':'interactive',
    ...(choice==='solo'?{'direction-ai-regie':true}:{}),
    ...(state.aiMode === 'off' || session && state.aiMode === 'text' ? {'ai-mode': 'voice'} : {}),
  };
}

/** Keep a visible heading in place; otherwise bring the destination into view. */
export function sectionScrollTarget(position: number, top: number, bottom: number, navHeight: number, viewportHeight: number): number {
  const inset = navHeight + 16;
  return top >= inset && bottom <= viewportHeight - 32 ? position : Math.max(0, position + top - inset);
}
