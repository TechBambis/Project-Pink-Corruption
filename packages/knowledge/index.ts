// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { existsSync, readFileSync } from 'node:fs';
export interface KnowledgeProvider { search(query:string,limit?:number): {section:string;text:string;source:string}[] }
export class LocalKnowledge implements KnowledgeProvider {
 chunks:{section:string;text:string;source:string}[]=[];
 constructor(path='vendor/bambisleep-data/bambisleep_structured.json'){if(!existsSync(path))return;const d=JSON.parse(readFileSync(path,'utf8'));for(const [section,entry] of Object.entries(d.content||{})){const text=(entry as {content?:string}).content||'';for(let i=0;i<text.length;i+=800)this.chunks.push({section,text:text.slice(i,i+1000),source:d.metadata?.source||'bambisleep.info (snapshot)'});}}
 search(query:string,limit=3){const terms=query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];return this.chunks.map(c=>({...c,score:terms.reduce((s,t)=>s+(c.text.toLowerCase().split(t).length-1),0)})).filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);}
}
