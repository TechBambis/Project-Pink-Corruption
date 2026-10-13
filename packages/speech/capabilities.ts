// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface SpeechCapabilities {languages:string[];streaming:boolean;wordTimings:boolean;scriptControls:boolean;voiceBlending:boolean}
export interface SpeechStreamPacket {id:string;final:boolean;index:number;offset:number;samples:number;sampleRate:number;channels:number}
export const isMossVoice=(voice:string)=>/^moss_[a-z][a-z0-9_]{0,47}$/.test(voice);
export const mossCapabilities:SpeechCapabilities={languages:['en'],streaming:true,wordTimings:false,scriptControls:true,voiceBlending:false};
