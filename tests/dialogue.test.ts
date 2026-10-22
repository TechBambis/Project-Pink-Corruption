// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyProgress, PlaybackReportSchema, spokenHistoryMessages } from '../packages/ai/dialogue';
import { SpeechPlayback } from '../packages/speech/playback';

test('spoken model history excludes prior stage directions without changing stored turns or ordinary references',()=>{
 const turns:{role:'user'|'assistant';content:string}[]=[
  {role:'user',content:'Where should I listen?'},
  {role:'assistant',content:'Her eyes narrow. "Listen here, doll." She steps closer.'},
  {role:'user',content:'Speak directly to me.'},
  {role:'assistant',content:'Bambi, fuck that noise.'},
  {role:'user',content:'What about that book?'},
  {role:'assistant',content:'She gave you that book.'},
 ];
 const original=structuredClone(turns),messages=spokenHistoryMessages(turns);
 assert.deepEqual(messages,[turns[0],...turns.slice(2)]);
 assert.deepEqual(turns,original,'Visible history is never rewritten or removed');
 const explained=[{role:'user' as const,content:'Translate the sentence Her eyes narrow.'},{role:'assistant' as const,content:'Her eyes narrow.'}];
 assert.deepEqual(spokenHistoryMessages(explained),explained);
 assert.deepEqual(spokenHistoryMessages([{role:'assistant',content:'A previously rejected response.',interruption:'spoken-contract'}]),[]);
});

test('parallel inner speech cannot redefine the narrator or credit unheard main words',()=>{
 const reply=new ReplyProgress();
 reply.register(0,'Notice the warm light.','owner');reply.register(1,'I feel','bambi');reply.register(2,'warm.','bambi');reply.register(3,'Let it surround you.','owner');
 reply.played(2);reply.played(1);
 const heardInner=reply.spoken;assert.equal(heardInner,'(Imagined inner feminine voice: "I feel warm.")');
 assert.ok(!reply.spoken.includes('Notice'),'A shorter inner voice may finish before the main voice');
 reply.played(0,6);
 const heardPartial=reply.spoken;assert.equal(heardPartial,'Notice (Imagined inner feminine voice: "I feel warm.")');
 assert.ok(!reply.spoken.includes('surround'));
 reply.played(0);reply.played(3);
 assert.equal(reply.interrupted(true,''),'Notice the warm light. (Imagined inner feminine voice: "I feel warm.") Let it surround you.');
});

test('interruption includes completed words and excludes unplayed queued speech',()=>{
 const playback=new SpeechPlayback();playback.schedule(0,'Hello there.',10,2,[{word:'Hello',start_time:0,end_time:.8},{word:'there.',start_time:.8,end_time:2}]);playback.schedule(1,'Unheard ending.',12,2);
 assert.deepEqual(playback.progress(9),[]);assert.deepEqual(playback.progress(11),[{seq:0,chars:5}]);
 const reply=new ReplyProgress();reply.register(0,'Hello there.');reply.register(1,'Unheard ending.');
 for(const chunk of playback.progress(11))reply.played(chunk.seq,chunk.chars);
 assert.equal(reply.spoken,'Hello');assert.ok(!reply.interrupted(true,'Hello there. Unheard ending.').includes('Unheard ending'));
 reply.played(0);playback.complete(0);assert.equal(reply.spoken,'Hello there.');assert.deepEqual(playback.progress(11),[]);
 reply.played(999,9999);reply.played(0,1);assert.equal(reply.spoken,'Hello there.');
 assert.equal(PlaybackReportSchema.safeParse({id:'old',chunks:[{seq:-1,chars:1}]}).success,false);
 assert.equal(PlaybackReportSchema.safeParse({id:'old',chunks:[{seq:0,chars:5,text:'fabricated'}]}).success,false);
});

test('phrase-only speech estimates whole words, freezes on pause and clears on interruption',()=>{
 const playback=new SpeechPlayback();playback.schedule(2,'Take a moment to settle in.',2,4);
 const partial=playback.progress(4)[0];assert.ok(partial.chars>0&&partial.chars<26);assert.ok(!/\S$/.test('Take a moment to settle in.'.slice(partial.chars-1,partial.chars+1)));
 assert.deepEqual(playback.progress(4),[partial]);playback.clear();assert.deepEqual(playback.progress(10),[]);
 const reply=new ReplyProgress();reply.register(2,'Take a moment to settle in.');reply.played(2,10000);assert.equal(reply.spoken,'Take a moment to settle in.');
});

test('display reveals at caption word onset, freezes on pause and excludes future chunks',()=>{
 const playback=new SpeechPlayback();playback.schedule(0,'Hello there.',10,2,[{word:'Hello',start_time:.2,end_time:.8},{word:'there.',start_time:.8,end_time:2}]);playback.schedule(1,'Next sentence.',13,2);
 assert.equal(playback.revealed(10.19),'');assert.equal(playback.revealed(10.2),'Hello');
 assert.equal(playback.revealed(10.79),'Hello');assert.equal(playback.revealed(10.8),'Hello there.');
 assert.equal(playback.revealed(10.8),'Hello there.');
 playback.complete(0);assert.equal(playback.revealed(10.79),'Hello','Source completion cannot bypass output latency');
 assert.equal(playback.revealed(12.5),'Hello there.');assert.equal(playback.revealed(13),'Hello there. Next');
 playback.clear();assert.equal(playback.revealed(20),'');
});
