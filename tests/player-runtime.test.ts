// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerRuntime} from '../apps/web/src/player-runtime';
import type {PlayerActions} from '../apps/web/src/player-runtime';

const owner = (overrides: Partial<PlayerActions> = {}): PlayerActions => ({
 togglePause: async () => {}, stop() {}, reportError() {}, setDraft() {}, submitDraft: async () => {},
 setVolume() {}, setVoice() {}, toggleMute() {}, ...overrides,
});

test('player snapshots stay stable until a real change; subscriptions can remount', () => {
 const player = createPlayerRuntime(), initial = player.getSnapshot();
 let updates = 0;
 const remove = player.subscribe(() => updates++);
 player.publish({ready: false, state: 'idle'});
 assert.equal(player.getSnapshot(), initial);
 assert.equal(updates, 0);
 player.publish({ready: true, state: 'playing'});
 assert.equal(updates, 1);
 assert(Object.isFrozen(player.getSnapshot()));
 remove();
 player.publish({ready: true, state: 'paused'});
 assert.equal(updates, 1);
 const remount = player.subscribe(() => updates++);
 player.publish({ready: true, state: 'idle'});
 assert.equal(updates, 2);
 remount();
});

test('UI actions use one owner and Stop stays available during preparation', async () => {
 const player = createPlayerRuntime();
 let toggles = 0, stops = 0, reported: unknown;
 player.togglePause();
 player.stop();
 player.bind(owner({togglePause: async () => { toggles++; throw Error('Audio unavailable'); }, stop: () => stops++, reportError: error => { reported = error; }}));
 assert.throws(() => player.bind(owner()), /already/);
 player.togglePause();
 assert.equal(toggles, 0);
 player.publish({ready: true, state: 'preparing'});
 player.togglePause();
 player.stop();
 assert.equal(toggles, 0);
 assert.equal(stops, 1);
 player.publish({ready: true, state: 'idle'});
 player.togglePause();
 assert.equal(toggles, 1, 'Click reaches the owner synchronously for browser audio activation');
 await Promise.resolve();
 assert.match(String(reported), /Audio unavailable/);
});

test('session clock updates do not notify chat or audio consumers; voice choices are immutable copies', () => {
 const player = createPlayerRuntime();
 let chatUpdates = 0, audioUpdates = 0;
 player.chat.subscribe(() => chatUpdates++);
 player.audio.subscribe(() => audioUpdates++);
 const chat = player.chat.getSnapshot();
 const voices = [{id: 'af_heart', label: 'Heart'}];
 player.audio.publish({...player.audio.getSnapshot(), voices});
 const audio = player.audio.getSnapshot();
 voices[0].label = 'Changed upstream';
 assert.equal(audio.voices[0].label, 'Heart');
 assert(Object.isFrozen(audio.voices));
 assert(Object.isFrozen(audio.voices[0]));
 player.audio.publish({...audio, voices: [{id: 'af_heart', label: 'Heart'}]});
 for (let elapsedSeconds = 1; elapsedSeconds <= 10; elapsedSeconds++) player.session.publish({...player.session.getSnapshot(), elapsedSeconds});
 assert.equal(audioUpdates, 1);
 assert.equal(chatUpdates, 0);
 assert.equal(player.audio.getSnapshot(), audio);
 assert.equal(player.chat.getSnapshot(), chat);
});

test('commands respect readiness, locked input, bounded drafts, volume and available voices', async () => {
 const player = createPlayerRuntime(), calls: unknown[] = [];
 player.bind(owner({setDraft: text => calls.push(text), submitDraft: async () => { calls.push('submit'); },
  setVolume: value => calls.push(value), setVoice: voice => calls.push(voice), toggleMute: () => calls.push('mute')}));
 player.chat.publish({draft: 'hello', replyText: '', hearing: false, inputAllowed: true});
 player.audio.publish({...player.audio.getSnapshot(), volumeAllowed: true, voiceAllowed: true, voices: [{id: 'heart', label: 'Heart'}]});
 player.setDraft('blocked'); await player.submitDraft(); player.setVolume(.5); player.setVoice('heart'); player.toggleMute();
 assert.deepEqual(calls, []);
 player.publish({ready: true, state: 'playing'});
 player.setDraft('x'.repeat(4001)); player.setVolume(NaN); player.setVolume(Infinity); player.setVolume(-1); player.setVolume(1.1); player.setVoice('missing');
 assert.deepEqual(calls, []);
 player.setDraft('hello'); await player.submitDraft(); player.setVolume(0); player.setVolume(1); player.setVoice('heart'); player.toggleMute();
 assert.deepEqual(calls, ['hello', 'submit', 0, 1, 'heart', 'mute']);
 calls.length = 0;
 player.chat.publish({...player.chat.getSnapshot(), inputAllowed: false});
 player.audio.publish({...player.audio.getSnapshot(), volumeAllowed: false, voiceAllowed: false});
 player.setDraft('blocked'); await player.submitDraft(); player.setVolume(.5); player.setVoice('heart');
 assert.deepEqual(calls, []);
 player.chat.publish({...player.chat.getSnapshot(), inputAllowed: true, draft: '  '});
 await player.submitDraft();
 assert.deepEqual(calls, []);
});

test('synchronous owner failures and rejected chat requests reach the existing error reporter', async () => {
 const player = createPlayerRuntime(), errors: unknown[] = [];
 player.bind(owner({togglePause: () => { throw Error('Sync start failure'); }, stop: () => { throw Error('Stop failure'); },
  submitDraft: async () => { throw Error('Chat unavailable'); }, reportError: error => errors.push(error)}));
 player.publish({ready: true, state: 'idle'});
 player.chat.publish({draft: 'hello', replyText: '', hearing: false, inputAllowed: true});
 player.togglePause(); player.stop(); await player.submitDraft();
 assert.deepEqual(errors.map(String), ['Error: Sync start failure', 'Error: Stop failure', 'Error: Chat unavailable']);
});
