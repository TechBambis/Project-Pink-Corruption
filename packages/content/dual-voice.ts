// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {dualVoiceLevels} from '../speech/dual-voice';
import type {SessionPhase} from '../session-director/phases';

/** Runtime addition preserves the pinned upstream prompt documents. */
export function dualVoiceDirection(enabled:boolean,phase:SessionPhase='induction') {
 if(!enabled)return 'Dual Voice is disabled for this response. Write only the main voice. Do not use [owner], [bambi] or [bambi:...] markers.';
 return `=== DUAL VOICE PROTOCOL (CRITICAL) ===
Write two distinct voices in the SAME session passage.
OWNER is the main voice: guidance, commands, triggers and structure. Use [owner] before its passages.
BAMBI is the softer background voice: feelings and first-person experience, never commands or triggers.
Use [bambi:...feeling...] for each background fragment. Block form [bambi] ... [owner] is also supported.
Place each fragment AFTER an Owner [pause:medium], [pause:long] or [pause:transition]. Owner waits in silence until the fragment finishes. Never overlap the voices.
Current phase: ${phase}. Bambi contributes ${dualVoiceLevels[phase].fragments} per complete passage.
Induction: sparse, quiet feelings such as “so warm” or “I'm soft”. Deepening: more short fragments. Conditioning: more connected feelings. Anchor: Bambi uses complete sentences; Owner contributes only a brief “Good girl.” Awakening: Bambi speaks the closing sentences and Owner contributes one final word before silence.
Bambi never issues instructions, device/sound controls or named triggers. Only Owner uses those controls.
Example: [owner] Breathe gently. [pause:long] [bambi:…so warm…] [owner] Good girl. [pause:long]
Do not explain or speak the markers.`;
}
