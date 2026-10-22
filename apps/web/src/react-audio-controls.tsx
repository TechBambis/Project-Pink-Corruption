// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {useSyncExternalStore} from 'react';
import {playerRuntime} from './player-runtime';

export function AudioControls() {
 const audio = useSyncExternalStore(playerRuntime.audio.subscribe, playerRuntime.audio.getSnapshot);
 const {ready} = useSyncExternalStore(playerRuntime.subscribe, playerRuntime.getSnapshot);
 const label = audio.muted ? 'Unmute audio' : 'Mute audio';
 return <>
  <button id="mute" type="button" className="quiet" aria-label={label} aria-pressed={audio.muted}
   data-muted={String(audio.muted)} title={label} disabled={!ready} onClick={playerRuntime.toggleMute}>
   <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4z" />
    <path className="speaker-waves" d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    <path className="speaker-cross" d="m16 9 6 6m0-6-6 6" /></svg>
  </button>
  <label className="master"><span className="sr-only">Volume</span>
   <input id="master" type="range" min="0" max="1" step="0.01" aria-label="Volume" value={audio.volume}
    disabled={!ready || !audio.volumeAllowed} onInput={event => playerRuntime.setVolume(Number(event.currentTarget.value))} onChange={() => {}} />
  </label>
 </>;
}

export function VoiceSelect() {
 const audio = useSyncExternalStore(playerRuntime.audio.subscribe, playerRuntime.audio.getSnapshot);
 const {ready} = useSyncExternalStore(playerRuntime.subscribe, playerRuntime.getSnapshot);
 return <select id="voice" value={audio.voice} disabled={!ready || !audio.voiceAllowed}
  onInput={event => playerRuntime.setVoice(event.currentTarget.value)} onChange={() => {}}>
  {audio.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
 </select>;
}
