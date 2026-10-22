// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {StrictMode, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal, flushSync} from 'react-dom';
import {createHashHistory, createRootRoute, createRoute, createRouter, Link, Outlet, redirect, RouterProvider} from '@tanstack/react-router';
import {installNavigationDriver, isWorkspaceView, type NavigationIntent, type NavigationLocation, workspaceViews} from './navigation-driver';
import {playerRuntime} from './player-runtime';
import {ComposerFields, ComposerSend} from './react-composer';
import {AudioControls, VoiceSelect} from './react-audio-controls';
import './react-player.css';

const labels = {session: 'Session', files: 'Library', voice: 'Voice & AI', visuals: 'Visuals', sound: 'Sound', devices: 'Devices', extras: 'Extras'};
const navigation = document.getElementById('primary-navigation')!;
const originalPlay = document.getElementById('pause')!;
const originalStop = document.getElementById('panic')!;
const navHost = document.createElement('div');
navHost.className = 'react-navigation-host';
navigation.querySelectorAll('[data-nav]').forEach(node => node.remove());
navigation.prepend(navHost);
const playHost = document.createElement('div');
playHost.className = 'react-player-controls';
originalPlay.replaceWith(playHost);
originalStop.remove();
const form = document.getElementById('chat-form')!;
const composerHost = form.querySelector<HTMLElement>('.composer-field')!;
composerHost.replaceChildren();
const sendHost = document.createElement('span');
sendHost.className = 'react-owned-host';
form.querySelector('button[type="submit"]')!.replaceWith(sendHost);
const originalMute = document.getElementById('mute')!;
const originalVolume = document.getElementById('master') as HTMLInputElement;
const originalVoice = document.getElementById('voice') as HTMLSelectElement;
playerRuntime.audio.publish({...playerRuntime.audio.getSnapshot(), volume: Number(originalVolume.value),
 voice: originalVoice.value, voices: [...originalVoice.options].map(option => ({id: option.value, label: option.textContent ?? option.value})),
 volumeAllowed: true, voiceAllowed: true});
const audioHost = document.createElement('span'), voiceHost = document.createElement('span');
audioHost.className = voiceHost.className = 'react-owned-host';
originalMute.replaceWith(audioHost);
originalVolume.closest('label')!.remove();
originalVoice.replaceWith(voiceHost);

// Preserve existing deep links during migration without putting private data in URLs.
let initialTarget = 'session';
try {
 const hash = decodeURIComponent(location.hash.slice(1));
 initialTarget = hash && !hash.startsWith('/') ? hash : 'session';
} catch { /* Invalid links open the session. */ }
if (!location.hash.startsWith('#/')) {
 const target = document.getElementById(initialTarget.replace(/^setting-/, ''));
 const candidate = isWorkspaceView(initialTarget) ? initialTarget : target?.closest<HTMLElement>('[data-view]')?.dataset.view;
 const view = candidate && isWorkspaceView(candidate) ? candidate : 'session';
 const search = view !== initialTarget && target ? '?' + new URLSearchParams({target: initialTarget}).toString() : '';
 history.replaceState(null, '', location.pathname + location.search + '#/' + view + search);
}

function PlayerControls() {
 const {ready, state} = useSyncExternalStore(playerRuntime.subscribe, playerRuntime.getSnapshot, playerRuntime.getSnapshot);
 const label = state === 'preparing' ? 'Preparing' : state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Start';
 return <>
  <button id="pause" type="button" className="session-play" data-state={state}
   disabled={!ready || state === 'preparing'} aria-label={state === 'preparing' ? 'Preparing session' : label + ' session'}
   aria-busy={state === 'preparing'} aria-keyshortcuts="Space" onClick={playerRuntime.togglePause}>
   <span id="play-icon" aria-hidden="true">{state === 'preparing' ? '◌' : state === 'playing' ? 'Ⅱ' : '▶'}</span>
   <span id="play-label">{label}</span>
  </button>
  <button id="panic" type="button" className="quiet" disabled={!ready} aria-label="End session"
   title="End session · stop audio, AI, microphone and devices" onClick={playerRuntime.stop}>Stop</button>
 </>;
}

function SessionStop() {
 const {ready, state} = useSyncExternalStore(playerRuntime.subscribe, playerRuntime.getSnapshot, playerRuntime.getSnapshot);
 return ready && state !== 'idle' ? <button id="persistent-stop" type="button" className="react-global-stop"
  onClick={playerRuntime.stop}>Stop session</button> : null;
}

function Workspace() {
 return <>
  {createPortal(workspaceViews.map(view => <Link key={view} to="/$view" params={{view}} search={{target: undefined}}
   className="nav-item" data-nav={view} data-router-link="true" activeProps={{'aria-current': 'page'}} resetScroll={false}
   onClick={event => { if(event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey)nextIntent='tab'; }}>
   <span>{labels[view]}</span>
  </Link>), navHost)}
  {createPortal(<PlayerControls />, playHost)}
  {createPortal(<ComposerFields />, composerHost)}
  {createPortal(<ComposerSend />, sendHost)}
  {createPortal(<AudioControls />, audioHost)}
  {createPortal(<VoiceSelect />, voiceHost)}
  <SessionStop />
  <Outlet />
 </>;
}
const rootRoute = createRootRoute({component: Workspace});
const homeRoute = createRoute({getParentRoute: () => rootRoute, path: '/', beforeLoad: () => { throw redirect({to: '/$view', params: {view: 'session'}, search: {target: undefined}}); }});
const viewRoute = createRoute({
 getParentRoute: () => rootRoute, path: '/$view', component: () => null,
 params: {parse: raw => ({view: isWorkspaceView(raw.view) ? raw.view : 'session'})},
 validateSearch: (search: Record<string, unknown>): {target: string | undefined} => ({
  target: typeof search.target === 'string' && /^[a-z][a-z0-9-]{0,100}$/.test(search.target) ? search.target : undefined,
 }),
});
const router = createRouter({routeTree: rootRoute.addChildren([homeRoute, viewRoute]), history: createHashHistory(), defaultHashScrollIntoView: false});
declare module '@tanstack/react-router' { interface Register { router: typeof router; } }

const listeners = new Set<(location: NavigationLocation) => void>();
let nextIntent: NavigationIntent = 'history';
function current(): NavigationLocation {
 const url = new URL(location.hash.slice(1) || '/session', location.origin);
 const raw = url.pathname.slice(1), view = isWorkspaceView(raw) ? raw : 'session';
 const target = url.searchParams.get('target');
 return {target: target && /^[a-z][a-z0-9-]{0,100}$/.test(target) ? target : view, intent: nextIntent};
}
installNavigationDriver({
 current,
 navigate(view, target, intent) {
  nextIntent = intent;
  void router.navigate({to: '/$view', params: {view}, search: {target: target === view ? undefined : target}, resetScroll: false});
 },
 subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
});
router.subscribe('onResolved', () => {
 const resolved = current();
 for (const listener of listeners) listener(resolved);
 nextIntent = 'history';
});
// React owns only the migrated controls/navigation. The existing DOM and runtime
// stay mounted across routes; the module is initialized once outside React effects.
document.documentElement.dataset.bambiRenderer = 'react';
const rootHost = document.createElement('div');
rootHost.id = 'react-player-root';
document.body.append(rootHost);
export const ready = (async () => {
 await router.load();
 flushSync(() => createRoot(rootHost).render(<StrictMode><RouterProvider router={router} /></StrictMode>));
 await import('./main');
})();

