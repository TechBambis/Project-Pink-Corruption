// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {dualVoiceLevels} from '../speech/dual-voice';
import type {SessionPhase} from '../session-director/phases';

/** Runtime addition preserves the pinned upstream prompt documents. */
export function dualVoiceDirection(enabled:boolean,phase:SessionPhase='induction') {
 if(!enabled)return 'Dual Voice is disabled for this response. Use only [owner] spoken lines. Do not use [bambi] or [bambi:...] markers.';
 return `=== DUAL VOICE PROTOCOL (CRITICAL) ===
Use the shared Owner/INNER roles in one passage. Route Owner with [owner]; route the imagined listener response as BAMBI below.
Use one complete [bambi] spoken line for each background fragment, following the shared spoken block format.
Place each fragment immediately after the complete Owner sentence it echoes. The engine can play it softly in parallel with Owner speech; do not require an Owner pause or instruct Owner to wait for the inner voice. Keep short, contextual inner thoughts so the external guide stays intelligible. Markers describe routing, not the audio timeline.
Current phase: ${phase}. The inner-response route permits up to ${dualVoiceLevels[phase].fragments} fragments per complete passage; it need not fill every opportunity.
Induction: sparse, quiet first-person responses. Deepening: short responses related to the current imagery. Conditioning: connected responses that continue the same thought. Anchor: an inner response may use a complete sentence. Awakening: the guide clearly closes the session and restores ordinary orientation; inner responses are optional.
INNER carries no device/sound controls or named triggers. Use contextual thoughts instead of a fixed stock phrase.
Example:
[owner] Notice the warmth around you.
[bambi] I can feel that warmth.
[owner] Let the next thought come gently.
Do not explain or speak the markers.`;
}
