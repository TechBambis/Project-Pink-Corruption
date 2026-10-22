// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { Store } from '../storage';
import type {MemoryRetrieval} from './semantic-memory';

/** Only explicit user-authored commands create durable facts automatically. */
export function explicitMemory(text: string): { key: string; value: string } | null {
  const match = /^remember(?: that)?\s+([\w .-]{1,80})\s*:\s*([^\n]{1,1000})[\s]*$/i.exec(text.trim());
  return match ? { key: match[1].trim().toLowerCase(), value: match[2].trim() } : null;
}
export function memoryContext(store: Store, query: string, retrieval?:MemoryRetrieval): string[] {
  const words=query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[];
  const relevance=(fact:{key:string;value:string})=>words.reduce((score,word)=>score+(fact.key.includes(word)?3:0)+(fact.value.toLowerCase().includes(word)?1:0),0);
  const facts = (retrieval?.mode==='hybrid'?retrieval.facts:store.memoryFacts().sort((a,b)=>relevance(b)-relevance(a)||b.id-a.id)).slice(0,8);
  const episodes = retrieval?.episodes??store.searchEpisodes(query,4);
  return [
    ...facts.map(fact => 'Current confirmed preference (quoted): ' + JSON.stringify(fact)),
    ...episodes.map(episode => 'Earlier conversation excerpt (quoted): ' + JSON.stringify(episode)),
  ];
}

/** Session continuity uses explicitly confirmed facts, never generated scene
 * summaries or an unplayed plan as evidence of a past experience. */
export function sceneMemoryContext(store:Store):string[] {
  return store.memoryFacts().slice(0,8).map(fact=>'Confirmed preference for future sessions (quoted data; current feedback takes precedence; introduce its imagery in this session before recalling it; this does not prove any earlier event was delivered): '+JSON.stringify(fact));
}
