// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSpokenText,SpokenContractError,SpokenOutputGate} from '../packages/speech/contract';

test('the shared address rule rejects pet while retaining profanity and ordinary substrings',()=>{
 for(const text of ['Good evening, pet.','My PET, stay here.','You are my little pet.','[bambi] I am her pet.'])assert.throws(()=>validateSpokenText(text),SpokenContractError);
 for(const text of ['Bambi, this shit is loud.','Doll, fuck that noise.','The petals stay pink.'])assert.equal(validateSpokenText(text),text);
 assert.doesNotThrow(()=>validateSpokenText('Pet means a companion animal.',{request:'What does pet mean?'}));
 assert.throws(()=>validateSpokenText('Of course, pet.',{request:'Do not call me pet.'}),SpokenContractError);
});
test('owner descriptions and known broken endings are rejected without banning other women',()=>{
 assert.throws(()=>validateSpokenText("The Owner's eyes gleam.",{narration:true}),SpokenContractError);
 assert.throws(()=>validateSpokenText('It is warm and steady, a I!',{narration:true}),SpokenContractError);
 assert.doesNotThrow(()=>validateSpokenText('She gave you that book.',{narration:true}));
 assert.doesNotThrow(()=>validateSpokenText("The hypnotist's voice is prerecorded.",{narration:false}));
});
test('first-person roleplay actions are narration too, while direct speech and explanations remain possible',async()=>{
 for(const text of ['I lean in close, my lips brushing against your ear as I whisper, "Stay with me."','*I lean closer.* "Listen, Bambi."','My eyes darken as I watch you.','I whisper, "Listen to me."'])assert.throws(()=>validateSpokenText(text,{speaker:'owner'}),/only the words spoken/);
 for(const text of ['I want you to listen, Bambi.','I love hearing your answer.','You can imagine a whisper near your ear.','I lean toward the second option in this comparison.','Bambi, fuck that noise.'])assert.equal(validateSpokenText(text,{speaker:'owner'}),text);
 assert.doesNotThrow(()=>validateSpokenText('I lean closer is a first-person stage direction.',{speaker:'owner',request:'Explain why the phrase I lean closer is narration.'}));
 const rejected='I lean in close, my lips brushing against your ear as I whisper, "Listen to me."';
 const gate=new SpokenOutputGate({},async(text,_speaker,reason)=>{assert.equal(text,rejected);assert.match(reason,/first- or third-person stage directions/);return 'Listen to me, Bambi.';});
 assert.equal(await gate.accept(rejected,new AbortController().signal),'Listen to me, Bambi.');
});
test('pronoun-led stage directions are withheld in chat and narration, including mixed quoted dialogue',async()=>{
 const examples=[
  'Her eyes narrow dangerously at your crude outburst.',
  '"What was that, doll?" She steps closer, towering over you.',
  'She steps closer. "Listen to me, Bambi."',
  'Her lips curl into a smile as she gazes down at you.',
  'She whispers, "Listen to me."',
  'With a quiet smile, she leans toward your ear.',
  '" Pointing to the glowing screen, she commands: "Load the file.',
  '" Her tone brooks no argument.',
  '" She taps her foot impatiently, waiting for you to comply with her demands.',
  '" Her gaze bores into you, daring you to defy her again.',
 ];
 for(const narration of [false,true])for(const text of examples){
  assert.throws(()=>validateSpokenText(text,{speaker:'owner',narration}),/only the words spoken/);
 }
 for(const text of ['She gave you that book.','Her eyes are brown.','She says the server is running.','Bambi, listen to me.','Doll, fuck that noise.'])assert.equal(validateSpokenText(text,{narration:true}),text);
 assert.doesNotThrow(()=>validateSpokenText(examples[0],{request:'Translate the sentence Her eyes narrow dangerously at your crude outburst.'}));
 const gate=new SpokenOutputGate({narration:false},async(text,_speaker,reason)=>{
  assert.equal(text,examples[1]);assert.match(reason,/third-person stage directions/);return 'What was that, doll?';
 });
 assert.equal(await gate.accept(examples[1],new AbortController().signal),'What was that, doll?');
 const badRepair=new SpokenOutputGate({},async()=>examples[0]);
 await assert.rejects(badRepair.accept(examples[2],new AbortController().signal),SpokenContractError);
});
test('a rejected candidate is withheld until a validated replacement exists, retaining the inner route',async()=>{
 let resolve!:(text:string)=>void,calls=0;
 const gate=new SpokenOutputGate({narration:true},async(_text,speaker,reason)=>{calls++;assert.equal(speaker,'bambi');assert.match(reason,/Bambi or doll/);return new Promise<string>(done=>resolve=done);});
 let released=false;const pending=gate.accept('[bambi] I am her pet.',new AbortController().signal).then(text=>{released=true;return text;});
 await Promise.resolve();assert.equal(released,false);resolve('I can follow this thought.');
 assert.equal(await pending,'[bambi]I can follow this thought.');assert.equal(calls,1);
 await assert.rejects(gate.accept('Stay here, pet.',new AbortController().signal),SpokenContractError);assert.equal(calls,1);
});
test('failed repair never releases a bad replacement, and Stop rejects delayed repair',async()=>{
 const signal=new AbortController().signal;
 for(const replacement of ['Still here, pet.','[owner] Bambi, stay here.','An unfinished replacement','I lean closer.']){
  const gate=new SpokenOutputGate({},async()=>replacement);await assert.rejects(gate.accept('Stay here, pet.',signal),SpokenContractError);
 }
 const stop=new AbortController(),gate=new SpokenOutputGate({},async()=>{stop.abort(Error('Stopped'));return 'Stay here, Bambi.';});
 await assert.rejects(gate.accept('Stay here, pet.',stop.signal),/Stopped/);
});

test('a copied long guide is regenerated, while an explicit repeat request remains possible',async()=>{
 const heard='Keep the same quiet light in view while I guide the next gentle thought.';
 const gate=new SpokenOutputGate({narration:true,heardText:heard},async(_text,_speaker,reason)=>{assert.match(reason,/Do not copy/);return 'Let that familiar light become a little warmer now.';});
 assert.equal(await gate.accept(heard,new AbortController().signal),'Let that familiar light become a little warmer now.');
 assert.doesNotThrow(()=>validateSpokenText(heard,{narration:true,heardText:heard,request:'Repeat that sentence.'}));
});

test('inner thoughts cannot address the listener as a separate Bambi but can name themselves',()=>{
 assert.throws(()=>validateSpokenText('It feels quiet, Bambi.',{speaker:'bambi'}),/first person/);
 assert.doesNotThrow(()=>validateSpokenText('I am Bambi. I can feel that warmth.',{speaker:'bambi'}));
});
