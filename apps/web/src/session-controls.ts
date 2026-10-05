// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** The compact controls stay useful; the full mixer opens on demand. */
export function initSessionControls() {
  const app = document.getElementById('app')!;
  const dock = document.querySelector<HTMLElement>('.session-dock')!;
  const anchor = document.getElementById('session-control-anchor')!;
  const panel = document.getElementById('player-details')!;
  const toggle = document.getElementById('player-controls-toggle')!;
  const stage = document.getElementById('stage')!;
  const chat = document.getElementById('chat-panel')!;
  const chatHome = document.createComment('Chat position outside fullscreen');
  chat.before(chatHome);
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  let pinned = false, hovered = false;
  let fullscreen = false, scrollPosition = 0;
  function sync() {
    const open = pinned || hovered || panel.contains(document.activeElement);
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', pinned ? 'Hide playback controls' : 'Show playback controls');
    toggle.setAttribute('aria-pressed', String(pinned));
  }
  toggle.addEventListener('click', () => { pinned = !pinned; hovered = false; sync(); });
  document.addEventListener('player-controls-open', () => { pinned = true; sync(); });
  toggle.addEventListener('pointerenter', () => { if (hover.matches) { hovered = true; sync(); } });
  dock.addEventListener('pointerleave', () => { hovered = false; sync(); });
  dock.addEventListener('focusin', sync);
  dock.addEventListener('focusout', () => requestAnimationFrame(sync));
  dock.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || panel.hidden) return;
    event.stopPropagation(); event.preventDefault();
    pinned = false; hovered = false;
    toggle.focus({preventScroll: true}); sync();
  });
  document.addEventListener('fullscreenchange', () => {
    const next = document.fullscreenElement === stage;
    if (next === fullscreen) return;
    fullscreen = next;
    if (next) {
      scrollPosition = scrollY;
      // Move the live player and chat; handlers, focusable controls and state stay shared.
      stage.append(dock, chat);
      stage.focus({preventScroll: true});
    } else {
      anchor.append(dock);
      chatHome.after(chat);
      document.getElementById('fullscreen')!.focus({preventScroll: true});
      requestAnimationFrame(() => window.scrollTo({top: scrollPosition, behavior: 'instant'}));
    }
    document.dispatchEvent(new CustomEvent('player-fullscreen', { detail: { active: next } }));
    hovered = false;
    sync();
  });
  new IntersectionObserver(([entry]) => {
    app.dataset.playerAway = String(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
  }).observe(anchor);
  sync();
}
