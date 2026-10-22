// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SpokenBlockStream,spokenBlockGrammar,maxSpokenBlockCharacters,spokenBlockProtocol} from '../packages/ai/spoken-blocks';
import {SituationalTurnStream} from '../packages/ai/situational';
import {buildFixedReplyPrompt,buildReplyPrompt,replyControlPrefixes} from '../packages/ai/prompt';
import {SpokenOutputGate} from '../packages/speech/contract';
import {replyBlockBudget} from '../packages/ai/response';

test('role blocks are atomic across every token split, with controls and speaker routing intact',()=>{
 const text='[owner] Stay here, Bambi. [pause:medium]\n[bambi] I can listen.\n[owner] [breath:in] In.\n';
 const expected=['Stay here, Bambi. [pause:medium]','[bambi]I can listen.','[breath:in] In.'];
 for(const parts of [[...text],...[...Array(text.length+1)].map((_,at)=>[text.slice(0,at),text.slice(at)])]){
  const parser=new SpokenBlockStream(()=>true);
  assert.deepEqual(parts.flatMap(part=>parser.push(part)),expected);parser.finish();assert.equal(parser.error,undefined);assert.equal(parser.atBoundary,true);
 }
 const parser=new SpokenBlockStream();assert.deepEqual(parser.push('[owner] A finished sentence.'),[]);
 parser.finish();assert.equal(parser.error?.code,'unfinished');assert.deepEqual(parser.push('\n'),[]);
});
test('prose outside blocks, disabled voices, nested routing, broken controls and empty speech never escape',()=>{
 for(const text of ['She steps closer.\n','[owner] Ready.\nShe smiles.\n','[bambi] I can listen.\n','[owner] Ready [bambi:I am here.].\n','[owner] Ready [pause:medium.\n','[owner] [SFX:SNAP].\n','[owner] Ready <script>.\n']){
  const parser=new SpokenBlockStream();const output=parser.push(text);parser.finish();
  assert.ok(parser.error,text);assert.ok(output.every(line=>line==='Ready.'),text);
 }
 const inner=new SpokenBlockStream(()=>true);assert.deepEqual(inner.push('[owner] Ready.\n[bambi] [pause:long] I can listen.\n'),['Ready.']);assert.equal(inner.error?.code,'format');
 const oversized=new SpokenBlockStream();oversized.push('[owner] '+'word '.repeat(maxSpokenBlockCharacters));assert.equal(oversized.error?.code,'length');
 const numeric=new SpokenBlockStream();assert.deepEqual(numeric.push('[owner] 42.\n'),['42.']);numeric.finish();assert.equal(numeric.error,undefined);
});
test('a framed situational question keeps its newline, releases once and routes no inner speech',()=>{
 const turn=new SituationalTurnStream(true),blocks=new SpokenBlockStream(()=>false);
 const output=[...'[turn:ask]\n[owner] Which color do you prefer?\n'].flatMap(char=>blocks.push(turn.push(char)));
 assert.deepEqual(output,['Which color do you prefer?']);assert.equal(turn.action,'ask');blocks.finish();assert.equal(blocks.error,undefined);
 const firstQuestion=new SpokenBlockStream(()=>false,text=>text.includes('?'));
 assert.deepEqual(firstQuestion.push('[owner] Which color do you prefer?\n[owner] I will answer for you.\n[bambi] I prefer pink.\n'),['Which color do you prefer?']);
 firstQuestion.finish();assert.equal(firstQuestion.error,undefined);assert.deepEqual(firstQuestion.push('[owner] Another unwanted line.\n'),[]);
});
test('framing cannot bypass semantic narration checks or require a second pass for valid direct speech',async()=>{
 let repairs=0;
 const gate=new SpokenOutputGate({narration:true},async()=>{repairs++;return 'Listen here, Bambi.';});
 const blocks=new SpokenBlockStream(),sentences=blocks.push('[owner] She steps closer.\n');
 assert.equal(await gate.accept(sentences[0],new AbortController().signal),'Listen here, Bambi.');assert.equal(repairs,1);
 assert.equal(await gate.accept('Doll, fuck that noise.',new AbortController().signal),'Doll, fuck that noise.');assert.equal(repairs,1);
});
test('native grammar preserves a natural stop on continuation and limits speaker choices with turn metadata',()=>{
 const native={supportsTurnGrammar:true},options={dualVoice:true,situational:false};
 assert.match(spokenBlockGrammar(native,options)!,/root ::= ws \(owner \(owner \| inner\)\*\)/);
 assert.match(spokenBlockGrammar(native,{...options,generated:true})!,/\(owner \| inner\)\*/);
 const asking=spokenBlockGrammar(native,{...options,situational:true})!;
 assert.match(asking,/"\[turn:ask\]" ws ask/);assert.match(asking,/"\[turn:guide\]" ws owner \(owner \| inner\)\*/);
 assert.match(spokenBlockGrammar(native,{...options,situational:true,closing:true})!,/"\[turn:close\]"/);
 assert.doesNotMatch(spokenBlockGrammar(native,{...options,dualVoice:false})!,/inner ::=/);
 assert.equal(spokenBlockGrammar({supportsTurnGrammar:false},options),undefined);
 assert.doesNotMatch(spokenBlockGrammar(native,options)!,/marker ::=/);
 assert.deepEqual(replyControlPrefixes('Explain the volume.',false,true,'reactive'),['pause']);
 assert.deepEqual(replyControlPrefixes('Guide one breath.',true,false,'reactive',true,true,true),[]);
 assert.deepEqual(replyControlPrefixes('Continue.',true,false,'reactive',true,false,true),['pause','breath','SFX','sound','tick','vib','rot','both']);
 const prompt=buildReplyPrompt('A selected character.','Continue.',false,'',undefined,'',false,true,'reactive','',true);
 assert.ok(prompt.startsWith(buildFixedReplyPrompt('A selected character.')));assert.equal(prompt.split(spokenBlockProtocol).length-1,1);
 assert.doesNotMatch(prompt,/Use \[bambi:\.\.\.feeling/);
});
test('spoken budgets stop at requested sentence/question counts and keep longer explicit passages possible',()=>{
 assert.deepEqual(replyBlockBudget('In one short sentence, explain volume.',false),{min:1,max:1});
 assert.deepEqual(replyBlockBudget('Use exactly two sentences.',false),{min:2,max:2});
 assert.deepEqual(replyBlockBudget('Ask exactly one short question.',false),{min:1,max:1});
 assert.deepEqual(replyBlockBudget('Explain volume.',false),{min:1,max:6});
 assert.equal(replyBlockBudget('Continue.',true,{min:60,max:100}).max,34);
 assert.match(spokenBlockGrammar({supportsTurnGrammar:true},{dualVoice:true,situational:false,minBlocks:2,maxBlocks:2})!,/owner \(owner \| inner\)\{1,1\}/);
 assert.match(spokenBlockGrammar({supportsTurnGrammar:true},{dualVoice:false,situational:false,generated:true,minBlocks:0,maxBlocks:2})!,/owner\{0,2\}/);
});

test('a closing quotation reaches the semantic gate without releasing narrated prose',async()=>{
 const blocks=new SpokenBlockStream(),sentences=blocks.push('[owner] I lean closer and whisper, "Listen here, Bambi."\n');
 assert.equal(blocks.error,undefined);assert.equal(sentences.length,1);
 let repaired=0;const gate=new SpokenOutputGate({narration:true},async()=>{repaired++;return 'Listen here, Bambi.';});
 assert.equal(await gate.accept(sentences[0],new AbortController().signal),'Listen here, Bambi.');assert.equal(repaired,1);
});
