// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {initPlayerComposer} from '../apps/web/src/player-composer';
import {createPlayerRuntime} from '../apps/web/src/player-runtime';

/** Minimal DOM boundary: no browser, services, audio or inference are started. */
function fixture(render: boolean, run: (context: ReturnType<typeof install>) => void) {
 const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
 const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
 function install() {
  const listeners = new Map<string, () => void>();
  const node = (id: string) => ({
   value: '', textContent: '', hidden: false, disabled: false, placeholder: '',
   dataset: {} as Record<string, string>, style: {height: ''},
   scrollHeight: 140, scrollTop: 0, clientHeight: 60,
   addEventListener: (type: string, listener: () => void) => listeners.set(id + ':' + type, listener),
   focus() {},
  });
  const input = node('input'), preview = node('preview'), send = node('send');
  const form = {...node('form'), querySelector: () => send};
  let replies: {textContent: string; dataset: Record<string, string>}[] = [];
  const messages = {querySelectorAll: () => replies};
  let notify = () => {}, observations = 0;
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {
   getElementById: (id: string) => ({'chat-input': input, 'composer-reply': preview, 'chat-form': form, messages}[id]),
  }});
  Object.defineProperty(globalThis, 'MutationObserver', {configurable: true, value: class {
   constructor(callback: () => void) { notify = callback; }
   observe(target: unknown) { assert.equal(target, messages); observations++; }
  }});
  if (!render) {
   // React owns these fields; writes by the old composer must fail this test.
   for (const item of [input, preview, send, form]) {
    Object.freeze(item.dataset); Object.freeze(item.style); Object.freeze(item);
   }
  }
  const runtime = createPlayerRuntime();
  const composer = initPlayerComposer(snapshot => runtime.chat.publish(snapshot), render);
  return {composer, runtime, input, preview, send, form, listeners, observations,
   reply(textContent: string, displayText?: string) {
    replies = [{textContent, dataset: displayText === undefined ? {} : {displayText}}]; notify();
   },
  };
 }
 try { run(install()); }
 finally {
  for (const [key, descriptor] of [['document', originalDocument], ['MutationObserver', originalObserver]] as const) {
   if (descriptor) Object.defineProperty(globalThis, key, descriptor);
   else Reflect.deleteProperty(globalThis, key);
  }
 }
}

test('React composer owns its draft without writing UI fields or installing duplicate input handlers', () => {
 fixture(false, ({composer, runtime, input, listeners, observations}) => {
  assert.equal(observations, 1);
  assert.equal(listeners.size, 0);
  composer.setDraft('A multiline\nuser draft');
  assert.equal(runtime.chat.getSnapshot().draft, 'A multiline\nuser draft');
  assert.equal(composer.getDraft(), 'A multiline\nuser draft');
  assert.equal(input.value, '', 'A stale React DOM projection cannot replace the owned draft');
  composer.setInputAllowed(false);
  assert.equal(runtime.chat.getSnapshot().inputAllowed, false);
  assert.equal(runtime.chat.getSnapshot().draft, 'A multiline\nuser draft', 'Mode changes retain user-owned drafts');
  composer.setInputAllowed(true); composer.setDraft('');
  assert.equal(runtime.chat.getSnapshot().draft, '');
 });
});

test('React composer exposes heard words instead of queued speech, preserving the draft across reply updates', () => {
 fixture(false, ({composer, runtime, reply}) => {
  composer.setDraft('My next question');
  reply('The entire queued sentence has not been heard.', 'The');
  assert.equal(runtime.chat.getSnapshot().replyText, 'The');
  assert.equal(runtime.chat.getSnapshot().draft, 'My next question');
  composer.hearing('My provisional speech');
  assert.equal(runtime.chat.getSnapshot().replyText, 'My provisional speech');
  assert.equal(runtime.chat.getSnapshot().hearing, true);
  reply('The entire queued sentence has not been heard.', 'The entire');
  composer.clearHearing();
  assert.equal(runtime.chat.getSnapshot().replyText, 'The entire');
  assert.equal(runtime.chat.getSnapshot().hearing, false);
  reply('Unheard tokens should stay unavailable.', '');
  assert.equal(runtime.chat.getSnapshot().replyText, 'Bambi is replying…');
  reply('A complete text-only reply.');
  assert.equal(runtime.chat.getSnapshot().replyText, 'A complete text-only reply.');
 });
});

test('existing composer still renders replies, draft input and locks through its original DOM handlers', () => {
 fixture(true, ({composer, runtime, input, preview, send, listeners, reply}) => {
  input.value = 'My draft'; listeners.get('input:input')!();
  assert.equal(runtime.chat.getSnapshot().draft, 'My draft');
  assert.equal(preview.hidden, true);
  assert.equal(input.style.height, '104px');
  composer.setDraft('');
  reply('Full raw speech.', 'Full');
  assert.equal(preview.textContent, 'Full');
  assert.equal(preview.hidden, false);
  composer.setInputAllowed(false);
  assert.equal(input.disabled, true); assert.equal(send.disabled, true);
  composer.setInputAllowed(true); composer.setDraft('Another draft');
  assert.equal(input.disabled, false); assert.equal(send.disabled, false);
  assert.equal(input.value, 'Another draft');
 });
});
