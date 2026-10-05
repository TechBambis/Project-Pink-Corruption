// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {effectForTrigger,triggerEffectMap} from './trigger-sequence';
/** Local additions; the pinned STABLE-2.0 reference files remain untouched. */
export const triggerSoundSettings = {
  version: 1,
  timing: 'moan_snap_speech_effect_pause',
  source: 'Generated CC0 fallback assets; user-selected private MP3s take precedence locally.',
  sounds: {
    snap: { label: 'Finger snap', file: 'finger-snap.wav', duration: .18, gainDb: 0, cooldownMs: 700 },
    wiper: { label: 'Wipers · five seconds', file: 'windshield-wiper.wav', duration: 5, gainDb: 0, cooldownMs: 1800 },
    pop: {label:'Balloon pop · generated fallback',file:'balloon-pop.wav',duration:.35,gainDb:0,cooldownMs:0},
    inflate: {label:'Balloon inflation · generated fallback',file:'balloon-inflate.wav',duration:2.2,gainDb:0,cooldownMs:0},
    squeak: {label:'Balloon squeak · generated fallback',file:'balloon-squeak.wav',duration:.45,gainDb:0,cooldownMs:0},
    tick: {label:'Metronome tick',file:'metronome-tick.wav',duration:.1,gainDb:0,cooldownMs:0},
    bell: {label:'Bell · generated fallback',file:'bell-chime.wav',duration:1.5,gainDb:0,cooldownMs:0},
    beep: { label: 'Original chat beep', file: 'trigger-beep.wav', duration: .1, gainDb: 0, cooldownMs: 250 },
  },
  mappings: Object.entries(triggerEffectMap).map(([trigger,sound])=>({trigger,sound,basis:'User-defined effect after the universal Snap and spoken trigger.'})),
} as const;

export type TriggerSound = keyof typeof triggerSoundSettings.sounds;

export function soundForTrigger(name = ''): TriggerSound {
  const key = name.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return effectForTrigger(key) ?? 'snap';
}

export function findTriggers(text: string, names: string[]): { name: string; index: number }[] {
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length);
  if (!unique.length) return [];
  const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b(${unique.map(escape).join('|')})\\b`, 'gi');
  return [...text.matchAll(pattern)].map(match => ({
    name: unique.find(name => name.toLowerCase() === match[0].toLowerCase())!, index: match.index!,
  }));
}
