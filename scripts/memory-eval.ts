// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {mkdirSync,writeFileSync} from 'node:fs';
import {LocalEmbeddings} from '../packages/ai/embeddings';
import {Store} from '../packages/storage';
import {SemanticMemory} from '../packages/ai/semantic-memory';

const encoder=new LocalEmbeddings();
if(!encoder.available)throw Error('Run npm run setup:memory first. Evaluation never downloads models.');
const store=new Store(':memory:'),memory=new SemanticMemory(store,encoder,{queryTimeoutMs:10000});
const passages=[
 'I prefer quiet instrumental music and gentle piano when relaxing.',
 'My favorite drink is black coffee.',
 'I live in Berlin.',
 'I like fast energetic dance music.',
 'Please keep your speaking speed slow.',
 'The garden has red roses.',
 'My favorite sound is ocean waves.',
];
const queries=[
 ['Which soothing sounds help me relax?',0],
 ['What music do I find calming?',0],
 ['How quickly should you talk?',4],
 ['Which beverage do I prefer?',1],
 ['Which city is my home?',2],
 ['What is my brothers name?',-1],
 ['Which movie is my favorite?',-1],
] as const;
try{
 for(const text of passages)store.addTurn('user',text);store.beginConversation();
 const start=performance.now();await memory.index();const indexingMs=performance.now()-start;
 const results=[];
 for(const [query,expected] of queries){
  const at=performance.now(),found=await memory.retrieve(query,new AbortController().signal);
  results.push({query,expected:passages[expected]??null,mode:found.mode,retrieved:found.episodes.map(e=>e.content),
   passed:found.mode==='hybrid'&&(expected<0?found.episodes.length===0:found.episodes.some(e=>e.content===passages[expected])),ms:performance.now()-at});
 }
 const report={scope:'Pinned local CPU embeddings with synthetic in-memory passages. No user history or remote inference. Seven retrieval cases are not a general model-quality certification.',model:encoder.id,indexingMs,results};
 mkdirSync('runtime',{recursive:true});writeFileSync('runtime/memory-evaluation.json',JSON.stringify(report,null,2)+'\n');
 for(const result of results)console.log(`${result.passed?'PASS':'FAIL'} ${result.query} (${result.ms.toFixed(1)} ms)`);
 console.log(`Saved ${results.length} cases to runtime/memory-evaluation.json`);
 if(results.some(result=>!result.passed))process.exitCode=1;
}finally{memory.close();store.db.close();}
