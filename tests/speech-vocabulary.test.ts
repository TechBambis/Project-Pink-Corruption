// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSpeechVocabulary,speechVocabularyPrompt} from '../packages/speech/vocabulary';
import {transcribe} from '../packages/speech/whisper';
test('speech vocabulary includes config/content names and current UI choices without persona instructions',()=>{
 const terms=buildSpeechVocabulary();assert.ok(terms.length>100);
 for(const name of ['Breathing','Atemkreis','Spiral Focus','Deep Tunnel','JoyHub','Lovense','sub dive','breathe','BAMBI SLEEP'])assert.ok(terms.some(term=>term.toLowerCase()===name.toLowerCase()),name);
 assert.ok(!terms.some(term=>term.includes('[vib:')||term.includes('Never speak')));
 const prompt=speechVocabularyPrompt(terms,{'scene':'Deep Tunnel','trigger-selection':'["BAMBI SLEEP"]'},'Please change the balloon inflation and wipers.');
 assert.ok(prompt.includes('Breathing'));assert.ok(/Balloon inflation/i.test(prompt));assert.ok(/wipers/i.test(prompt));assert.ok(new TextEncoder().encode(prompt).length<=600);
});
test('Whisper receives glossary hints while keeping automatic language and actual transcript intact',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async(_url,options)=>{const form=options!.body as FormData;assert.equal(form.get('prompt'),'Breathing, Einatmen');assert.equal(form.get('language'),'auto');return Response.json({text:'Please give me a briefing.'});};
  const result=await transcribe(new Blob(['wav']),AbortSignal.timeout(1000),'http://fixture','Breathing, Einatmen');assert.equal(result.text,'Please give me a briefing.');
 }finally{globalThis.fetch=original;}
});
