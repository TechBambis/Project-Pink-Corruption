// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyProgress, PlaybackReportSchema } from '../packages/ai/dialogue';
import { SpeechPlayback } from '../packages/speech/playback';
import { VoiceActivity } from '../packages/speech/activity';

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

test('thoughtful turn timing preserves short pauses and quicker turns still reject clicks',()=>{
 const gate=new VoiceActivity();gate.silenceMs=1100;for(let i=0;i<25;i++)gate.process(.002,20);
 for(let i=0;i<20;i++)gate.process(.08,20);for(let i=0;i<40;i++)assert.equal(gate.process(.002,20).end,false);
 assert.equal(gate.active,true);for(let i=0;i<10;i++)gate.process(.08,20);
 const endings=[];for(let i=0;i<60;i++)endings.push(gate.process(.002,20));assert.equal(endings.filter(x=>x.end&&x.valid).length,1);
 gate.silenceMs=450;for(let i=0;i<3;i++)assert.equal(gate.process(.1,20).start,false);
 for(let i=0;i<40;i++)assert.equal(gate.process(.002,20).start,false);
});
