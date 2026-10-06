// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { TRIGGER_EFFECTS, strongestTriggerEffect, triggerEffectFor } from '../../../packages/visuals/trigger-effects';
import {triggerAliases} from '../../../config/trigger-sequence';
import { findTriggers, triggerSoundSettings } from '../../../config/trigger-sounds';
interface Trigger { name: string; description: string; category: string }
interface Catalog {
  prompts: { id: string; name: string; description: string }[];
  defaultTriggers: string[]; triggers: Trigger[];
  sources: { name: string; url: string; kind: string }[];
  docs: string[]; brainwavePresets: { name: string; carrier: number; beat: number }[];
  agentPrompts: { idle: string; trigger: string; idleThresholdMs: number; idleCheckIntervalMs: number; cooldownMs: number };
}
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
let catalog: Catalog;
export const stablePresets = {
  Original: { style: 'original', speed: .65, complexity: 1, alpha: 1, mode: 'classic' },
  Hypnotic: { style: 'loop', speed: .55, complexity: 1.4, depth: .85, alpha: 1, mode: 'breathe' },
  Intense: { style: 'fractal', speed: .5, complexity: 1.5, depth: .9, alpha: 1, mode: 'colorCycle' },
  Peaceful: { style: 'orb', speed: .4, complexity: .8, depth: .6, alpha: .85, mode: 'breathe' },
};
export function selectedTriggers(): string[] {
  try { return JSON.parse(input('trigger-selection').value); } catch { return []; }
}
export function syncContent() {
  const selected = selectedTriggers();
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('#trigger-options input')) checkbox.checked = selected.includes(checkbox.value);
  const prompt = catalog?.prompts.find(prompt => prompt.id === input('prompt-template').value);
  document.getElementById('prompt-description')!.textContent = prompt?.description || 'Your own Bambi persona.';
}
function show(title: string) {
  document.getElementById('content-title')!.textContent = title;
  const body = document.getElementById('content-body')!;
  body.replaceChildren();
  (document.getElementById('content-dialog') as HTMLDialogElement).showModal();
  return body;
}
export async function initContent() {
  catalog = await (await fetch('/api/content')).json();
  input('trigger-selection').value = JSON.stringify(catalog.defaultTriggers);
  const container = document.getElementById('trigger-options')!;
  for (const trigger of catalog.triggers) {
    const label = document.createElement('label'); label.className = 'check';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = trigger.name.toUpperCase();
    const text = document.createElement('span'); text.textContent = trigger.name;
    const description = document.createElement('small'); description.textContent = `${trigger.category} · ${trigger.description}`;
    text.append(description); label.append(checkbox, text); container.append(label);
    checkbox.onchange = () => {
      input('trigger-selection').value = JSON.stringify([...container.querySelectorAll<HTMLInputElement>('input:checked')].map(checkbox => checkbox.value));
      input('trigger-selection').dispatchEvent(new Event('input'));
    };
  }
  const presets = document.getElementById('brainwave-preset') as HTMLSelectElement;
  for (const preset of catalog.brainwavePresets) {
    const option = document.createElement('option'); option.value = preset.name;
    option.textContent = `${preset.name} · ${preset.carrier} Hz + ${preset.beat} Hz`; presets.append(option);
  }
  for (const [name, settings] of Object.entries(stablePresets)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet'; button.textContent = name;
    button.onclick = () => {
      for (const [key, value] of Object.entries(settings)) input('spiral-' + key).value = String(value);
      input('visual-journey').checked = false;
      input('scene').value = 'Spiral Focus'; input('spiral-mode').dispatchEvent(new Event('input'));
    };
    document.getElementById('spiral-presets')!.append(button);
  }
  document.getElementById('show-prompt')!.onclick = async () => {
    const id = input('prompt-template').value;
    const body = show(id === 'custom' ? 'Your own persona' : 'Source prompt · STABLE-2.0');
    const pre = document.createElement('pre'); body.append(pre);
    pre.textContent = id === 'custom' ? input('persona').value : JSON.stringify(await (await fetch('/api/content/prompts/' + id)).json(), null, 2);
  };
  document.getElementById('show-sources')!.onclick = () => {
    const body = show('Materials & guides');
    const note = document.createElement('p'); note.textContent = 'Explore the original STABLE-2.0 sources. Audio and video are hosted by the linked providers.'; body.append(note);
    for (const source of catalog.sources) {
      const link = document.createElement('a'); link.className = 'content-source'; link.href = source.url;
      link.target = '_blank'; link.rel = 'noopener'; link.textContent = `${source.name} · ${source.kind}`; body.append(link);
    }
    const title = document.createElement('h3'); title.textContent = 'Original guides'; body.append(title);
    for (const doc of catalog.docs) {
      const link = document.createElement('a'); link.className = 'content-source'; link.href = '/content/stable-2.0/' + doc;
      link.target = '_blank'; link.rel = 'noopener'; link.textContent = doc.split('/').at(-1)!.replace('.md', ''); body.append(link);
      link.onclick = async event => {
        event.preventDefault();
        const body = show(link.textContent || 'Original guide');
        const back = document.createElement('button'); back.type = 'button'; back.className = 'quiet'; back.textContent = '← Materials & guides';
        back.onclick = () => document.getElementById('show-sources')!.click();
        const pre = document.createElement('pre'); body.append(back, pre);
        try { pre.textContent = await (await fetch(link.href)).text(); } catch { pre.textContent = 'Could not load this guide.'; }
      };
    }
    const agentTitle = document.createElement('h3'); agentTitle.textContent = 'Original instructions · Ambient Companion'; body.append(agentTitle);
    const agent = document.createElement('pre'); agent.textContent = JSON.stringify(catalog.agentPrompts, null, 2); body.append(agent);
  };
  document.getElementById('close-content')!.onclick = () => (document.getElementById('content-dialog') as HTMLDialogElement).close();
  syncContent();
}
export function brainwaveSelection() {
  return catalog?.brainwavePresets.find(preset => preset.name === input('brainwave-preset').value);
}
export function ambientDirective(reason: 'idle' | 'trigger', username: string, trigger = '') {
  return catalog.agentPrompts[reason].replace('${username || "A bambi"}', () => username || 'A bambi').replace('${trigger}', () => trigger);
}
export function matchingTrigger(text: string) {
  return catalog ? findTriggers(text, catalog.triggers.map(trigger => trigger.name))[0]?.name : undefined;
}
export function ambientTiming() { return catalog.agentPrompts; }
export function highlightTriggers(node: HTMLElement) {
  if (!input('triggers-enabled').checked || !catalog) return;
  const names = catalog.triggers.map(trigger => trigger.name);
  const escaped = names.sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const text = node.textContent || '', fragment = document.createDocumentFragment();
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    fragment.append(text.slice(offset, match.index));
    const span = document.createElement('span'); span.className = 'trigger-highlight'; span.textContent = match[0]; fragment.append(span);
    offset = match.index! + match[0].length;
  }
  fragment.append(text.slice(offset)); node.replaceChildren(fragment);
}
export function triggerFlash(text: string, playSound = true) {
  if (!input('triggers-enabled').checked || !catalog) return;
  const matches = findTriggers(text, [...catalog.triggers.map(trigger => trigger.name), ...triggerSoundSettings.mappings.map(item => item.trigger), ...triggerAliases, ...Object.keys(TRIGGER_EFFECTS)]);
  if (!matches.length) return;
  const visualEffect = strongestTriggerEffect(matches.map(match => match.name));
  for (const match of matches) {
    const category = catalog.triggers.find(trigger => trigger.name === match.name)?.category.toLowerCase() || 'mental';
    document.dispatchEvent(new CustomEvent('trigger-detected', { detail: { triggerName: match.name, playSound, category, visualEffect, timestamp: Date.now() } }));
  }
}

/** Author-timed cues already identify a complete trigger; never scan for partial names. */
export function triggerCue(phrase:string) {
  const name=phrase.trim();if(!name||!input('triggers-enabled').checked)return;
  document.dispatchEvent(new CustomEvent('trigger-detected',{detail:{
    triggerName:name,playSound:false,source:'media',visualEffect:triggerEffectFor(name),timestamp:Date.now(),
  }}));
}
