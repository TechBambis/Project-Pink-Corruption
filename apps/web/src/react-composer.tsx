// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {useLayoutEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {flushSync} from 'react-dom';
import {playerRuntime,type PlayerRuntime} from './player-runtime';

// The composer publishes from the existing heard-text observer. Commit this
// projection before other observers/paint see the matching spoken word.
const synchronousChat = (runtime: PlayerRuntime) => (listener: () => void) => runtime.chat.subscribe(() => flushSync(listener));

export function ComposerFields({runtime = playerRuntime}: {runtime?: PlayerRuntime}) {
 const subscribeChat = useMemo(() => synchronousChat(runtime),[runtime]);
 const chat = useSyncExternalStore(subscribeChat, runtime.chat.getSnapshot);
 const {ready} = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
 const input = useRef<HTMLTextAreaElement>(null), reply = useRef<HTMLDivElement>(null);
 const atEnd = useRef(true);
 const editing = !!chat.draft.length && chat.inputAllowed;
 useLayoutEffect(() => {
  const form = document.getElementById('chat-form') as HTMLFormElement;
  form.dataset.editing = String(editing);
  form.dataset.drafting = String(!!chat.draft.length);
  form.dataset.inputAllowed = String(chat.inputAllowed);
 }, [editing, chat.draft, chat.inputAllowed]);
 useLayoutEffect(() => {
  const element = input.current!;
  element.style.height = '48px';
  if (chat.draft) element.style.height = Math.min(104, Math.max(48, element.scrollHeight)) + 'px';
 }, [chat.draft]);
 useLayoutEffect(() => {
  if (atEnd.current && reply.current) reply.current.scrollTop = reply.current.scrollHeight;
 }, [chat.replyText, editing]);
 useLayoutEffect(() => {
  const form = document.getElementById('chat-form')!;
  const submit = (event: Event) => { event.preventDefault(); void runtime.submitDraft(); };
  form.addEventListener('submit', submit);
  return () => form.removeEventListener('submit', submit);
 }, [runtime]);
 return <>
  <div id="composer-reply" className="composer-reply" ref={reply} hidden={editing}
   onClick={() => { if (ready && chat.inputAllowed) input.current?.focus(); }}
   onScroll={() => { const element = reply.current!; atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24; }}>
   {chat.replyText || 'Message Bambi, or turn on your mic.'}
  </div>
  <label className="sr-only" htmlFor="chat-input">Message Bambi</label>
  <textarea id="chat-input" ref={input} rows={2} maxLength={4000} aria-describedby="composer-help"
   value={chat.draft} placeholder={chat.replyText || 'Message Bambi…'} disabled={!ready || !chat.inputAllowed}
   onInput={event => runtime.setDraft(event.currentTarget.value)} onChange={() => {}}
   onKeyDown={event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
     event.preventDefault(); if (!event.repeat) void runtime.submitDraft();
    }
   }} />
 </>;
}

export function ComposerSend({runtime = playerRuntime}: {runtime?: PlayerRuntime}) {
 const chat = useSyncExternalStore(runtime.chat.subscribe, runtime.chat.getSnapshot);
 const {ready} = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
 return <button type="submit" className="send" aria-label="Send message" title="Send message"
  disabled={!ready || !chat.inputAllowed || !chat.draft.trim()}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
 </button>;
}
