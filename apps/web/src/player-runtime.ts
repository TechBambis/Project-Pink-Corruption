// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export type PlayerState = 'idle' | 'preparing' | 'playing' | 'paused';
export interface PlayerSnapshot { readonly ready: boolean; readonly state: PlayerState; }
import type {Stage} from '../../../packages/session-director';
import type {SessionPhase} from '../../../packages/session-director/phases';
import type {MicrophoneState} from './microphone-button';

export interface ChatSnapshot {
 readonly draft: string;
 /** The existing composer decides which text is visible, including heard speech. */
 readonly replyText: string;
 readonly hearing: boolean;
 readonly inputAllowed: boolean;
}
export interface VoiceOption { readonly id: string; readonly label: string; }
export interface AudioSnapshot {
 readonly volume: number; readonly muted: boolean;
 readonly voice: string; readonly voices: readonly VoiceOption[];
 readonly volumeAllowed: boolean; readonly voiceAllowed: boolean;
}
export interface StatusSnapshot {
 readonly connection: 'connecting' | 'connected' | 'disconnected';
 readonly activity: 'idle' | 'preparing' | 'thinking' | 'speaking';
 readonly microphone: MicrophoneState;
 readonly message: string; readonly notice: string;
}
export interface SessionSnapshot {
 /** Presentation seconds only. Scheduling continues to use the runtime's audio clocks. */
 readonly elapsedSeconds: number; readonly durationSeconds: number;
 readonly unlimited: boolean; readonly stage: Stage; readonly phase: SessionPhase;
 readonly paused: boolean; readonly held: boolean;
}
export interface PlayerActions {
 togglePause(): Promise<void>; stop(): void; reportError(error: unknown): void;
 setDraft(text: string): void; submitDraft(): Promise<void>;
 setVolume(volume: number): void; setVoice(voice: string): void; toggleMute(): void;
}

function equalFields<T extends object>(left: T, right: T) {
 return (Object.keys(left) as (keyof T)[]).every(key => Object.is(left[key], right[key]));
}

/** Stable, immutable snapshots satisfy React's useSyncExternalStore contract. */
function createSnapshotStore<T extends object>(initial: T, equal = equalFields<T>) {
 let snapshot: Readonly<T> = Object.freeze({...initial});
 const listeners = new Set<() => void>();
 return {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  publish(next: T) {
   if (equal(snapshot, next)) return;
   snapshot = Object.freeze({...next});
   for (const listener of listeners) listener();
  },
 };
}

const equalVoices = (left: readonly VoiceOption[], right: readonly VoiceOption[]) =>
 left.length === right.length && left.every((voice, index) => voice.id === right[index].id && voice.label === right[index].label);

/** UI subscription only. The existing runtime owns audio, timing and cancellation. */
export function createPlayerRuntime() {
 const transport = createSnapshotStore<PlayerSnapshot>({ready: false, state: 'idle'});
 const chat = createSnapshotStore<ChatSnapshot>({draft: '', replyText: '', hearing: false, inputAllowed: false});
 const audioStore = createSnapshotStore<AudioSnapshot>({volume: .7, muted: false, voice: '', voices: Object.freeze([]), volumeAllowed: false, voiceAllowed: false},
  (left, right) => equalFields({...left, voices: undefined}, {...right, voices: undefined}) && equalVoices(left.voices, right.voices));
 const audio = {...audioStore, publish(next: AudioSnapshot) {
  const voices = equalVoices(audioStore.getSnapshot().voices, next.voices) ? audioStore.getSnapshot().voices :
   Object.freeze(next.voices.map(voice => Object.freeze({id: voice.id, label: voice.label})));
  audioStore.publish({...next, voices});
 }};
 const status = createSnapshotStore<StatusSnapshot>({connection: 'connecting', activity: 'idle', microphone: 'muted', message: '', notice: ''});
 const session = createSnapshotStore<SessionSnapshot>({elapsedSeconds: 0, durationSeconds: 0, unlimited: false, stage: 'IDLE', phase: 'induction', paused: false, held: false});
 let actions: PlayerActions | undefined;
 function invoke(action: () => void) {
  try { action(); } catch (error) { actions?.reportError(error); }
 }
 return {
  ...transport, chat, audio, status, session,
  bind(owner: PlayerActions) {
   if (actions) throw Error('The player already has a runtime owner.');
   actions = owner;
  },
  togglePause() {
   if (!actions || !transport.getSnapshot().ready || transport.getSnapshot().state === 'preparing') return;
   // Invoke synchronously so a click retains its browser audio activation.
   invoke(() => { void actions!.togglePause().catch(error => actions?.reportError(error)); });
  },
  stop() { invoke(() => actions?.stop()); },
  setDraft(text: string) {
   if (!transport.getSnapshot().ready || !chat.getSnapshot().inputAllowed || typeof text !== 'string' || text.length > 4000) return;
   invoke(() => actions?.setDraft(text));
  },
  async submitDraft() {
   if (!transport.getSnapshot().ready || !chat.getSnapshot().inputAllowed || !chat.getSnapshot().draft.trim()) return;
   try { await actions?.submitDraft(); } catch (error) { actions?.reportError(error); }
  },
  setVolume(volume: number) {
   if (!transport.getSnapshot().ready || !audio.getSnapshot().volumeAllowed || !Number.isFinite(volume) || volume < 0 || volume > 1) return;
   invoke(() => actions?.setVolume(volume));
  },
  setVoice(voice: string) {
   const snapshot = audio.getSnapshot();
   if (!transport.getSnapshot().ready || !snapshot.voiceAllowed || !snapshot.voices.some(option => option.id === voice)) return;
   invoke(() => actions?.setVoice(voice));
  },
  toggleMute() {
   if (transport.getSnapshot().ready) invoke(() => actions?.toggleMute());
  },
 };
}

export const playerRuntime = createPlayerRuntime();


export type PlayerRuntime = ReturnType<typeof createPlayerRuntime>;
