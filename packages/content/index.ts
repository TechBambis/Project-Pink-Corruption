// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {compilePromptDocument,type RuntimePhase} from './runtime-prompt';

export const contentRoot = fileURLToPath(new URL('./stable-2.0/', import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(contentRoot + path, 'utf8'));
export interface Trigger { id: string; name: string; description: string; effect: string; category: string }
export interface Prompt { id: string; name: string; description: string; main: string; collar_addon: string; strategy: string }
const stableTriggerData = read('workers/triggers.json') as { source: string; version: string; categories: Record<string, string>; triggers: Trigger[] };
const cloudTriggers = JSON.parse(readFileSync(new URL('./bambicloud-triggers.json', import.meta.url), 'utf8')) as {names:string[]};
const knownTriggers = new Set(stableTriggerData.triggers.map(trigger => trigger.name.toUpperCase()));
export const triggerData = {...stableTriggerData, categories:{...stableTriggerData.categories,Cloud:'Additional BambiCloud session cues'},triggers:[
  ...stableTriggerData.triggers,
  ...cloudTriggers.names.filter(name => !knownTriggers.has(name.toUpperCase())).map(name => ({
    id:'cloud_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_'),name,category:'Cloud',
    description:'BambiCloud trigger; fictional audiovisual session cue.',effect:'Session text and audiovisual cue.',
  })),
]};
// Prompt texts can be stored as editable line lists or as legacy strings.
export const prompts: Prompt[] = ['bambisleep-classic', 'gentle-induction'].map(id => {
  const prompt = read(`workers/prompts/${id}.json`);
  for (const key of ['main', 'collar_addon', 'strategy']) {
    if (Array.isArray(prompt[key])) prompt[key] = prompt[key].join('\n');
  }
  return prompt;
});
export const agentPrompts = JSON.parse(readFileSync(new URL('./agent-prompts.json', import.meta.url), 'utf8'));
export const defaultTriggers = (() => {
  const primary = triggerData.triggers.filter(trigger => trigger.category === 'primary').slice(0, 2);
  const mental = triggerData.triggers.filter(trigger => trigger.category === 'mental').slice(0, 1);
  const selected = [...primary, ...mental];
  return (selected.length ? selected : triggerData.triggers.slice(0, 3)).map(trigger => trigger.name.toUpperCase());
})();
export const sources = [
  { name: 'BambiCloud', url: 'https://bambicloud.com', kind: 'Audio and playlists' },
  { name: 'Church', url: 'https://bambisleep.church', kind: 'Community and shared listening' },
  { name: 'Wiki', url: 'https://bambisleep.info', kind: 'Files, triggers and transcripts' },
];

/** Exact upstream substitution and main + optional collar + strategy ordering. */
export function buildStablePrompt(id: string, username: string, selected: string[], collar: boolean, collarName: string): string {
  const prompt = prompts.find(prompt => prompt.id === id);
  if (!prompt) throw Error('Unknown STABLE-2.0 prompt');
  return substitutePrompt(prompt.main + (collar && prompt.collar_addon ? prompt.collar_addon : '') + (prompt.strategy || ''), username, selected, collarName);
}

function substitutePrompt(text:string, username:string, selected:string[], collarName:string){
  const effective = selected.length ? selected : [
    ...triggerData.triggers.filter(trigger => trigger.category.toLowerCase() === 'primary').slice(0, 2),
    ...triggerData.triggers.filter(trigger => trigger.category.toLowerCase() === 'mental').slice(0, 1),
  ].map(trigger => trigger.name.toUpperCase());
  const descriptions = effective.map(name => {
    const upper = name.toUpperCase();
    const trigger = triggerData.triggers.find(trigger => trigger.name.toUpperCase() === upper);
    return `${upper}: ${trigger?.description || 'Custom trigger.'}`;
  }).join(' ');
  const vars: Record<string, string> = { username, selectedTriggerNames: selected.map(name => name.toUpperCase()).join(', '), triggerDescriptionPairs: descriptions, collarName: collarName || 'COLLAR' };
  const sub = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
  return sub(text);
}

/** All authored instructions, with only exact duplicate sections removed. */
export function buildRuntimePrompt(id:string,username:string,selected:string[],collar:boolean,collarName:string,phase:RuntimePhase='induction'){
 const prompt=prompts.find(prompt=>prompt.id===id);if(!prompt)throw Error('Unknown prompt');
 const document=compilePromptDocument(prompt,phase,collar);
 return {core:substitutePrompt(document.core,username,selected,collarName),phase:substitutePrompt(document.phase,username,selected,collarName)};
}

export const brainwavePresets = [
  { name: 'Deep Sleep', carrier: 200, beat: 2 },
  { name: 'Light Sleep', carrier: 220, beat: 6 },
  { name: 'Meditation', carrier: 250, beat: 10 },
  { name: 'Focus', carrier: 300, beat: 18 },
  { name: 'Alert', carrier: 350, beat: 25 },
  { name: 'Lucid Dream', carrier: 200, beat: 7 },
  { name: 'Study', carrier: 280, beat: 12 },
];
export function contentCatalog() {
  return { prompts: prompts.map(({ id, name, description }) => ({ id, name, description })),
    defaultPrompt: 'bambisleep-classic', defaultTriggers, ...triggerData, sources, brainwavePresets,
    docs: (read('manifest.json').files as {path:string}[]).map(file=>file.path).filter(path=>path.startsWith('public/docs/')&&path.endsWith('.md')),
    agentPrompts, upstream: 'STABLE-2.0', commit: '3f5e9b336382f1f49ac2edde3c0281845f74b0a3', bundledMedia: [] };
}
