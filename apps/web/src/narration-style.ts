// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export const defaultNarrationStyle = 'Soft, playful, dreamy and affectionate';

/** The legacy persona also styled Guided; split it without changing that behavior. */
export function migrateNarrationStyle(stored: Record<string, unknown>): Record<string, unknown> {
  return {...stored, 'guided-style': typeof stored['guided-style'] === 'string'
    ? stored['guided-style']
    : typeof stored.persona === 'string' ? stored.persona : defaultNarrationStyle};
}
