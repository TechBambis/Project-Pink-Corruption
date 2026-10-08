// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface SettingsContext {
  file: boolean;
  events: boolean;
  narration: boolean;
  sceneTimeline: boolean;
  scene: string;
  originalDroneAvailable: boolean;
  cloudCuesAvailable: boolean;
  on: (id: string) => boolean;
  value: (id: string) => string;
}

/** Reasons describe runtime ownership, not whether a session is currently running. */
export function settingsAvailability(s: SettingsContext): Record<string, string> {
  const reasons: Record<string, string> = {};
  const block = (ids: string[], reason: string) => {
    for (const id of ids) reasons[id] ??= reason;
  };
  const classic = ['adaptive-delivery', 'dual-voice', 'voice-echoes',
    ...['induction', 'deepening', 'conditioning', 'anchor', 'awakening'].map(p => 'narration-pause-' + p)];
  const manual = ['scene', 'visual-opacity', 'phase-visuals', 'visual-journey',
    'visual-fixation', 'visual-voice-sync', 'visual-tick-sync', 'motion', 'density'];
  const legacySound = ['sound-design', 'sound-defaults', 'sound-bass-fallback', 'tick-enabled', 'tick-defaults', 'tick-dives'];
  const cueOptions = ['trigger-snap', 'trigger-moan', 'trigger-extra-effects', 'trigger-moan-variant',
    'trigger-pop-variant', 'trigger-bubble-inflate', 'trigger-bubble-squeak', 'trigger-bubble-gap',
    'trigger-wiper-variant', 'trigger-wiper-seconds', 'trigger-effect-pause', 'trigger-plain-pause',
    ...['snap', 'moan', 'wiper', 'pop', 'inflate', 'squeak', 'tick', 'bell'].map(k => 'trigger-' + k + '-db')];
  if (s.file) {
    block([...classic, ...legacySound, ...cueOptions, 'trigger-sound', 'breath-sound',
      'background-drone', 'background-noise', 'background-drone-db', 'background-noise-db',
      'background-noise-type', 'original-sounds', 'brainwave-enabled', 'brainwave-preset',
      'brainwave-volume', 'bus-ambient', 'bus-effects', 'reset-background', 'event-haptics', 'trigger-preview'],
    'Files use their original audio. Extra session sounds and event cues are off.');
    block(['duration'], 'The selected file or playlist sets the duration.');
  } else {
    block(['bus-session'], 'Media volume applies when a file or playlist is selected.');
    block(['bambicloud-cues'], 'Timed cloud cues apply to library recordings with cue data.');
  }
  if (s.events) {
    block([...classic, ...legacySound, 'bus-ambient', 'device-phase-defaults', 'device-random-rotation'],
      'Guided events own this timing and layering. Use Session direction to shape the session.');
    block(manual, 'Guided events choose scenes and transitions. Spiral style settings still shape spiral layers.');
    block(['trigger-effect-pause', 'trigger-plain-pause'], 'Guided events schedule their own response windows; trigger sounds fit inside them.');
  } else {
    block(['event-haptics'], 'Enable engine events in Guided to use event vibration cues.');
    if (!s.narration) block(classic.filter(id => id !== 'voice-echoes'),
      'For classic continuous narration. Select Guided and turn engine events off to use these controls.');
  }
  if (s.sceneTimeline) block([...manual, 'spiral-style', 'spiral-depth', 'spiral-mode', 'spiral-speed',
    'spiral-complexity', 'spiral-color-a', 'spiral-color-b', 'spiral-alpha', 'immersive-presets', 'spiral-presets'],
    'The imported scene timeline controls these visuals. Remove its scene cues for manual control.');
  if (!s.on('visuals-enabled')) block([...manual, 'breath-visuals', 'spiral-style', 'spiral-depth',
    'spiral-mode', 'spiral-speed', 'spiral-complexity', 'spiral-color-a', 'spiral-color-b',
    'spiral-alpha', 'visual-reactivity', 'immersive-presets', 'spiral-presets'], 'Turn Show visuals on to use these settings.');
  if (s.on('reduced')) block(['motion', 'density', 'spiral-speed', 'visual-voice-sync',
    'visual-tick-sync', 'visual-reactivity'], 'Gentle motion keeps animation and added reactions still.');
  if (s.scene === 'Spiral Focus' || s.scene === 'Deep Tunnel') block(['motion', 'density'],
    'This renderer uses Spiral speed and Complexity instead of Motion and Particles.');
  if ((!s.on('visual-voice-sync') && !s.on('visual-tick-sync')) || s.events) block(['visual-reactivity'],
    'Reaction strength applies to the manual voice and tick reactions.');
  if (!s.value('voice2')) block(['voice-mix'], 'Choose a second voice to adjust its blend.');
  if (s.value('prompt-template') !== 'custom') block(['persona'], 'Choose Custom under Chat personality to use this text. Guided has its own Narration style.');
  if (!s.events) block(['guided-style'], 'Narration style applies to Guided engine events. Select Guided to use it.');
  else if (!s.on('narration-enabled') || ['off', 'text'].includes(s.value('ai-mode'))) {
    block(['guided-style'], 'Enable Guided narration and Read replies aloud to use a spoken narration style.');
  }
  if (!s.cloudCuesAvailable) block(['bambicloud-cues'], 'Choose a cloud recording with timed cue data to use this option.');
  if (!s.on('collar-enabled')) block(['collar-name'], 'Enable the collar to use a name.');
  if (!s.on('trigger-timing-enabled')) block(['trigger-stage-groups', 'trigger-reinforcement-start'],
    'Enable phase trigger categories to use this schedule.');
  if (!s.on('trigger-sound')) block(cueOptions, 'Turn trigger sounds on to configure their effects.');
  if (!s.on('trigger-snap')) block(['trigger-snap-db'], 'Enable snap to adjust its level.');
  if (!s.on('trigger-moan')) block(['trigger-moan-variant', 'trigger-moan-db'], 'Enable moan to adjust it.');
  if (!s.on('trigger-extra-effects')) block(['trigger-pop-variant', 'trigger-pop-db', 'trigger-wiper-variant',
    'trigger-wiper-seconds', 'trigger-wiper-db', 'trigger-bell-db', 'trigger-bubble-inflate',
    'trigger-bubble-squeak', 'trigger-bubble-gap', 'trigger-inflate-db', 'trigger-squeak-db'],
    'Enable extra trigger effects to configure these sounds.');
  if (!s.on('trigger-bubble-inflate')) block(['trigger-bubble-squeak', 'trigger-bubble-gap',
    'trigger-inflate-db', 'trigger-squeak-db'], 'Enable bubble inflation to configure this sequence.');
  if (!s.on('trigger-bubble-squeak')) block(['trigger-squeak-db'], 'Enable the squeak to adjust its level.');
  if (!s.on('tick-enabled')) block(['tick-defaults', 'tick-dives'], 'Enable the wooden tick to use its rhythm settings.');
  if (!s.on('sound-design')) block(['sound-defaults', 'sound-bass-fallback'], 'Enable spoken sound design to use these settings.');
  if (!s.on('brainwave-enabled')) block(['brainwave-preset', 'brainwave-volume'], 'Enable binaural tones to adjust them.');
  if (!s.on('background-drone')) block(['background-drone-db', 'original-sounds'], 'Enable the drone to adjust its background.');
  if (!s.on('background-noise')) block(['background-noise-db', 'background-noise-type'], 'Enable noise to adjust it.');
  const classicPreset = ['bambi_classic', 'bambi_classic_deep'].includes(s.value('audio-preset'));
  if (!classicPreset) block(['original-sounds'], 'The private original drone is available with Classic audio presets.');
  if (!s.originalDroneAvailable) block(['original-sounds'], 'The private original drone is not installed locally. Generated backgrounds remain available.');
  if (s.originalDroneAvailable && classicPreset && s.on('background-drone') && s.on('background-noise') && s.on('original-sounds')) {
    block(['background-noise-db', 'background-noise-type'], 'The recorded drone includes its own noise. Turn Private original drone off for generated noise controls.');
  }
  if (!s.on('device-speech-accents')) block(['device-accent-intensity', 'device-accent-duration'],
    'Enable spoken vibration cues to adjust them.');
  if (!s.on('device-phase-defaults')) block(['device-random-rotation'], 'Enable phase patterns to add random rotation.');
  if (s.value('device-rot-channel') === '0') block(['device-random-rotation', 'device-rot-lead'],
    'Assign a rotation channel to use rotation.');
  if (s.value('device-bridge') !== 'local') block(['device-write-char', 'device-auto-connect'],
    'These options apply to the local BLE bridge.');
  return reasons;
}

/** A separate fieldset preserves each control's own async/privacy disabled state. */
export class SettingsAvailability {
  private entries = new Map<string, {fieldset: HTMLFieldSetElement; note: HTMLElement; reason: string}>();
  private previous = '';

  sync(reasons: Record<string, string>, root: Document = document) {
    const signature = JSON.stringify(reasons);
    if (signature === this.previous) return;
    this.previous = signature;
    for (const id of new Set([...this.entries.keys(), ...Object.keys(reasons)])) {
      const reason = reasons[id] ?? '';
      let entry = this.entries.get(id);
      if (!entry && reason) {
        const control = root.getElementById(id);
        if (!control) continue;
        const target = control.closest('label') ?? control;
        const fieldset = root.createElement('fieldset');
        fieldset.className = 'setting-availability';
        target.before(fieldset);
        fieldset.append(target);
        const note = root.createElement('p');
        note.className = 'setting-unavailable-note';
        note.id = id + '-unavailable';
        fieldset.append(note);
        const described = control.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
        control.setAttribute('aria-describedby', [...new Set([...described, note.id])].join(' '));
        entry = {fieldset, note, reason: ''};
        this.entries.set(id, entry);
      }
      if (!entry || entry.reason === reason) continue;
      entry.reason = reason;
      entry.fieldset.disabled = !!reason;
      entry.fieldset.title = reason;
      entry.note.textContent = reason;
      entry.note.hidden = !reason;
    }
    // One visible explanation per reason in each section; every control retains
    // its accessible description and hover explanation, without repeated prose.
    const seen = new Map<Element, Set<string>>();
    for (const entry of this.entries.values()) {
      const section = entry.fieldset.closest('details, section') ?? entry.fieldset;
      const reasons = seen.get(section) ?? new Set<string>();
      const hidden = !entry.reason || reasons.has(entry.reason);
      if (entry.note.hidden !== hidden) entry.note.hidden = hidden;
      if (entry.reason) reasons.add(entry.reason);
      seen.set(section, reasons);
    }
  }
}
