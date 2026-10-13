// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {dualVoiceLevels} from '../speech/dual-voice';
import type {SessionPhase} from '../session-director/phases';

/** Runtime addition preserves the pinned upstream prompt documents. */
export function dualVoiceDirection(enabled:boolean,phase:SessionPhase='induction') {
 if(!enabled)return 'Dual Voice is disabled for this response. Write only the main voice. Do not use [owner], [bambi] or [bambi:...] markers.';
 return `=== DUAL VOICE PROTOCOL (CRITICAL) ===
Write guidance and the listener's imagined inner response in the SAME session passage.
OWNER is the guiding voice: guidance, commands, triggers and structure. Use [owner] before its passages.
BAMBI is only a technical routing label for the listener's imagined subconscious/inner response, not another character or a second guide. Its text uses the listener's first-person perspective, never commands or triggers. Do not assert that an imagined response proves what the listener feels.
Use [bambi:...feeling...] for each background fragment. Block form [bambi] ... [owner] is also supported.
Place each fragment AFTER an Owner [pause:medium], [pause:long] or [pause:transition]. Owner waits in silence until the fragment finishes. Never overlap the voices.
Current phase: ${phase}. The inner-response route permits up to ${dualVoiceLevels[phase].fragments} fragments per complete passage; it need not fill every opportunity.
Induction: sparse, quiet first-person responses. Deepening: short responses related to the current imagery. Conditioning: connected responses that continue the same thought. Anchor: an inner response may use a complete sentence. Awakening: the guide clearly closes the session and restores ordinary orientation; inner responses are optional.
Inner responses never issue instructions, device/sound controls or named triggers. Only the guide uses those controls. Keep the response related to the present passage; do not insert a fixed stock phrase.
Example: [owner] Breathe gently. [pause:long] [bambi:…so warm…] [owner] Good girl. [pause:long]
Do not explain or speak the markers.`;
}
