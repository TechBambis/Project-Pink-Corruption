// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface AudioPreset {
  id: string; label: string; description: string; voice: string; speed: number; pitchSemitones: number; sampleRate: number;
  timing: Record<'normal'|'short'|'medium'|'long'|'transition',number>;
  trigger?: {speedMultiplier:number;volumeDb:number};
  processing: { enabled:boolean; highpassHz:number; eqHz:number; eqDb:number; compressionRatio:number; thresholdDb:number; attackMs:number; releaseMs:number; echoEnabled:boolean; echoMs:number };
  drone: {enabled:boolean;left:{lowHz:number;highHz:number};right:{lowHz:number;highHz:number};highModHz:number;lowModHz:number;modDepth:number};
  noise: {enabled:boolean;type:'pink'|'white'|'brown';lowpassHz:number;width:number};
  layers: Record<'left_voice'|'right_voice',{enabled:boolean;voice:string;delayMs:number;speed:number;pitchSemitones:number;pan:number}>;
  mix: Record<'main_voice'|'left_voice'|'right_voice'|'echo_voice'|'drone'|'noise'|'music_optional',number>;
  limiterPeak:number;
}
