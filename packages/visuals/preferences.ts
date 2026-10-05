// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { SPIRAL_COMPLEXITY_MAX } from '../safety/actions';

/** Upgrade the two known costly presets; leave custom/manual configurations intact. */
export function migrateVisualPreferences(stored: Record<string, unknown>) {
  const bounded = (value: Record<string, unknown>) => Number(value['spiral-complexity']) > SPIRAL_COMPLEXITY_MAX ? {...value, 'spiral-complexity':String(SPIRAL_COMPLEXITY_MAX)} : value;
  if (stored['visuals-version'] === 2) return bounded(stored);
  const result: Record<string, unknown> = { ...stored, 'visuals-version': 2 };
  const original = stored['spiral-style'] === undefined || stored['spiral-style'] === 'original';
  if (original && stored['phase-visuals'] === true) result['visual-journey'] = true;
  if (original && Number(stored['spiral-speed']) === .35 && Number(stored['spiral-complexity']) === 1.6 && stored['spiral-mode'] === 'breathe') {
    Object.assign(result, { 'spiral-style': 'loop', 'spiral-speed': '.55', 'spiral-complexity': '1.4', 'spiral-depth': '.85', 'spiral-alpha': '1' });
  } else if (original && Number(stored['spiral-speed']) === 2.25 && Number(stored['spiral-complexity']) === 2.2 && stored['spiral-mode'] === 'colorCycle') {
    Object.assign(result, { 'spiral-style': 'fractal', 'spiral-speed': '.5', 'spiral-complexity': '1.5', 'spiral-depth': '.9', 'spiral-alpha': '1' });
  }
  return bounded(result);
}
