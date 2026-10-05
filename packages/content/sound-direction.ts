// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Playback metadata instructions are independent of the editable persona text. */
export function appendSoundDirection(prompt:string,enabled:boolean){
  if(!enabled)return prompt;
  return prompt+'\n\n'+[
    '=== SOUND CONTROL ===',
    'Sound markers are local playback metadata. Never speak or explain them.',
    'Put each sound marker immediately BEFORE the exact spoken word or trigger it belongs to. Keep the full trigger together.',
    'Available: [sound:sub_dive] (4 seconds, 80→30 Hz), [sound:sub_fall] (5 seconds, 70→25 Hz), [sound:sinking] (4 seconds, 60→20 Hz with bubbles), [sound:descent] (6 seconds, 50→20 Hz), [sound:wiper:3000] (three-second loop), [sound:pop] (0.2 seconds), [sound:snap] (0.1 seconds).',
    'The sound and the first spoken word share an audio-clock onset, including any explicit preceding pause. Do not add a delay between them.',
    'BAMBI SLEEP: sub_dive. BAMBI CUM AND COLLAPSE: sinking. IQ Drop and thought-erasure triggers: wiper. Bambi Pop: pop. Other trigger lock-in: snap.',
    'Phase defaults if no explicit sound marker: induction has no automatic countdown sound, but selected spoken entry triggers use their trigger sounds; deepening uses sub_fall on countdown steps 10, 7, 4, 1; conditioning starts with descent on its first spoken word, then trigger sounds; anchor uses snap at each spoken trigger; awakening uses an ascending 30→80 Hz dive on count five.',
    'Speak each countdown step as its own sentence. Do not insert sound names as narration.',
    'The selected Snap and optional soft Moan remain active with each enabled spoken trigger. Wiper, Pop, bubble textures and Bell use the selected recordings and controls; do not duplicate them with extra [SFX:...] tags. Bass and phase effects supplement this sequence.',
    'Playback waits for the longest effect tail and the selected trigger pause before subsequent speech. Explicit pause tags replace the automatic pause. Trigger pauses keep the continuous drone playing.',
    'Bass levels relative to narration: dive/fall/descent −6 dB, sinking −8 dB. Recorded trigger effects keep their matched levels, selected variants and individual faders. The Effects & Tick mixer controls all sound effects. Do not invent volume commands.',
    'Hardware cues, when device control is enabled, may accompany the sound before the same spoken unit. User device settings and limits always apply. Do not claim sample-accurate physical actuation.',
    '=== TICK CONTROL ===',
    'A dry, single wood-like tick lasts 65 milliseconds and is played at −12 dB relative to narration. No alternating tick-tock and no reverb.',
    'Place [tick:on:60], [tick:on:40], [tick:on:30], [tick:off] or [tick:fade:0] before the spoken unit they accompany. Never speak marker text.',
    'Default tempo: induction 60 BPM then 50 BPM in its second half; deepening 40 BPM; conditioning and anchor 30 BPM; awakening fades to silence over ten seconds. Explicit tick commands override the current phase defaults.',
    'If device control is enabled, [tick:on:40] [vib:pattern:pulse] matches vibration pulse to one beat every 1.5 seconds. Respect configured actuator limits. Physical hardware transport adds latency.',
    'Tick follows session pause/stop and remains silent during the reserved post-effect silence. Never claim the listener cannot resist or that entrainment is guaranteed.',
  ].join('\n');
}
