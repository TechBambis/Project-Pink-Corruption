// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import { directionMechanisms, directionPreset, normalizeDirection, sessionDirections, type SessionDirection } from '../../../packages/session-director/direction';

export const directionPreferenceIds = ['session-direction', 'direction-contrast', 'direction-repetition', 'direction-rhythm', 'direction-motifs', 'direction-theme', ...directionMechanisms.map(key => 'direction-' + key)];
export const directionBooleanIds = directionMechanisms.map(key => 'direction-' + key);
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
export function initDirectionControls() {
  const select = document.getElementById('session-direction') as HTMLSelectElement;
  select.replaceChildren(...[...sessionDirections.map(style => new Option(style.name, style.id)), new Option('Custom', 'custom')]);
}
export function currentDirection(): SessionDirection {
  return normalizeDirection({ contrast: Number(field('direction-contrast').value) / 100, repetition: Number(field('direction-repetition').value) / 100,
    rhythm: field('direction-rhythm').value, motifs: field('direction-motifs').value, theme: field('direction-theme').value,
    mechanisms: directionMechanisms.filter(key => field('direction-' + key).checked) });
}
export function syncDirectionSummary(authored = false) {
  for (const key of ['contrast', 'repetition']) document.getElementById('direction-' + key + '-label')!.textContent = field('direction-' + key).value + '%';
  const style = sessionDirections.find(item => item.id === field('session-direction').value);
  document.getElementById('direction-description')!.textContent = authored ? 'Your imported program owns its scenes and timing. Choose “Use adaptive direction” to edit a style.' : style?.description ?? 'Your own combination of voice rhythm, motifs and session mechanisms.';
  const influence = document.getElementById('direction-influence')!;
  influence.textContent = style?.influence ?? ''; influence.hidden = authored || !style?.influence;
  (document.getElementById('direction-controls') as HTMLFieldSetElement).disabled = authored;
}
export function applyDirectionPreset(id: string) {
  const settings = directionPreset(id);
  for (const key of ['contrast', 'repetition'] as const) field('direction-' + key).value = String(Math.round(settings[key] * 100));
  for (const key of ['rhythm', 'motifs', 'theme'] as const) field('direction-' + key).value = settings[key];
  for (const key of directionMechanisms) field('direction-' + key).checked = settings.mechanisms.includes(key);
}
export function directionInput(id: string) {
  if (id === 'session-direction' && field(id).value !== 'custom') applyDirectionPreset(field(id).value);
  else if (id !== 'session-direction' && directionPreferenceIds.includes(id)) field('session-direction').value = 'custom';
}
