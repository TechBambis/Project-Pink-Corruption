// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage} from 'node:http';
import {ChatRequestSchema,buildChatRequest} from '../packages/ai/request';
import {rawRoleplayStyleNote,languageStyleDirection} from '../packages/ai/language-style';
import {buildCharacterDocument,eventNarrationMessages} from '../packages/ai/character';
import {buildFixedReplyPrompt,buildReplyPrompt} from '../packages/ai/prompt';
import {checkpointContextMessages,fitContext,estimateChatTokens,type TokenCounter} from '../packages/ai/context';
import {preflightReplyContext} from '../packages/ai/preflight';
import {OllamaBackend,LlamaBackend,type Message} from '../packages/ai';
import {DialogueDisplayStream,visibleDialogueText} from '../packages/ai/dialogue';
import {ActionStream} from '../packages/ai/actions';
import {ScriptDisplayStream,normalizeScript,scriptUnits} from '../packages/speech/script';
import {Kokoro} from '../packages/speech/tts';
import {EventSpeechRequestSchema} from '../packages/session-director/events/speech';
import {createReferenceProgram} from '../packages/session-director/events/program';
import {PreferencesSchema,portablePreferences} from '../packages/profiles/preferences';

const count:TokenCounter=async messages=>estimateChatTokens(messages);
const input='Damn, match my language.';
const response='Fuck, this shit is loud. Damn it.';
const occurrences=(text:string)=>text.split(rawRoleplayStyleNote).length-1;

test('language is unfiltered by default and legacy flags cannot turn it off',()=>{
 const standard=buildChatRequest({type:'chat',text:input,model:'local-fixture',promptId:'custom'});
 assert.equal(standard.nsfw,false);assert.equal(standard.rawRoleplay,false);
 assert.equal(standard.text,input);assert.equal(languageStyleDirection(standard),rawRoleplayStyleNote);
 // The wording is editable; the transport checks below assert that the actual
 // configured instruction survives all paths, rather than one fixed phrase.
 assert.ok(rawRoleplayStyleNote.trim().length>0);
 assert.doesNotMatch(rawRoleplayStyleNote,/This is an .*roleplay/);
 for(const style of [{},{nsfw:false},{rawRoleplay:false},{nsfw:false,rawRoleplay:false},{nsfw:true},{rawRoleplay:true},{nsfw:true,rawRoleplay:true}]){
  const request=buildChatRequest({type:'chat',text:input,...style});
  assert.equal(languageStyleDirection(request),rawRoleplayStyleNote);
 }
 for(const flags of [{nsfw:'true'},{rawRoleplay:1},{rawRoleplay:null}])assert.equal(ChatRequestSchema.safeParse({type:'chat',text:input,...flags}).success,false);
 assert.deepEqual(PreferencesSchema.parse({'raw-roleplay':true}),{'raw-roleplay':true});
 assert.deepEqual(portablePreferences({'raw-roleplay':true}),{'raw-roleplay':true});
});

test('all characters and reply modes keep the exact note once in the system role, including checkpoints',async()=>{
 for(const promptId of ['bambisleep-classic','gentle-induction','english-conversation','bambi-companion','custom'] as const){
  const request=ChatRequestSchema.parse({type:'chat',text:input,promptId,persona:'A blunt, witty companion.'});
  const base=buildCharacterDocument(request).core;
  for(const interaction of ['reactive','situational'] as const)for(const narration of [false,true]){
   const make=(style={})=>buildReplyPrompt(base,input,false,'Device control is disabled.',undefined,'',!narration,narration,interaction,'',false,'general',style);
   const standard=make();assert.equal(occurrences(standard),1);
   for(const style of [{},{nsfw:false,rawRoleplay:false},{nsfw:true},{rawRoleplay:true},{nsfw:true,rawRoleplay:true}]){
    const system=make(style),prefix=buildFixedReplyPrompt(base,interaction,style);
    assert.ok(system.startsWith(prefix));assert.ok(prefix.startsWith(base));assert.equal(occurrences(system),1);
    assert.ok(prefix.endsWith(rawRoleplayStyleNote));assert.equal(prefix,buildFixedReplyPrompt(base,interaction));
    const history:Message[]=[{role:'user',content:'Earlier request.'},{role:'assistant',content:response}];
    const messages=checkpointContextMessages([{role:'system',content:system},...history,{role:'user',content:input}],prefix);
    assert.equal(occurrences(messages[0].content),1);
    assert.ok(messages.slice(1).every(message=>occurrences(message.content)===0));
    assert.equal(messages.at(-1)?.content,input);assert.deepEqual(messages.slice(2,4),history);
   }
   const system=make({rawRoleplay:true});
   const fitted=await fitContext(system,[],input,count,65536,512,256,64,'Optional quoted evidence.');
   assert.equal(occurrences(fitted.messages[0].content),1);
   assert.ok(fitted.messages[0].content.startsWith(system));
   const defaultPlan=await fitContext(standard,[],input,count,65536,512);
   assert.equal(occurrences(defaultPlan.messages[0].content),1);
  }
 }
});

test('preparation budgets the same full language instructions for conversation and every narration phase',async()=>{
 const base=buildCharacterDocument(ChatRequestSchema.parse({type:'chat',text:input,promptId:'custom'})).core;
 for(const interaction of ['reactive','situational'] as const){
  const observed:Message[][]=[];
  const budgets=await preflightReplyContext(base,{context:65536,maxTokens:2048,safetyTokens:256,soundDesign:false,selectedTriggers:[],narration:true,tokenCount:'exact',interaction,checkpointPrefix:buildFixedReplyPrompt(base,interaction)},async messages=>{observed.push(messages);return count(messages);});
  assert.equal(budgets.length,6);assert.ok(observed.length>=6);
  assert.ok(observed.every(messages=>messages[0].role==='system'&&occurrences(messages[0].content)===1));
  for(const budget of budgets)assert.ok(budget.inputTokens+budget.maxTokens+256<=65536);
 }
});

test('generated event speech always retains language freedom, character and output contracts',()=>{
 const event=createReferenceProgram(120000).events.find(event=>event.speech.mode==='narrate')!;
 const original={event,payloadId:'language-fixture',allowedTriggers:[],persona:'A blunt, witty companion.'};
 const legacy=EventSpeechRequestSchema.parse(original);
 assert.equal(legacy.rawRoleplay,false);assert.equal(legacy.nsfw,false);
 assert.equal(occurrences(eventNarrationMessages(legacy,'Speak a short passage.')[0].content),1);
 for(const style of [{},{nsfw:false,rawRoleplay:false},{nsfw:true},{rawRoleplay:true}]){
  const request=EventSpeechRequestSchema.parse({...original,...style});
  const messages=eventNarrationMessages(request,'Speak a short passage.');
  assert.equal(occurrences(messages[0].content),1);
  assert.ok(messages[0].content.startsWith(buildCharacterDocument(request).core));
  assert.match(messages[0].content,/EVENT OUTPUT CONTRACT/);
  assert.equal(messages[1].content,'Speak a short passage.');
 }
});

async function readBody(request:IncomingMessage){
 const parts:Buffer[]=[];for await(const part of request)parts.push(Buffer.from(part));
 return JSON.parse(Buffer.concat(parts).toString());
}

test('local backend payloads, streamed display and TTS preserve profanity without model downloads',async()=>{
 const payloads:{path:string;body:any}[]=[];
 const server=createServer(async(req,res)=>{
  const body=await readBody(req);payloads.push({path:req.url!,body});
  if(req.url==='/api/chat')res.end(JSON.stringify({message:{content:response},done:true})+'\n');
  else if(req.url==='/v1/chat/completions')res.end('data: '+JSON.stringify({choices:[{delta:{content:response}}]})+'\n\ndata: [DONE]\n\n');
  else if(req.url==='/dev/captioned_speech')res.end(JSON.stringify({audio:'AA==',text:body.input,timestamps:[]})+'\n');
  else{res.statusCode=404;res.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  const base=buildCharacterDocument(ChatRequestSchema.parse({type:'chat',text:input,promptId:'custom'})).core;
  const system=buildReplyPrompt(base,input,false,'',undefined,'',true,false,'reactive','',false,'general');
  const messages:Message[]=[{role:'system',content:system},{role:'user',content:input}];
  for(const backend of [new OllamaBackend(url),new LlamaBackend(url)]){
   let generated='';for await(const chunk of backend.stream(messages,'local-fixture',new AbortController().signal,4096,64))generated+=chunk.text;
   assert.equal(generated,response);
   assert.deepEqual(payloads.at(-1)!.body.messages,messages);
  }
  const dialogue=new DialogueDisplayStream(),actions=new ActionStream(),display=new ScriptDisplayStream();
  let visible='';
  for(const char of response)visible+=display.push(actions.push(dialogue.push(char)).display);
  visible+=display.push(actions.push(dialogue.flush()).display)+display.flush();
  assert.equal(visible,response);assert.equal(visibleDialogueText(response),response);
  assert.equal(normalizeScript(response),response);assert.equal(scriptUnits(response).map(unit=>unit.text).join(' '),response);
  const spoken=[];for await(const chunk of new Kokoro(url).speak(response,'af_heart',1,new AbortController().signal))spoken.push(chunk.text);
  assert.equal(payloads.at(-1)!.path,'/dev/captioned_speech');assert.equal(payloads.at(-1)!.body.input,response);
  assert.equal(spoken.join(' '),response);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
