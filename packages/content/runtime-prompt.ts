// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {Prompt} from './index';

export type RuntimePhase='induction'|'deepening'|'conditioning'|'anchor'|'awakening';
type Section={name:string;text:string};
/** Compile the editable document; never rewrite or shorten the source on disk. */
export function promptSections(text:string):Section[]{
 const headings=[...text.matchAll(/^===\s*(.*?)\s*===\s*$/gm)];
 if(!headings.length)return [{name:'',text}];
 const sections:Section[]=[{name:'',text:text.slice(0,headings[0].index)}];
 for(let i=0;i<headings.length;i++)sections.push({name:headings[i][1].replace(/\s*\([^)]*\)\s*$/,'').trim(),text:text.slice(headings[i].index,headings[i+1]?.index??text.length)});
 return sections;
}
export function deduplicateInstructions(text:string){
 const seen=new Set<string>();
 return promptSections(text).filter(section=>{
  // A repeated complete section is redundant. Repetition inside an example,
  // or the same sentence under another heading, may serve a different purpose.
  if(!section.name)return true;
  const key=section.text.trim();
  if(seen.has(key))return false;seen.add(key);return true;
 }).map(section=>section.text).join('').trim();
}
export function compilePromptDocument(prompt:Prompt,_phase:RuntimePhase='induction',collar=false){
 // Keep every authored section in every phase. Current phase guidance is added
 // separately by the response builder; it must never hide persona instructions.
 const core=[deduplicateInstructions(prompt.main),collar?deduplicateInstructions(prompt.collar_addon):'',deduplicateInstructions(prompt.strategy)].filter(Boolean).join('\n\n');
 return {core,phase:''};
}
