// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {experienceSettings, selectedExperience, needsExperienceChange, sectionScrollTarget, type Experience} from './experience';

const views = {
  session: 'Session', voice: 'Voice & AI', sound: 'Sound', visuals: 'Visuals',
  devices: 'Devices', files: 'Library', extras: 'Extras',
} as const;
type View = keyof typeof views;
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const aliases: Record<string, string> = {
  'narration-enabled': 'continuous narration auto continue storytelling session',
  'conversation-style': 'situational adaptive personal questions conversation follow up guided bambi',
  'voice': 'speaker narration tts kokoro heart', 'model': 'llm ai model qwen gemma',
  'speed': 'voice rate tempo speech', 'audio-preset': 'audio preset sound profile',
  'tick-enabled': 'metronome clock heartbeat ticking bpm',
  'tick-defaults': 'tick tempo speed 60 50 40 30 bpm', 'tick-dives': 'bass sub dive fourth beat',
  'sound-design': 'sound marker synchronized simultaneous trigger timing',
  'sound-bass-fallback': 'bass 120 hz small speakers fallback',
  'trigger-wiper-seconds': 'wiper windshield duration',
  'device-vib-max': 'vibration intensity strength cap', 'device-rot-max': 'rotation intensity strength cap',
  'device-address': 'bluetooth ble connection address pearlconch',
  'background-noise': 'white pink brown noise', 'background-drone': 'ambient background',
  'master': 'master volume loudness mute', 'brainwave-enabled': 'binaural headphones frequency',
  'mic-playback-mode': 'microphone mic speakers headphones',
  'phase-visuals': 'automatic phase scenes choreography', 'spiral-speed': 'spiral tempo motion speed',
  'visual-voice-sync': 'spiral reactive voice speech audio synchronization',
  'visual-tick-sync': 'spiral reactive beat tick metronome synchronization',
  'visual-reactivity': 'spiral reactive immersion reaction strength intensity',
  'spiral-style': 'deep tunnel endless loop fractal bloom vortex infinity hypnos coil kaleidoscope prismatic focus orb intense immersion',
  'spiral-depth': 'depth layered tunnel 3d dimensional',
  'visual-journey': 'maximum immersion phase journey sequence orb vortex infinity',
  'visual-fixation': 'center focus fixation heart point', 'visual-focus-words': 'large spoken words focus text overlay',
  'help-settings': 'keyboard shortcuts space escape diagnostics status local ai kokoro audio health performance fps',
};
const experienceDescriptions: Record<string, string> = {
  conversation: 'Just you and Bambi. Chat, listen, or speak with your local AI.',
  local: 'Your own audio or video, with visuals and sound. No AI replies.',
  hybrid: 'Your files keep playing. Bambi can chat and speak alongside them.',
  official: 'Keep an external session in its own tab. Start this clock alongside it; timing is manual.',
};
const companionDescriptions: Record<string, string> = {
  off: 'AI replies are off.', text: 'Bambi replies in the player without spoken audio.',
  voice: 'Bambi speaks her replies. Type a message to begin.',
  ambient: 'Bambi adds occasional spoken moments during your session. You can also chat.',
  interactive: 'Turn the microphone on to talk. With headphones, speaking can interrupt Bambi.',
};
interface SearchEntry { target: string; title: string; path: string; keywords: string; titleKey: string; }

/** Changing sections preserves playback. Explicit session choices use the existing preference controls. */
export function initNavigation(beforeExperienceChange: () => void = () => {}) {
  const app = element('app'), workspace = element('workspace');
  const dialog = element<HTMLDialogElement>('settings-search'), search = element<HTMLInputElement>('settings-search-input');
  const results = element('settings-search-results');
  let active: View = 'session';
  let resultIndex = 0, matches: SearchEntry[] = [], highlightTimer = 0;
  let searchReturn: HTMLElement | null = null, highlighted: HTMLElement | null = null;
  const scrollPositions = new Map<View, number>();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let navigationFrame = 0, historyFrame = 0;
  let pageTransition: Animation | null = null;
  history.scrollRestoration = 'manual';

  function reveal(node: HTMLElement, animate = true) {
    const rect = node.getBoundingClientRect();
    const top = element('settings-navigation').getBoundingClientRect().height + 16;
    const bottom = innerHeight - 112;
    if (rect.top >= top && rect.bottom <= bottom) return;
    const target = rect.height <= bottom - top && rect.top >= top
      ? scrollY + rect.bottom - bottom : scrollY + rect.top - top;
    scrollTo({top: Math.max(0, target), behavior: animate && !reducedMotion.matches ? 'smooth' : 'instant'});
  }

  function experienceState() {
    return {mode: element<HTMLSelectElement>('mode').value, narration: element<HTMLInputElement>('narration-enabled').checked,
      events: element<HTMLInputElement>('session-events').checked, aiMode: element<HTMLSelectElement>('ai-mode').value};
  }
  function syncSummary() {
    for (const [selectId, outputId] of [['voice', 'session-voice-name'], ['audio-preset', 'session-preset-name'], ['scene', 'session-scene-name']]) {
      const select = element<HTMLSelectElement>(selectId);
      element(outputId).textContent = select.selectedOptions[0]?.textContent ?? '';
    }
    const mode = element<HTMLSelectElement>('mode').value;
    const experience = selectedExperience(experienceState());
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-experience]')) {
      button.setAttribute('aria-pressed', String(button.dataset.experience === experience));
    }
    const files = experience === 'files';
    element('session-duration-control').hidden = files;
    element('session-intensity-control').hidden = files;
    element('session-flow-settings').hidden = files;
    element('session-direction-settings').hidden = experience !== 'guided' || !element<HTMLInputElement>('session-events').checked;
    element('session-launch').hidden = experience !== 'guided';
    element('experience-join-label').hidden = !['local', 'hybrid'].includes(mode);
    element<HTMLInputElement>('experience-join').checked = mode === 'hybrid';
    const unlimited = element<HTMLSelectElement>('duration').value === 'unlimited';
    element('experience-description').textContent = experience === 'guided'
      ? unlimited ? 'An AI-led journey with changing visuals, varied voice pace and quieter returns. Continues until you end it.' : 'An AI-led journey with changing visuals, varied voice pace and a gentle closing. Choose your length, then start.'
      : mode === 'conversation' ? 'Type a message or turn on the microphone to begin. Bambi leaves room for your replies.' : experienceDescriptions[mode] ?? '';
    element('experience-files-link').hidden = !['local', 'hybrid'].includes(mode);
    const aiMode = element<HTMLSelectElement>('ai-mode').value;
    const narration = element<HTMLInputElement>('narration-enabled').checked && !['off', 'text'].includes(aiMode);
    element<HTMLInputElement>('voice-read-aloud').checked = ['voice', 'ambient', 'interactive'].includes(aiMode);
    element<HTMLInputElement>('voice-occasional').checked = aiMode === 'ambient' && !narration;
    element<HTMLInputElement>('voice-occasional').disabled = ['off', 'text'].includes(aiMode) || narration;
    element('companion-description').textContent = ['local', 'official'].includes(mode)
      ? 'AI replies are off here. Choose Bambi Chat or turn on “Let Bambi join in” for your files.'
      : narration ? element<HTMLSelectElement>('conversation-style').value==='situational'?'Bambi follows your conversation with short passages and relevant questions, leaving room for your answers.':unlimited?'Continuous narration pauses between passages and continues until you end the session.':'Continuous narration starts with your session, pauses between passages and ends after the chosen duration.' : companionDescriptions[aiMode] ?? '';
  }
  function show(target: string, push = true, focus = true, intent: 'tab' | 'jump' | 'history' = 'jump') {
    const targetNode = target in views ? element('view-' + target) : element(target.replace(/^setting-/, ''));
    const page = targetNode?.closest<HTMLElement>('.workspace-view[data-view]') ?? (targetNode?.closest('.session-dock') ? element('view-session') : null);
    const next = page?.dataset.view as View | undefined;
    if (!page || !next || !(next in views)) return false;
    if(document.fullscreenElement&&!document.fullscreenElement.contains(page)){
      void document.exitFullscreen().then(()=>show(target,push,focus,intent));
      return true;
    }
    if (next !== active) scrollPositions.set(active, scrollY);
    const changed = next !== active;
    const position = scrollY;
    cancelAnimationFrame(navigationFrame);
    pageTransition?.cancel();
    for (const node of workspace.querySelectorAll<HTMLElement>('[data-view]')) node.hidden = node !== page;
    for (const link of document.querySelectorAll<HTMLElement>('[data-nav]')) {
      if (link.dataset.nav === next) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    active = next; app.dataset.view = next;
    document.title = views[next] + ' · Bambi Local';
    if (push && location.hash !== '#' + target) history.pushState(null, '', '#' + target);
    if (changed && focus && !reducedMotion.matches) pageTransition = page.animate([{opacity: .35}, {opacity: 1}], {duration: 150, easing: 'ease-out'});
    const isPage = targetNode === page;
    if (isPage) {
      navigationFrame = requestAnimationFrame(() => {
        // Opening a tab must expose its destination, including below the initial picture.
        if (intent === 'tab') {
          const heading = element('heading-' + next).getBoundingClientRect();
          const top = sectionScrollTarget(position, heading.top, heading.bottom, element('settings-navigation').getBoundingClientRect().height, innerHeight);
          scrollTo({top, behavior: focus && !reducedMotion.matches && top !== position ? 'smooth' : 'instant'});
        }
        else if (intent === 'history' && scrollPositions.has(next)) scrollTo({top: scrollPositions.get(next)!, behavior: 'instant'});
        else if (next === 'session') scrollTo({top: 0, behavior: focus && !reducedMotion.matches ? 'smooth' : 'instant'});
        else reveal(element('heading-' + next), focus);
        if (focus) element(intent !== 'tab' && next === 'session' ? 'stage' : 'heading-' + next).focus({preventScroll: true});
      });
    } else {
      if (targetNode.closest('#player-details')) document.dispatchEvent(new Event('player-controls-open'));
      let ancestor: HTMLElement | null = targetNode;
      while (ancestor && ancestor !== workspace) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      navigationFrame = requestAnimationFrame(() => {
          const focusNode = targetNode.matches('input,select,textarea,button,a,summary') ? targetNode : targetNode.querySelector<HTMLElement>('summary,input,select,textarea,button,a');
          if (focus) focusNode?.focus({preventScroll: true});
          reveal(targetNode, focus);
          highlighted?.classList.remove('navigation-highlight');
          highlighted = targetNode.closest<HTMLElement>('label') ?? targetNode;
          highlighted.classList.add('navigation-highlight');
          clearTimeout(highlightTimer);
          highlightTimer = window.setTimeout(() => highlighted?.classList.remove('navigation-highlight'), 2200);
      });
    }
    return true;
  }
  function fromHash(focus: boolean) {
    let target = 'session';
    try { target = decodeURIComponent(location.hash.slice(1)) || target; } catch { /* Unknown link starts on Session. */ }
    if (!show(target, false, focus, 'history')) show('session', false, focus, 'history');
  }
  document.addEventListener('click', event => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('[data-nav],[data-jump],[data-target]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); show(link.dataset.target ?? link.dataset.jump ?? link.dataset.nav!, true, true, link.dataset.nav ? 'tab' : 'jump');
  });
  const restoreHistory = () => { cancelAnimationFrame(historyFrame); historyFrame = requestAnimationFrame(() => fromHash(true)); };
  window.addEventListener('hashchange', restoreHistory);
  window.addEventListener('popstate', restoreHistory);
  document.querySelector<HTMLElement>('[data-open-performance]')!.onclick = () => { show('session'); element('hud-toggle').click(); };
  function changeSetting(id: string, value: string) {
    const field = element<HTMLSelectElement>(id); field.value = value;
    field.dispatchEvent(new Event('input', {bubbles: true}));
    field.dispatchEvent(new Event('change', {bubbles: true}));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-experience]')) button.onclick = () => {
    const choice = button.dataset.experience as Experience, state = experienceState();
    if (needsExperienceChange(choice, state)) {
      beforeExperienceChange();
      for (const [id, value] of Object.entries(experienceSettings(choice, state, element<HTMLInputElement>('experience-join').checked))) {
        const field = element<HTMLInputElement | HTMLSelectElement>(id);
        if (typeof value === 'boolean') (field as HTMLInputElement).checked = value;
        else field.value = value;
      }
      // Apply the complete choice once; never save or warm a half-switched profile.
      element('mode').dispatchEvent(new Event('input', {bubbles: true}));
      element('conversation-style').dispatchEvent(new Event('change', {bubbles: true}));
    }
    if (choice === 'files') show('files');
  };
  element('session-launch').onclick = () => {
    document.dispatchEvent(new Event('player-controls-open'));
    element('start').click();
  };
  element<HTMLInputElement>('experience-join').onchange = event => {
    const enabled = (event.target as HTMLInputElement).checked;
    if (enabled && element<HTMLSelectElement>('ai-mode').value === 'off') changeSetting('ai-mode', 'voice');
    changeSetting('mode', enabled ? 'hybrid' : 'local');
  };
  element<HTMLInputElement>('voice-read-aloud').onchange = event => {
    const enabled = (event.target as HTMLInputElement).checked;
    const current = element<HTMLSelectElement>('ai-mode').value;
    changeSetting('ai-mode', enabled ? current === 'interactive' ? 'interactive' : element<HTMLInputElement>('voice-occasional').checked ? 'ambient' : 'voice' : 'text');
  };
  element<HTMLInputElement>('voice-occasional').onchange = event => changeSetting('ai-mode', (event.target as HTMLInputElement).checked ? 'ambient' : 'voice');
  element('external-session-activate').onclick = () => { changeSetting('mode', 'official'); show('session'); };

  function indexSettings(): SearchEntry[] {
    const entries: SearchEntry[] = [];
    entries.push({target: 'setting-master', title: 'Master volume', path: 'Session controls', keywords: normalize('master volume loudness mute'), titleKey: 'master volume'});
    entries.push({target: 'experience-choices', title: 'Choose your session', path: 'Session / Quick setup', keywords: 'experience mode bambi chat play files hybrid session', titleKey: 'choose your session'});
    for (const page of workspace.querySelectorAll<HTMLElement>('[data-view]')) {
      const name = views[page.dataset.view as View];
      entries.push({target: page.dataset.view!, title: name, path: 'Section', keywords: normalize(name), titleKey: normalize(name)});
      for (const label of page.querySelectorAll<HTMLLabelElement>('label')) {
        const field = label.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[id],select[id],textarea[id]');
        if (!field || field.type === 'hidden' || field.hidden) continue;
        let ancestor: HTMLElement | null = label;
        let conditionalHidden = false;
        while (ancestor && ancestor !== page) { if (ancestor.hidden) conditionalHidden = true; ancestor = ancestor.parentElement; }
        if (conditionalHidden) continue;
        const copy = label.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('input,select,textarea,output,meter').forEach(node => node.remove());
        const title = copy.textContent?.replace(/\s+/g, ' ').trim();
        if (!title) continue;
        const group = label.closest<HTMLElement>('[data-section]')?.dataset.section;
        const options = field instanceof HTMLSelectElement ? [...field.options].map(option => option.textContent).join(' ') : '';
        entries.push({target: 'setting-' + field.id, title, path: name + (group ? ' / ' + group : ''), keywords: normalize(`${field.id} ${title} ${options} ${name} ${group ?? ''} ${aliases[field.id] ?? ''}`), titleKey: normalize(title)});
      }
      for (const group of page.querySelectorAll<HTMLElement>('[data-section][id]')) {
        const title = group.dataset.section!;
        entries.push({target: group.id, title, path: name, keywords: normalize(`${name} ${title} ${aliases[group.id] ?? ''}`), titleKey: normalize(title)});
      }
    }
    return entries;
  }
  function selectResult(index: number) {
    resultIndex = Math.max(0, Math.min(matches.length - 1, index));
    for (const [i, button] of [...results.querySelectorAll<HTMLElement>('button')].entries()) {
      button.classList.toggle('search-selected', i === resultIndex);
      button.setAttribute('aria-selected', String(i === resultIndex));
    }
    const selected = results.children[resultIndex] as HTMLElement | undefined;
    if (selected) {
      search.setAttribute('aria-activedescendant', selected.id);
      // Scroll the result list only; the background page stays where it was.
      const top = selected.offsetTop - results.offsetTop, bottom = top + selected.offsetHeight;
      if (top < results.scrollTop) results.scrollTop = top;
      else if (bottom > results.scrollTop + results.clientHeight) results.scrollTop = bottom - results.clientHeight;
    }
    else search.removeAttribute('aria-activedescendant');
  }
  function openResult(entry: SearchEntry) {
    dialog.close(); show(entry.target);
  }
  function renderResults() {
    const query = normalize(search.value), terms = query.split(' ').filter(Boolean);
    const entries = indexSettings();
    matches = (query ? entries.filter(entry => terms.every(term => entry.keywords.includes(term))).sort((a, b) => {
      const score = (entry: SearchEntry) => entry.titleKey === query ? 100 : entry.titleKey.startsWith(query) ? 80 : entry.titleKey.includes(query) ? 60 : 20;
      return score(b) - score(a);
    }) : entries.filter(entry => entry.path === 'Section')).slice(0, 12);
    results.replaceChildren();
    matches.forEach((entry, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.id = 'setting-result-' + i; button.className = 'search-result'; button.setAttribute('role', 'option');
      const title = document.createElement('span'); title.textContent = entry.title;
      const path = document.createElement('small'); path.textContent = entry.path;
      button.append(title, path); button.onclick = () => openResult(entry); results.append(button);
    });
    element('settings-search-status').textContent = matches.length ? (query ? `${matches.length} matching settings` : 'Jump to a section or search for a setting.') : 'No settings found. Try voice, tick, sound or device.';
    selectResult(0);
  }
  function openSearch() {
    if (dialog.open) return;
    searchReturn = document.activeElement as HTMLElement;
    search.value = ''; dialog.showModal(); renderResults(); search.focus();
  }
  results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', 'Matching settings');
  search.setAttribute('role', 'combobox'); search.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-autocomplete', 'list');
  search.oninput = renderResults;
  search.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selectResult(resultIndex + (event.key === 'ArrowDown' ? 1 : -1)); }
    if (event.key === 'Enter' && matches[resultIndex]) { event.preventDefault(); openResult(matches[resultIndex]); }
  };
  element('settings-search-open').onclick = openSearch;
  element('settings-search-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (document.activeElement === document.body || document.activeElement === search) searchReturn?.focus({preventScroll: true}); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); dialog.close(); } });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  document.addEventListener('keydown', event => {
    const typing = (event.target as HTMLElement).matches('input,textarea,select,[contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' || event.key === '/' && !typing) { event.preventDefault(); openSearch(); }
  });
  document.addEventListener('input', event => {
    if (!['experience-join', 'voice-read-aloud', 'voice-occasional'].includes((event.target as HTMLElement).id)) syncSummary();
  });
  const notice = element('notice');
  const syncNotice = () => {
    element('navigation-notice-text').textContent = notice.textContent;
    element('navigation-notice').hidden = notice.classList.contains('hidden') || !notice.textContent?.trim();
  };
  new MutationObserver(syncNotice).observe(notice, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']});
  element('navigation-notice-close').onclick = () => { notice.classList.add('hidden'); };
  syncNotice();
  syncSummary(); fromHash(false);
  return {show, syncSummary};
}
