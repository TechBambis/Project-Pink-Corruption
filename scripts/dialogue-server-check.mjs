// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

// Production server source, isolated database and deterministic inference/TTS fixtures.
const repo=resolve('.'),sandbox=mkdtempSync(join(tmpdir(),'bambi-dialogue-'));
for(const dir of ['node_modules','packages','config','presets','docs','voices'])symlinkSync(join(repo,dir),join(sandbox,dir));
writeFileSync(join(sandbox,'package.json'),JSON.stringify({type:'module'}));
mkdirSync(join(sandbox,'apps/server'),{recursive:true});mkdirSync(join(sandbox,'dist/web'),{recursive:true});writeFileSync(join(sandbox,'dist/web/index.html'),'fixture');
symlinkSync(join(repo,'apps/server/bambicloud.ts'),join(sandbox,'apps/server/bambicloud.ts'));
writeFileSync(join(sandbox,'backend.ts'),`
export {SentenceChunker,personaPrompt} from ${JSON.stringify(join(repo,'packages/ai/index.ts'))};
import {writeFileSync} from 'node:fs';
export class OllamaBackend {
 name='fixture';supportsPrefill=true;async models(){return ['fixture'];}
 async structured(messages){const data=JSON.parse(messages.at(-1).content);writeFileSync('listening-messages.json',JSON.stringify(messages));return {action:data.newInput==='mhm'?'continue':data.newInput==='invalid planner'?'invalid':'adapt'};}
 async *stream(messages,model,signal){writeFileSync('messages.json',JSON.stringify(messages));const input=messages.findLast(message=>message.role==='user').content;const prefix=messages.at(-1).role==='assistant'?messages.at(-1).content:'';
 if(input==='Situational question.'){for(const text of ['[tu','rn:ask] ','Which image feels familiar? I will assume a garden.'])yield {text};return;}
 if(input==='Headerless question.'){for(const text of ['Which color',' do you prefer?'])yield {text};return;}
 if(input==='Variant question.'){for(const text of ['[Tu','rn: Ask]',':',' Which color do you prefer? I will answer myself.'])yield {text};return;}
 if(input==='Rhetorical guide.'){yield {text:'[turn: guide] Imagine a quieter color?'};return;}
 if(input==='Headerless unheard question.'){yield {text:'Which color do you prefer?'};return;}
 if(input==='The light through the leaves.'){yield {text:'[turn:guide] Stay with the light through those leaves. [pause:medium] Let that image rest.'};return;}
 if(input==='Engine continuation.'){yield {text:'[turn:guide] [SFX:SNAP] [vib:80] Stay with the image you chose.'};return;}
 if(input==='Unheard question.'){yield {text:'[turn:ask] Which color feels familiar?'};return;}
 if(input==='Closing continuation.'){yield {text:'[turn:close] This session is ending. Notice your ordinary surroundings and move when you wish.'};return;}
 if(input==='Multi-chunk sentence.'){yield {text:'A single sentence. Later sentence.'};return;}
 if(input==='Guide breathing.'){for(const text of '[breath:in] In. [breath:out] And out.')yield {text};return;}
 if(input==='Generate ahead.'){const story=Array.from({length:10},(_,i)=>'Sentence '+i+'. ').join('')+'Finished generating.';for(const text of story.slice(prefix.length))yield {text};return;}
 if(input==='Echo operational note.'){yield {text:'[Respon'};yield {text:'se interrupted by the user. Excerpt of played speech; last phrase may be approximate. Unplayed speech was discarded. Adapt to the new input instead of restarting automatically.]'};yield {text:'All right, I am listening.'};return;}
 yield {text:input==='Please continue.'?'The initial words. The unheard ending.':'I will speak more slowly now.'};
 if(input==='Wait while generating.')await new Promise(resolve=>{signal.addEventListener('abort',resolve,{once:true});});
 }
}
export class LlamaBackend extends OllamaBackend {}
`);
writeFileSync(join(sandbox,'runtime-fixture.ts'),'export async function prepareNativeModel(){};export async function stopNativeModel(){};');
writeFileSync(join(sandbox,'tts-fixture.ts'),`import {scriptUnits} from ${JSON.stringify(join(repo,'packages/speech/script.ts'))};export class Kokoro {async voices(){return ['af_heart'];}async *speak(text){if(text==='A single sentence.'){yield {audio:'fixture',text:'A single',timestamps:[],spoken_seconds:2};yield {audio:'fixture',text:'sentence.',timestamps:[],spoken_seconds:2};yield {audio:'fixture',text:'',timestamps:[],spoken_seconds:0};return;}for(const unit of scriptUnits(text))yield {audio:'fixture',text:unit.text,breath:unit.breath,timestamps:[],spoken_seconds:5};}}`);
let source=readFileSync('apps/server/index.ts','utf8');
source=source.replace("from '../../packages/ai/runtime'","from '../../runtime-fixture'").replace("from '../../packages/ai';","from '../../backend';").replace("from '../../packages/speech/tts'","from '../../tts-fixture'").replaceAll('6969','16969');
// Preserve complete legacy prompts too; the fixture is not a 4K-context model.
source=source.replace('const backendFor=',"modelConnections.fixture={backend:'ollama',context:32768};\nconst backendFor=");
writeFileSync(join(sandbox,'apps/server/index.ts'),source);
const child=spawn(process.execPath,['--import','tsx','apps/server/index.ts'],{cwd:sandbox,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
const events=[];let ws;
const wait=async predicate=>{const deadline=Date.now()+10000;while(!predicate()){if(Date.now()>deadline)throw Error('Timed out: '+logs);await new Promise(resolve=>setTimeout(resolve,25));}};
try{
 await wait(()=>logs.includes('READY'));
 ws=new WebSocket('ws://127.0.0.1:16969/ws',{origin:'http://127.0.0.1:16969'});ws.on('message',raw=>events.push(JSON.parse(raw)));await wait(()=>ws.readyState===WebSocket.OPEN);
 const send=data=>ws.send(JSON.stringify(data));
 send({type:'chat',text:'Please continue.',model:'fixture',speak:true,promptId:'custom'});
 await wait(()=>events.filter(x=>x.type==='audio').length===2);
 const first=events.find(x=>x.type==='begin').id,audio=events.filter(x=>x.type==='audio');
 assert.equal(events.some(x=>x.type==='done'&&x.id===first),false,'generation completion must wait for playback');
 send({type:'interrupt',playback:{id:first,chunks:[{seq:audio[0].seq,chars:11}]}});
 await wait(()=>events.some(x=>x.type==='interrupted'&&x.id===first));
 let memory=await (await fetch('http://127.0.0.1:16969/api/memory')).json();
 assert.equal(memory.turns.length,2);assert.equal(memory.turns[0].content,'Please continue.');
 assert.ok(memory.turns[1].content.endsWith('The initial'));assert.ok(!memory.turns[1].content.includes('unheard ending'));
 send({type:'chat',text:'Please slow down.',model:'fixture',speak:true,promptId:'custom',dialogue:true});
 await wait(()=>events.some(x=>x.type==='audio'&&x.id!==first));
 const second=events.filter(x=>x.type==='begin').at(-1).id,secondAudio=events.find(x=>x.type==='audio'&&x.id===second);
 const context=JSON.parse(readFileSync(join(sandbox,'messages.json')));
 assert.equal(context.at(-1).content,'Please slow down.');assert.equal(context[1].content,'Please continue.');assert.equal(context[2].content,'The initial');assert.ok(context[0].content.includes('Internal playback state'));assert.ok(!context.slice(1).some(turn=>turn.content.includes('[Response interrupted')));assert.ok(context[0].content.includes('Live conversation alongside a running session'));
 // Reports for another request and stale ACKs cannot finish or alter the new turn.
 send({type:'interrupt',playback:{id:first,chunks:[{seq:secondAudio.seq,chars:999}]}});send({type:'ack',id:first,seq:secondAudio.seq});await new Promise(resolve=>setTimeout(resolve,120));
 assert.equal(events.some(x=>x.type==='done'&&x.id===second),false);
 send({type:'ack',id:second,seq:secondAudio.seq,played:true});await wait(()=>events.some(x=>x.type==='done'&&x.id===second));
 memory=await (await fetch('http://127.0.0.1:16969/api/memory')).json();assert.equal(memory.turns.length,4);assert.equal(memory.turns[3].content,'I will speak more slowly now.');
 send({type:'interrupt'});await new Promise(resolve=>setTimeout(resolve,120));
 memory=await (await fetch('http://127.0.0.1:16969/api/memory')).json();assert.equal(memory.turns.length,4,'repeated cancellation must not duplicate turns');
 send({type:'chat',text:'Wait while generating.',model:'fixture',speak:false,promptId:'custom'});
 await wait(()=>events.filter(x=>x.type==='token').length>=3);
 const third=events.filter(x=>x.type==='begin').at(-1).id;send({type:'interrupt'});await wait(()=>events.some(x=>x.type==='interrupted'&&x.id===third));
 memory=await (await fetch('http://127.0.0.1:16969/api/memory')).json();assert.equal(memory.turns.length,6);assert.equal(memory.turns[4].content,'Wait while generating.');assert.equal(memory.turns[5].content,'I will speak more slowly now.');assert.ok(!memory.turns.some(turn=>turn.content.includes('[Response interrupted')));
 send({type:'chat',text:'Echo operational note.',model:'fixture',speak:true,promptId:'custom'});await wait(()=>events.some(event=>event.type==='audio'&&event.text==='All right, I am listening.'));
 const echoed=events.filter(event=>event.type==='begin').at(-1).id;assert.equal(events.filter(event=>event.type==='token'&&event.id===echoed).map(event=>event.text).join(''),'All right, I am listening.');assert.ok(events.filter(event=>event.type==='audio'&&event.id===echoed).every(event=>!event.text.includes('Response interrupted')));
 send({type:'interrupt'});
 send({type:'chat',text:'Generate ahead.',model:'fixture',speak:true,promptId:'custom'});
 await wait(()=>events.filter(event=>event.type==='token').map(event=>event.text).join('').includes('Sentence 2.'));
 const ahead=events.filter(event=>event.type==='begin').at(-1).id;
 await wait(()=>events.filter(event=>event.type==='audio'&&event.id===ahead).length===2);
 assert.equal(events.some(event=>event.type==='done'&&event.id===ahead),false);
 assert.equal(events.filter(event=>event.type==='audio'&&event.id===ahead).length,2,'audio queue must remain bounded while text runs ahead');
 assert.ok(!events.filter(event=>event.type==='token'&&event.id===ahead).map(event=>event.text).join('').includes('Finished generating.'),'text lookahead is bounded too');
 const drain=setInterval(()=>{for(const audio of events.filter(event=>event.type==='audio'&&event.id===ahead))send({type:'ack',id:ahead,seq:audio.seq,played:true});},25);
 await wait(()=>events.some(event=>event.type==='done'&&event.id===ahead));clearInterval(drain);
 assert.equal(events.filter(event=>event.type==='token'&&event.id===ahead).map(event=>event.text).join(''),Array.from({length:10},(_,i)=>'Sentence '+i+'. ').join('')+'Finished generating.','prefill continues the same answer without duplicated sentences');
 send({type:'chat',text:'Guide breathing.',model:'fixture',speak:true,promptId:'custom',dialogue:true});
 await wait(()=>events.filter(event=>event.type==='audio'&&event.breath).length===2);
 const breathing=events.filter(event=>event.type==='begin').at(-1).id,breaths=events.filter(event=>event.type==='audio'&&event.id===breathing);
 assert.deepEqual(breaths.map(event=>event.breath.direction),['in','out']);
 assert.deepEqual(breaths.map(event=>event.text),['In.','And out.']);
 assert.ok(!events.filter(event=>event.type==='token'&&event.id===breathing).map(event=>event.text).join('').includes('breath:'));
 for(const event of breaths)send({type:'ack',id:breathing,seq:event.seq,played:true});
 await wait(()=>events.some(event=>event.type==='done'&&event.id===breathing));
 send({type:'chat',text:'Multi-chunk sentence.',model:'fixture',speak:true,promptId:'custom',dialogue:true});
 await wait(()=>events.filter(x=>x.type==='begin').at(-1).id!==breathing);
 await wait(()=>events.some(event=>event.type==='sentence-end'&&event.id===events.filter(x=>x.type==='begin').at(-1).id));
 const multi=events.filter(event=>event.type==='begin').at(-1).id;
 const multiAudio=events.filter(event=>event.type==='audio'&&event.id===multi&&event.sentenceId===0);
 assert.equal(multiAudio.length,3);assert.ok(multiAudio.every(event=>event.sentenceId===0),JSON.stringify(multiAudio));
 const marker=events.findIndex(event=>event.type==='sentence-end'&&event.id===multi&&event.sentenceId===0);
 assert.ok(marker>events.findIndex(event=>event.type==='audio'&&event.id===multi&&event.seq===1),'Sentence boundary comes after every chunk of the sentence');
 const listen={text:'mhm',heard:'A single',draft:'A single sentence. Later sentence.',question:'Multi-chunk sentence.',model:'fixture',backend:'ollama',context:4096};
 let response=await fetch('http://127.0.0.1:16969/api/listen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(listen)});
 assert.deepEqual(await response.json(),{action:'continue'});
 assert.equal(events.some(event=>event.type==='interrupted'&&event.id===multi),false,'Planner does not cancel active output');
 response=await fetch('http://127.0.0.1:16969/api/listen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...listen,text:'Please speak slowly.'})});assert.deepEqual(await response.json(),{action:'adapt'});
 response=await fetch('http://127.0.0.1:16969/api/listen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...listen,text:'invalid planner'})});assert.equal(response.status,503,'Malformed decisions fail validation');
 send({type:'feedback-consumed',replyId:first,inputId:crypto.randomUUID(),text:'stale input'});
 const inputId=crypto.randomUUID();for(let i=0;i<2;i++)send({type:'feedback-consumed',replyId:'',inputId,text:'mhm'});
 for(const event of multiAudio)send({type:'ack',id:multi,seq:event.seq,played:true});
 await wait(()=>events.filter(event=>event.type==='audio'&&event.id===multi).length===4);
 const later=events.filter(event=>event.type==='audio'&&event.id===multi).at(-1);assert.equal(later.sentenceId,1);send({type:'ack',id:multi,seq:later.seq,played:true});
 await wait(()=>events.some(event=>event.type==='done'&&event.id===multi));
 memory=await (await fetch('http://127.0.0.1:16969/api/memory')).json();assert.equal(memory.turns.filter(turn=>turn.role==='user'&&turn.content==='mhm').length,1,'Consumed feedback is stored exactly once');assert.ok(!memory.turns.some(turn=>turn.content==='stale input'));
 // The situational contract uses the same production playback/history path.
 const startSituational=async(text,extra={})=>{
  const previous=events.filter(event=>event.type==='begin').at(-1)?.id;
  send({type:'chat',text,model:'fixture',speak:true,promptId:'custom',interaction:'situational',...extra});
  await wait(()=>events.filter(event=>event.type==='begin').at(-1)?.id!==previous);
  const id=events.filter(event=>event.type==='begin').at(-1).id;
  await wait(()=>events.some(event=>event.type==='audio'&&event.id===id));return id;
 };
 const drainSituational=async id=>{
  const timer=setInterval(()=>{for(const audio of events.filter(event=>event.type==='audio'&&event.id===id))send({type:'ack',id,seq:audio.seq,played:true});},25);
  try{await wait(()=>events.some(event=>event.type==='done'&&event.id===id));}finally{clearInterval(timer);}
  return events.find(event=>event.type==='done'&&event.id===id);
 };
 const question=await startSituational('Situational question.');
 await wait(()=>events.filter(event=>event.type==='token'&&event.id===question).map(event=>event.text).join('').endsWith('?'));
 assert.equal(events.some(event=>event.type==='done'&&event.id===question),false);
 assert.equal(events.filter(event=>event.type==='token'&&event.id===question).map(event=>event.text).join(''),'Which image feels familiar?');
 assert.ok(events.filter(event=>event.type==='audio'&&event.id===question).every(event=>!event.text.includes('[turn:')&&!event.text.includes('assume')));
 assert.equal((await drainSituational(question)).expectsReply,true);
 const answer=await startSituational('The light through the leaves.');
 const answerContext=JSON.parse(readFileSync(join(sandbox,'messages.json')));
 assert.ok(answerContext[0].content.includes('"deliveredQuestion":"Which image feels familiar?"'));
 assert.ok(answerContext[0].content.includes('"latestRealInput":"The light through the leaves."'));
 assert.ok(answerContext[0].content.includes('REAL LISTENER & CONVERSATION EVIDENCE'));
 assert.ok(answerContext[0].content.includes('never present them as actual past listener statements, visits, promises, consent or confirmed preferences'));
 assert.ok(answerContext[0].content.includes('SITUATIONAL CONTRIBUTION'));
 assert.equal((await drainSituational(answer)).expectsReply,false);
 assert.ok(events.filter(event=>event.type==='audio'&&event.id===answer).some(event=>event.text.includes('[pause:medium]')),'intentional pauses reach the speech renderer');
 for(const input of ['Headerless question.','Variant question.']){
  const id=await startSituational(input);
  await wait(()=>events.filter(event=>event.type==='token'&&event.id===id).map(event=>event.text).join('').endsWith('?'));
  assert.equal(events.some(event=>event.type==='done'&&event.id===id),false,'A question cannot open a reply window before playback');
  const result=await drainSituational(id);assert.equal(result.expectsReply,true);assert.equal(result.conversationAction,'ask');
  assert.equal(events.filter(event=>event.type==='token'&&event.id===id).map(event=>event.text).join(''),'Which color do you prefer?');
 }
 const rhetorical=await startSituational('Rhetorical guide.');assert.equal((await drainSituational(rhetorical)).expectsReply,false);
 const headerlessUnheard=await startSituational('Headerless unheard question.');
 send({type:'interrupt',playback:{id:headerlessUnheard,chunks:[]}});await wait(()=>events.some(event=>event.type==='interrupted'&&event.id===headerlessUnheard));
 const engine=await startSituational('Engine continuation.',{source:'engine',intent:'narration',dialogue:false});
 const fallbackContext=JSON.parse(readFileSync(join(sandbox,'messages.json')));assert.ok(fallbackContext[0].content.includes('"deliveredQuestion":null'),'An unheard headerless question cannot open a reply window');
 assert.equal((await drainSituational(engine)).expectsReply,false);
 assert.ok(events.filter(event=>event.type==='audio'&&event.id===engine).every(event=>!event.cuesBefore?.length&&!event.devicesAtWord?.length&&!event.text.includes('SFX:')),'unrequested controls cannot bypass the situational speech contract');
 memory=await (await fetch('http://127.0.0.1:16969/api/memory')).json();
 assert.ok(!memory.turns.some(turn=>turn.content==='Engine continuation.'));
 assert.ok(!memory.turns.some(turn=>turn.content.includes('[turn:')));
 const unheard=await startSituational('Unheard question.');
 send({type:'interrupt',playback:{id:unheard,chunks:[]}});await wait(()=>events.some(event=>event.type==='interrupted'&&event.id===unheard));
 const afterUnheard=await startSituational('Engine continuation.',{source:'engine',intent:'narration'});
 const unheardContext=JSON.parse(readFileSync(join(sandbox,'messages.json')));
 assert.ok(unheardContext[0].content.includes('"deliveredQuestion":null'));
 assert.ok(!unheardContext.slice(1).some(turn=>turn.role==='assistant'&&turn.content.includes('Which color feels familiar?')));
 await drainSituational(afterUnheard);
 const closing=await startSituational('Closing continuation.',{source:'engine',intent:'narration',session:{phase:'awakening',phaseProgress:90,scene:'Soft Pink',intensity:3,intensityPercent:50,elapsedMin:4.9,totalMin:5,activeTriggers:[],lastTrigger:null}});
 assert.equal((await drainSituational(closing)).expectsReply,false);
 const resetResponse=await fetch('http://127.0.0.1:16969/api/conversation',{method:'POST'});assert.equal(resetResponse.status,200);
 const reset=await startSituational('Engine continuation.',{source:'engine',intent:'narration'});
 const resetContext=JSON.parse(readFileSync(join(sandbox,'messages.json')));
 assert.ok(resetContext[0].content.includes('"latestRealInput":""'));
 assert.ok(!resetContext.some(turn=>turn.content.includes('Which image feels familiar?')));
 await drainSituational(reset);
 const report={situationalQuestionWaitsForPlayback:true,situationalAnswerReusesActualEvidence:true,situationalHeaderHidden:true,situationalQuestionStopsBeforeSelfAnswer:true,situationalPausesReachSpeech:true,engineDirectivesNotStoredAsUserInput:true,unheardQuestionsNotAssumed:true,newConversationClearsSituationalEvidence:true,closingWithoutReplyWindow:true,listeningPlannerDoesNotInterrupt:true,listeningOutputValidated:true,explicitSentenceBoundaries:true,threeChunkSentenceWithoutDeadlock:true,backchannelStoredOnce:true,breathingMetadataSurvivesDialogue:true,boundedTextLookahead:true,prefillWithoutDuplicateSentences:true,audioQueueBounded:true,markerNeverDisplayedOrVoiced:true,scope:'Production server source with isolated database and fixture LLM/TTS; no active user session or models changed.',interruptedQuestionPreserved:true,unheardEndingDiscarded:true,adaptiveContext:true,waitsForPlayback:true,staleAckIgnored:true,cancelIdempotent:true,textInterruption:true};
 report.headerlessQuestionWaitsForPlayback=true;report.headerVariantsPrivate=true;report.explicitGuideNeverInfersReply=true;report.unheardHeaderlessQuestionIgnored=true;
 writeFileSync('runtime/dialogue-server-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(logs);console.error(JSON.stringify(events.filter(event=>['error','notice','begin','done','audio'].includes(event.type)).slice(-12)));throw error;}finally{ws?.terminate();child.kill('SIGTERM');if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve));rmSync(sandbox,{recursive:true,force:true});}
