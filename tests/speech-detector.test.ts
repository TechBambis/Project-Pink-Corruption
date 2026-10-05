// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechDetector} from '../packages/speech/detector';
import {Message} from '@ricky0123/vad-web/dist/messages';
import {DialogueDisplayStream,cleanDialogueText} from '../packages/ai/dialogue';
import {Store} from '../packages/storage';

const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
test('only enough classified speech can take the turn; noise energy and tentative speech cannot',async()=>{
 let probability=.01;const events:string[]=[];
 const detector=new SpeechDetector({process:async()=>({isSpeech:probability,notSpeech:1-probability}),reset_state(){},async release(){}},event=>events.push(event.msg),error=>{throw error;});
 const feed=async(count:number)=>{for(let i=0;i<count;i++){detector.push(new Float32Array(512).fill(.2),16000);await settle();}};
 await feed(50);assert.ok(!events.includes(Message.SpeechRealStart),'Loud non-speech must not interrupt');
 probability=.95;await feed(2);probability=.01;await feed(25);assert.ok(events.includes(Message.VADMisfire));assert.ok(!events.includes(Message.SpeechRealStart));
 probability=.95;await feed(12);assert.equal(events.filter(event=>event===Message.SpeechRealStart).length,1);
 probability=.01;await feed(25);assert.equal(events.filter(event=>event===Message.SpeechEnd).length,1);await detector.destroy();
});
test('pending inference cannot emit speech after capture has been reset',async()=>{
 let resolve!:(value:{isSpeech:number;notSpeech:number})=>void;const events:string[]=[];
 const detector=new SpeechDetector({process:()=>new Promise(done=>{resolve=done;}),reset_state(){},async release(){}},event=>events.push(event.msg),error=>{throw error;});
 detector.push(new Float32Array(512),16000);detector.reset();resolve({isSpeech:1,notSpeech:0});await settle();assert.deepEqual(events,[]);await detector.destroy();
});
test('a quiet sentence onset survives delayed confirmation, which takes 224ms in normal mode',async()=>{
 let probability=.01,processed=0,confirmedAt=0;
 const segments:Float32Array[]=[];
 const detector=new SpeechDetector({process:async()=>({isSpeech:probability,notSpeech:1-probability}),reset_state(){},async release(){}},event=>{
  if(event.msg===Message.FrameProcessed)processed++;
  if(event.msg===Message.SpeechRealStart)confirmedAt=processed;
  if(event.msg===Message.SpeechEnd)segments.push(event.audio);
 },error=>{throw error;});
 const feed=async(count:number,sample:number)=>{for(let i=0;i<count;i++){detector.push(new Float32Array(512).fill(sample),16000);await settle();}};
 await feed(10,.001);
 probability=.4;await feed(20,.012); // First words are softer than the detection threshold for 640ms.
 assert.equal(confirmedAt,0);
 probability=.65;await feed(6,.08);assert.equal(confirmedAt,0);
 await feed(1,.08);assert.equal(confirmedAt,37);
 probability=.01;await feed(25,.001);
 assert.equal(segments.length,1);
 assert.equal(segments[0].filter(sample=>sample===Math.fround(.012)).length,20*512,'All 640ms of the quiet opening reach recognition');
 await detector.destroy();
});
test('operational interruption markers disappear even when model tokens split them at every position',()=>{
 const marker='[Response interrupted by the user. Excerpt of played speech; last phrase may be approximate. Unplayed speech was discarded. Adapt to the new input instead of restarting automatically.]';
 for(let split=1;split<marker.length;split++){const stream=new DialogueDisplayStream();assert.equal(stream.push('Hello. '+marker.slice(0,split))+stream.push(marker.slice(split)+' I hear you.')+stream.flush(),'Hello.  I hear you.');}
 const stream=new DialogueDisplayStream();assert.equal(stream.push('[pause] Continue.')+stream.flush(),'[pause] Continue.');
 assert.equal(cleanDialogueText(marker+'\nHeard words.'),'Heard words.');
});
test('legacy history and interruption metadata never appear as assistant speech in memories',()=>{
 const store=new Store(':memory:');store.addTurn('user','Hello.');store.addTurn('assistant','[Response interrupted by the user. Adapt to the new input instead of restarting automatically.]\nHeard words.');store.addTurn('assistant','','disconnected');
 assert.deepEqual(store.recent(),[{role:'user',content:'Hello.'},{role:'assistant',content:'Heard words.'}]);
 assert.equal(store.conversation()[1].interruption,'interrupted');assert.equal(store.conversation()[2].interruption,'disconnected');store.db.close();
});

test('saved assistant device commands stay in playback history but out of visible memories',()=>{
 const store=new Store(':memory:');store.addTurn('user','What does [vib:on:0.25] mean?');store.addTurn('assistant','Mm. [vib:on:0.25] [vib:pattern:constant] Breathe gently.');
 assert.equal(store.recent()[0].content,'What does [vib:on:0.25] mean?');
 assert.equal(store.recent()[1].content,'Mm.   Breathe gently.');
 assert.ok(store.conversation()[1].content.includes('[vib:on:0.25]'));
 store.db.close();
});
