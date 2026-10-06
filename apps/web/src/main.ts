// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {SessionEvents} from './session-events';
import {TriggerPresentation} from './trigger-presentation';
import {CueTimeline} from './cue-timeline';
import {initPlayerComposer} from './player-composer';
import {SessionDuration} from './session-duration';
import './trigger-presentation.css';
import {pinkWordOffsets} from '../../../packages/visuals/spoken-cues';
import {BambiCloudTrackSchema,BambiCloudCuePlayback,parseBambiCloudCues,bambiCloudTrackId,playlistIdFromUrl,type BambiCloudTrack,type BambiCloudPlaylist} from '../../../packages/media/bambicloud';
import './session-events.css';
import {ProgramSchema,type BambiProgram} from '../../../packages/session-director/events/contract';
import {sessionPhases} from '../../../packages/session-director/phases';
import {SpeechTurns} from '../../../packages/speech/turn';
import {PresentationGovernor} from '../../../packages/hardware/governor';
import {buildChatRequest, modelConnection} from '../../../packages/ai/request';
import {ReplyGate} from '../../../packages/ai/reply-gate';
import {resolveReplyIntent} from '../../../packages/ai/intent';
import {initMemoryPanel} from './memory';
import {modelContext} from '../../../packages/ai/models';
import './style.css';
import './navigation.css';
import './microphone.css';
import './trigger-timing.css';
import {initTriggerTiming,currentTriggerTiming} from './trigger-timing';
import {triggersForPhase} from '../../../packages/session-director/trigger-timing';
import type {SessionPhase} from '../../../packages/session-director/phases';
import {renderMicrophoneButton,type MicrophoneState,microphoneStatus} from './microphone-button';
import {migrateVisualPreferences} from '../../../packages/visuals/preferences';
import {initNavigation} from './navigation';
import {initSessionControls} from './session-controls';
import {SessionLibrary} from './library';
import './library.css';
import './player.css';
import {ConcurrentInput,type PendingInput} from './concurrent-input';
import {isStopRequest} from '../../../packages/ai/listening';
import {isContinuationRequest,isSessionNarration,replyTokenBudget} from '../../../packages/ai/response';
import {CompanionPreparation} from './preparation';
import {initDeviceControls,devicePreferenceIds,deviceBooleanPreferenceIds} from './devices';
import { initContent, syncContent, selectedTriggers, brainwaveSelection, highlightTriggers, triggerFlash, triggerCue, ambientDirective, matchingTrigger } from './content';
import { modelLabel, modelForPerformance, nativeSamplingModels } from '../../../packages/ai/models';
import { choreographyAt, immersiveChoreographyAt, deliveryPresentation, mergePresentation, timelinePresentationAt, type VisualPresentation } from '../../../packages/visuals/choreography';
import { spiralStyleName, type SpiralStyle } from '../../../packages/visuals/immersive';
import { sessionPhaseAt } from '../../../packages/session-director/phases';
import { parseTimelineJSON } from '../../../packages/timeline/import';
import { snapshotSession } from '../../../packages/ai/session-state';
import { SpeechPlayback } from '../../../packages/speech/playback';
import { Microphone } from '../../../packages/speech/capture';
import {StreamingSpeech} from '../../../packages/speech/streaming/client';
import type { AudioPreset } from '../../../packages/audio/preset';
import { AudioEngine, type Bus } from '../../../packages/audio';
import { VisualEngine, type Scene } from '../../../packages/visuals';
import { TimelineScheduler, presentationEventLateness, type TimelineEvent } from '../../../packages/timeline';
import { RuntimeLoop } from '../../../packages/timeline/runtime-loop';
import { deliveryModes, deliveryProfiles, type DeliveryMode } from '../../../packages/session-director/delivery';
import { NarrationFlow, narrationDirective, narrationPauses } from '../../../packages/session-director/narration';
import { AmbientAgent } from '../../../packages/session-director/ambient';
import { SessionDirector, type Curve } from '../../../packages/session-director';
import { sceneNames, ActionSchema } from '../../../packages/safety/actions';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const value=(id:string)=>$<HTMLInputElement>(id).value;
const checked=(id:string)=>$<HTMLInputElement>(id).checked;
const contentReady=initContent().catch(e=>notice('Could not load content: '+String(e)));
let audio:AudioEngine|null=null;const clock=new TimelineScheduler(()=>audio?audio.context.currentTime:performance.now()/1000,presentationEventLateness);const playbackClock=new TimelineScheduler(()=>audio?audio.outputTime:performance.now()/1000,presentationEventLateness);const director=new SessionDirector(clock);const ambientAgent=new AmbientAgent();const narrationFlow=new NarrationFlow();let narrationActive=false,narrationHasSpoken=false,replyFailed=false;let replyNarrationPhase:SessionPhase|null=null;let replyDelivery:DeliveryMode|undefined;let heardDelivery:DeliveryMode|undefined;let agentBusy=false;let lastSessionTrigger:string|null=null;
let visuals:VisualEngine|null=null;try{visuals=new VisualEngine($<HTMLCanvasElement>('visual'),$('stage'));}catch(e){notice(String(e));}
const triggerPresentation=new TriggerPresentation($('stage'));
let importedEventProgram:BambiProgram|undefined;
const sessionEvents=new SessionEvents($('stage'),$<HTMLCanvasElement>('visual'),{
 audio:()=>ensureAudio(),visuals:()=>visuals,
 settings:()=>({model:value('model'),voice:voiceName(),speed:Math.min(1.5,Math.max(.5,Number(value('speed')))),preset:value('audio-preset') as 'bambi_local_clean',sampling:value('sampling-profile')==='creative'?'creative':'qwen',context:modelContext(value('model'),value('prompt-template')),persona:value('persona'),username:value('bambi-name'),allowedTriggers:[...new Set([...selectedTriggers(),...sessionPhases.flatMap(phase=>checked('triggers-enabled')&&currentTriggerTiming().enabled?[...triggersForPhase(phase,0,currentTriggerTiming()),...triggersForPhase(phase,100,currentTriggerTiming())]:[])])]}),
  notice,narration:text=>{eventReply=addMessage('assistant',text);eventReply.dataset.displayText='';},displayNarration:text=>{if(eventReply&&eventReply.dataset.displayText!==text)eventReply.dataset.displayText=text;},clearSpeech:()=>interrupt(true,true,false,true),clearDevices:()=>deviceControls.clear(),pink:()=>visuals?.pinkPulse(playbackClock.time),
 cue:phrase=>{lastSessionTrigger=phrase;triggerFlash(phrase,false);},allowVisuals:()=>checked('visuals-enabled'),paused:()=>director.paused,
 triggers:()=>(phase,progress)=>checked('triggers-enabled')?currentTriggerTiming().enabled?triggersForPhase(phase,progress,currentTriggerTiming()):selectedTriggers():[],
 haptics:()=>checked('event-haptics'),allowSpeech:()=>checked('narration-enabled')&&!['off','text'].includes(value('ai-mode')),allowTriggers:()=>checked('triggers-enabled'),allowTriggerSound:()=>!filePlayback()&&checked('trigger-sound'),
 restore:()=>{if(visuals){visuals.fixation=value('visual-fixation') as 'none'|'dot'|'heart';visuals.voiceSync=checked('visual-voice-sync');visuals.tickSync=checked('visual-tick-sync');visuals.motion=Number(value('motion'));visuals.density=Number(value('density'));}syncTriggerSettings();},
});
const replyGate=new ReplyGate();let transportEpoch=0;
let ws:WebSocket|null=null,jobId='',reply:HTMLElement|null=null,decoding=Promise.resolve(),generation=0;let warming=false,warmController:AbortController|null=null;let lastPointer=performance.now(),esc=0,lastHealth=0,hudVisible=false,sessionId='',activeCaptionEnd=0,activeCaptionStart=0,mediaCaptionText='',voiceCaptionText='',voiceCaptionEnd=0,activeWordStart=0,activeWordEnd=0,activeWordText='',lastProfileSave=0,health:any={};let speechEndTime=0;let sttController:AbortController|null=null;
let eventReply:HTMLElement|null=null;
let microphoneEnabled=false,microphoneStarting=false,microphoneEpoch=0;let dialogueActive=false,replyDialogue=false;let pendingTurns=0;let lastPhase:string|null=null;const speechPlayback=new SpeechPlayback();
let transcriptionChain=Promise.resolve(),queuedTranscriptions=0;
let sentenceEnds:Promise<void>[]=[],sentenceBoundary=true,sentenceProtocol=false,playedReplyText='',lastQuestion='';
let replyExpectsAnswer:boolean|null=null;
const interaction=()=>value('conversation-style')==='situational'?'situational' as const:'reactive' as const;
let adapting=false;
const inputMessages=new Map<string,{node:HTMLElement;source:'speech'|'text'}>();
function cancelInputMessages(source?:'speech'|'text'){for(const [id,item] of inputMessages){if(!source||item.source===source){item.node.textContent='Cancelled';inputMessages.delete(id);}}}
function listenAndAdapt(){return value('conversation-policy')==='adapt';}
function updateListeningStatus(text:string){$('listening-status').textContent=text;if(!text)playerComposer.clearHearing();}
function showRecognizedSpeech(text:string){if(text.trim())playerComposer.hearing(text.trim());}
const concurrentInput=new ConcurrentInput(async(item,signal)=>{
 const response=await fetch('/api/listen',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({text:item.text,heard:(playedReplyText+' '+speechPlayback.spoken(playbackClock.time)).slice(-6000),draft:(reply?.textContent??'').slice(-6000),question:lastQuestion.slice(-4000),model:value('model'),...modelConnection(value('model'),value('prompt-template'),health.modelConnections)})});
 const decision=await response.json();if(!response.ok)throw Error(decision.error||'Could not consider your input.');
 if(!['continue','adapt'].includes(decision.action))throw Error('Invalid listening decision');return decision.action;
},item=>{
 send({type:'feedback-consumed',inputId:item.id,replyId:jobId,text:item.text});
 markInput(item,'No separate reply needed');updateListeningStatus('Input received. Bambi is continuing.');
},()=>void flushConcurrentInput(),()=>{notice('Your input was received. Bambi will address it after the current sentence.');});
function markInput(item:PendingInput,text:string){const entry=inputMessages.get(item.id);if(entry){entry.node.textContent=text;inputMessages.delete(item.id);}}
function queueConcurrentInput(text:string,source:'speech'|'text'){
 try{const id=concurrentInput.enqueue(text,source);const p=addMessage('user',text);highlightTriggers(p);const status=document.createElement('span');status.textContent='Received';p.parentElement!.append(status);inputMessages.set(id,{node:status,source});updateListeningStatus('Input received. Considering the next part.');}
 catch(error){notice(String(error));}
}
async function flushConcurrentInput(){
 if(adapting||!sentenceBoundary||concurrentInput.deciding||director.paused||mic.recording||streamingSpeech.pending||sttController||queuedTranscriptions)return;
 const batch=concurrentInput.takeAdaptation();if(!batch.length)return;
 adapting=true;for(const item of batch)markInput(item,'Used in the next part');
 try{await ask(batch.map(item=>item.text).join('\n'),false,undefined,true,true);}
 finally{adapting=false;}
}
let lastSttMs=0;let lastReplyIntent:'conversation'|'narration'='conversation';
const speechTurns=new SpeechTurns(speech=>{speechEndTime=speech.endedAt;void ask(speech.text,false,microphoneEpoch).catch(error=>notice(String(error)));});
const presentationGovernor=new PresentationGovernor();let previousFrameAt=0;
const streamingSpeech=new StreamingSpeech({
 partial:(text,epoch)=>{if(microphoneEnabled&&epoch===microphoneEpoch){updateListeningStatus(text?'Hearing: '+text:'Listening …');showRecognizedSpeech(text);}},
 final:(text,endedAt,latencyMs,epoch)=>{if(!microphoneEnabled||epoch!==microphoneEpoch)return;lastSttMs=latencyMs;updateListeningStatus('');if(text.trim()){showRecognizedSpeech(text);speechTurns.receive(text.trim(),endedAt,checked('mic-smart-turns'));}else{speechTurns.flush();notice('No speech detected. Check your microphone level.');}},
 changed:()=>{syncMicrophoneButtons();void flushConcurrentInput();finishDialogue();},
 failed:error=>notice(String(error)),
});
function queueTranscription(wav:Blob,speechEndAt:number,epoch:number){
 if(!microphoneEnabled)return;
 if(epoch!==microphoneEpoch)return;
 if(queuedTranscriptions>=8){notice('Speech recognition has several inputs queued. Please wait a moment.');return;}
 queuedTranscriptions++;
 transcriptionChain=transcriptionChain.catch(()=>{}).then(async()=>{
  if(epoch!==microphoneEpoch||!microphoneEnabled)return;
  const controller=new AbortController();speechEndTime=speechEndAt;sttController=controller;
  try{
   $('ai-status').textContent='Listening to your words …';
   let response:Response|undefined;
   for(let attempt=0;attempt<3;attempt++){
    response=await fetch('/api/transcribe',{method:'POST',body:wav,signal:controller.signal});
    if(response.status!==429)break;
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,400*(attempt+1));controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));},{once:true});});
   }
   const data=await response!.json();if(!response!.ok)throw Error(data.error||'Whisper unavailable');
   lastSttMs=data.latencyMs??0;if(!controller.signal.aborted&&epoch===microphoneEpoch&&microphoneEnabled&&data.text?.trim()){showRecognizedSpeech(data.text);speechTurns.receive(data.text.trim(),speechEndAt,checked('mic-smart-turns'));}
   else if(!controller.signal.aborted&&epoch===microphoneEpoch&&microphoneEnabled){speechTurns.flush();notice('No speech detected. Check your microphone level or increase sensitivity.');}
  }catch(error){if(!controller.signal.aborted&&epoch===microphoneEpoch){speechTurns.flush();notice(String(error));}}
  finally{if(sttController===controller)sttController=null;syncMicrophoneButtons();}
 }).finally(()=>{queuedTranscriptions=Math.max(0,queuedTranscriptions-1);void flushConcurrentInput();finishDialogue();});

}
const mic=new Microphone(()=>{speechTurns.resume();if(microphoneEnabled){
 if(!listenAndAdapt()){const resumedPhrase=speechTurns.waiting;microphoneEpoch++;sttController?.abort();sttController=null;if(beginDialogue())interrupt(true,director.active,resumedPhrase);}
 $('ai-status').textContent='Bambi is listening …';
}},(wav,speechEndAt)=>{
 const epoch=microphoneEpoch;
 if(!streamingSpeech.finish(speechEndAt,epoch,()=>queueTranscription(wav,speechEndAt,epoch)))queueTranscription(wav,speechEndAt,epoch);
},()=>{syncMicrophoneButtons();void flushConcurrentInput();if(dialogueActive&&!mic.recording&&!sttController&&!agentBusy&&!voiceQueue)finishDialogue();},()=>!!audio?.foregroundOutputActive()||(!media.paused&&!media.ended&&!media.muted&&media.volume>0&&!audio?.muted&&(audio?.levels.SESSION??0)>0&&(audio?.levels.MASTER??0)>0),error=>{microphoneEnabled=false;microphoneStarting=false;microphoneEpoch++;streamingSpeech.reset();sttController?.abort();sttController=null;concurrentInput.clear('speech');cancelInputMessages('speech');syncMicrophoneButtons();finishDialogue();notice('Speech detection: '+String(error));streamingSpeech.close();},event=>{if(event.type==='frame')streamingSpeech.frame(event.pcm);else if(event.type==='start')streamingSpeech.begin(microphoneEpoch);else streamingSpeech.reset();});
let promptContextReady:Promise<unknown>=Promise.resolve();
let preparationTimer=0,preparationAllowed=true;let desktopCapabilities:any=null;
const companionPreparation=new CompanionPreparation(async(settings,signal)=>{
 const response=await fetch('/api/warm',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify(settings)});
 const info=await response.json();if(!response.ok)throw Error(info.error||'Bambi could not get ready.');
});
function companionEnabled(){return value('ai-mode')!=='off'&&!['local','official'].includes(value('mode'));}
function companionSettings(){
 return {interaction:interaction(),narration:narrationEnabled()&&!eventProgramEnabled(),maxTokens:replyTokenBudget(Number(value('response-length')),value('performance')==='latency',narrationEnabled()),sampling:value('sampling-profile'),model:value('model'),voice:voiceName(),speed:Number(value('speed')),preset:value('audio-preset'),speak:['voice','interactive','ambient'].includes(value('ai-mode')),context:modelConnection(value('model'),value('prompt-template'),health.modelConnections).context,promptId:value('prompt-template') as 'bambisleep-classic'|'gentle-induction'|'custom',username:value('bambi-name'),selectedTriggers:selectedTriggers(),collar:checked('collar-enabled'),collarName:value('collar-name'),persona:value('persona'),dualVoice:checked('dual-voice'),soundDesign:checked('sound-design')||checked('tick-enabled')};
}
function prepareCompanion(){
 if(!companionEnabled())return Promise.resolve();
 return companionPreparation.prepare(companionSettings());
}
function queueCompanionPreparation(){
 const tokens=modelConnection(value('model'),value('prompt-template'),health.modelConnections).context;
 $('model-context-status').textContent=`${tokens.toLocaleString('en-US')} tokens for the full selected prompt, conversation and reply. Preparation checks the budget before speaking.`;
 clearTimeout(preparationTimer);
 if(!companionEnabled()){companionPreparation.cancel();return;}
 if(!preparationAllowed||director.active||warming||agentBusy||companionPreparation.hasFailed(companionSettings()))return;
 preparationTimer=window.setTimeout(()=>{void prepareCompanion().catch(error=>{if(error?.name!=='AbortError')notice('AI preparation: '+String(error));});},300);
}
const backgroundPreferenceIds=['background-drone','background-drone-db','background-noise','background-noise-db','background-noise-type'];
let backgroundControlsInitialized=false;
let savedBackground:Record<string,unknown>={};
const sessionDuration=new SessionDuration($<HTMLSelectElement>('duration'));
let ttft=0,tokensPerSecond=0,voiceQueue=0,lastVoiceMs=0;const media=$<HTMLVideoElement>('media');let selected=-1;let mediaUrl:string|null=null;
const cueTimeline=new CueTimeline($('seek-timeline'),$<HTMLInputElement>('seek'),$<HTMLCanvasElement>('seek-cue-lines'),$('seek-cue-preview'),$<HTMLInputElement>('player-cue-markers'),()=>media.duration);
interface Track extends TrackMetadata{file?:File;timeline?:TimelineEvent[];timelineSource?:string}
interface TrackMetadata{id:string;favorite:boolean;notes:string;tags:string;plays:number;lastPlayed:string;remote?:BambiCloudTrack}
const libraryMetadata=new Map<string,TrackMetadata>();
const tracks:Track[]=[];let importedTimeline:TimelineEvent[]=[];let timelineSource:string|null=null;let timelineDuration=0;let presentationEvents:TimelineEvent[]=[];let manualPresentation:VisualPresentation={scene:'Spiral Focus',opacity:1,spiral:{style:'tunnel',depth:.8,speed:.45,complexity:1,alpha:1,colorA:'#c700c7',colorB:'#ff82ff',mode:'classic'}};let timelineBase=manualPresentation;let mediaStartedAt=0;let silencedUntil=0;let visualFx:{start:number;end:number;level:number}|null=null;
function notice(text:string){$('notice').textContent=text;$('notice').classList.toggle('hidden',!text);$('immersive-notice').textContent=text;$('immersive-notice').classList.toggle('hidden',!text||text.startsWith('Microphone on.'));}
function status(text:string){$('start-status').textContent=text;}
function syncTriggerSettings(){audio?.configureVoiceEchoes(!sessionEvents.active&&!filePlayback()&&checked('voice-echoes'));if(!checked('sound-design'))visuals?.clearDescent();audio?.configureSoundDesign({enabled:!sessionEvents.active&&!filePlayback()&&checked('sound-design'),defaults:!sessionEvents.active&&!filePlayback()&&checked('sound-defaults'),bassFallback:checked('sound-bass-fallback')});audio?.configureTick(!sessionEvents.active&&!filePlayback()&&checked('tick-enabled'),!sessionEvents.active&&!filePlayback()&&checked('tick-defaults'),checked('tick-dives'));audio?.setScriptSoundsEnabled(!filePlayback()&&checked('trigger-sound'));if(filePlayback()||!checked('trigger-sound'))audio?.stopEffects(false);audio?.configureTriggerSequence({snap:checked('trigger-snap'),moan:checked('trigger-moan'),effects:checked('trigger-extra-effects'),wiperSeconds:Number(value('trigger-wiper-seconds')),bubbleInflate:checked('trigger-bubble-inflate'),bubbleSqueak:checked('trigger-bubble-squeak'),bubbleGapMs:Number(value('trigger-bubble-gap'))*1000,effectPauseMs:Number(value('trigger-effect-pause'))*1000,plainPauseMs:Number(value('trigger-plain-pause'))*1000},{pop:value('trigger-pop-variant'),wiper:value('trigger-wiper-variant'),moan:value('trigger-moan-variant')});for(const kind of ['snap','moan','wiper','pop','bell','inflate','squeak','tick'] as const){const db=Number(value('trigger-'+kind+'-db'));$('trigger-'+kind+'-db-label').textContent=(db>0?'+':'')+db+' dB';audio?.setSoundGain(kind,db);}}
function ensureAudio(){if(!audio){audio=new AudioEngine();audio.onBreath=event=>{if(checked('breath-visuals'))visuals?.startBreath(event.cue,event.time);};audio.breathSoundEnabled=!filePlayback()&&checked('breath-sound');audio.onDesignSound=event=>{if(event.name==='descent'&&(event.reason!=='phase'||checked('phase-visuals')&&!presentationEvents.length))visuals?.startDescent(event.time,event.duration);};audio.attach(media);for(const [id,bus] of Object.entries({'master':'MASTER','bus-session':'SESSION','bus-voice':'AI_VOICE','bus-ambient':'AMBIENCE','bus-effects':'EFFECTS'}))audio.set(bus as Bus,Number(value(id)));}playbackClock.start();deviceControls.bindAudio();syncTriggerSettings();return audio;}
function send(data:unknown){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function narrationEnabled(){return !sessionEvents.active&&checked('narration-enabled')&&!['off','text'].includes(value('ai-mode'))&&['conversation','hybrid'].includes(value('mode'));}
function narrationPause(){const phase=sessionPhaseAt(clock.time,director.duration).phase;const input=value('narration-pause-'+phase);const seconds=input.trim()?Number(input):narrationPauses[phase];const base=Number.isFinite(seconds)?Math.min(30,Math.max(0,seconds)):narrationPauses[phase];return heardDelivery&&checked('adaptive-delivery')?Math.min(30,base*deliveryProfiles[heardDelivery].pauseMultiplier):base;}
function narrationReady(){return director.duration-clock.time>=8&&!speechTurns.waiting&& director.active&&clock.running&&!warming&&ws?.readyState===WebSocket.OPEN&&!agentBusy&&!voiceQueue&&!dialogueActive&&!pendingTurns&&!concurrentInput.pending&&!queuedTranscriptions&&!mic.recording&&!mic.speechPending&&!streamingSpeech.pending&&!sttController&&!value('chat-input').trim()&&clock.time>=silencedUntil;}
function completeNarration(){
 if(agentBusy||voiceQueue||replyFailed||!narrationEnabled())return;
 const text=(reply?.textContent??'').replace(/\[[^\]]*\]/g,'').trim();
 narrationFlow.completed(clock.time,narrationPause(),replyNarrationPhase==='awakening'||(replyExpectsAnswer??/[?？]["”']?$/.test(text)));
}
function syncNarration(){
 const enabled=narrationEnabled();
 if(enabled!==narrationActive){narrationActive=enabled;narrationFlow.cancel();if(enabled&&director.active){narrationHasSpoken=false;if(agentBusy||voiceQueue)narrationFlow.turnStarted();else narrationFlow.defer(clock.time,narrationPause());}}
}
function connect(){
 if(ws&&ws.readyState!==WebSocket.CLOSED)return;
 let requiresRestart=false;ws=new WebSocket(`ws://${location.host}/ws`);
 ws.onopen=()=>{$('connection').textContent='Connected locally';notice('');};
 ws.onclose=()=>{transportEpoch++;deviceControls.disconnected();$('connection').textContent='Connection lost';interrupt(false);finishDialogue();notice(requiresRestart?'Restart Bambi Local to use the updated chat protocol.':'Server disconnected. Your local media is still available.');};
 ws.onmessage=e=>{
  const data=JSON.parse(e.data);if(!replyGate.accepts(data))return;if(data.type==='connected'&&(data.protocolVersion!==1||data.replyCorrelation!==true)){requiresRestart=true;notice('Restart Bambi Local to use the updated chat protocol.');ws?.close();return;}if(data.type==='health'){health=data.data;return;}if(deviceControls.message(data))return;
  if(data.type==='panic'){hardStop(false);return;}
  // Local cancellation already cleared playback. A late acknowledgment must
  // never cancel the replacement turn or release its session hold.
  if(data.type==='interrupted'){interrupt(false);finishDialogue();return;}
  if(data.type==='begin'){replyDelivery=deliveryModes.includes(data.configuration?.delivery)?data.configuration.delivery:undefined;replyExpectsAnswer=null;lastReplyIntent=data.configuration?.intent==='narration'?'narration':'conversation';sentenceEnds=[];sentenceBoundary=true;sentenceProtocol=false;playedReplyText='';agentBusy=true;jobId=data.id;replyDialogue=data.dialogue??replyDialogue;reply=addMessage('assistant','');if(!['text','off'].includes(value('ai-mode'))){reply.dataset.displayText='';reply.dataset.playback='true';}$('ai-status').textContent='Bambi is replying …';return;}
  if(data.type==='token'&&data.id===jobId&&reply){reply.textContent+=data.text;$('messages').scrollTop=$('messages').scrollHeight;return;}
  if(data.type==='done'&&data.id===jobId){replyExpectsAnswer=typeof data.expectsReply==='boolean'?data.expectsReply:null;if(data.audioComplete===false)replyFailed=true;agentBusy=false;if(reply){highlightTriggers(reply);if(value('ai-mode')==='text'&&!replyDialogue)triggerFlash(reply.textContent||'');}$('ai-status').textContent=voiceQueue?'Bambi is speaking …':replyExpectsAnswer?'Bambi is waiting for your answer …':'Your Bambi companion';if(!voiceQueue)sentenceBoundary=true;void flushConcurrentInput();finishDialogue();completeNarration();return;}
  if(data.type==='error'||data.type==='notice'){if(data.type==='error'){replyFailed=true;narrationFlow.cancel();agentBusy=false;finishDialogue();}notice(data.text);$('ai-status').textContent='Your Bambi companion';return;}
  if(data.type==='metric'&&data.name==='ttft')ttft=data.value;
  if(data.type==='stats')tokensPerSecond=data.data.eval_count/(data.data.eval_duration/1e9);
  if(data.type==='action'){if(sessionEvents.active)return;const result=ActionSchema.safeParse(data.action);if(result.success)director.approve(result.data);}
  if(data.type==='sentence-end'&&data.id===jobId){
   const epoch=generation,ends=sentenceEnds;
   decoding=decoding.then(async()=>{if(epoch!==generation)return;await Promise.all(ends.splice(0));if(epoch!==generation)return;sentenceBoundary=true;await flushConcurrentInput();}).catch(error=>notice(String(error)));
   return;
  }
  if(data.type!=='audio'||data.id!==jobId)return;
  const epoch=generation,queuedAt=performance.now(),conversation=replyDialogue;voiceQueue++;if(Number.isInteger(data.sentenceId))sentenceProtocol=true;let completed=false;let resolveEnded:()=>void=()=>{};const ended=new Promise<void>(resolve=>resolveEnded=resolve);
  const complete=(played:boolean)=>{
   if(completed)return;completed=true;resolveEnded();if(epoch===generation){voiceQueue=Math.max(0,voiceQueue-1);if(played){playedReplyText=(playedReplyText+' '+(data.text??'')).trim();speechPlayback.complete(data.seq);}}
   send({type:'ack',id:data.id,seq:data.seq,played:played&&epoch===generation});
   if(epoch===generation&&!voiceQueue){$('ai-status').textContent='Your Bambi companion';if(!sentenceProtocol){sentenceBoundary=true;void flushConcurrentInput();}finishDialogue();completeNarration();}
  };
  decoding=decoding.then(async()=>{
   if(epoch!==generation||sessionEvents.reservedBlank){complete(false);return;}
   sentenceBoundary=false;sentenceEnds.push(ended);const engine=ensureAudio();
   if(data.control){if(conversation){complete(true);return;}await engine.playScriptCues(data.cues_before??[],()=>complete(true),data.ticks??[]);return;}
   const bytes=Uint8Array.from(atob(data.audio),(c:string)=>c.charCodeAt(0)).buffer;
   await engine.playVoice(bytes,(start,duration,wordTime)=>{
    if(epoch!==generation)return;
    const base=playbackClock.time+start-engine.outputTime;
    speechPlayback.schedule(data.seq,data.text??'',base,data.spoken_seconds??duration,data.timestamps??[]);
    playbackClock.schedule({id:`${data.id}-${data.seq}-sentence`,time:base,type:'voice-caption',duration:data.spoken_seconds??duration,data:{text:data.text}});
    for(const [i,word] of (data.timestamps||[]).entries())playbackClock.schedule({id:`${data.id}-${data.seq}-${i}`,time:base+word.start_time,type:'word',duration:word.end_time-word.start_time,data:{text:word.word}});
    for(const [i,atMs] of pinkWordOffsets((data.timestamps??[]).map((w:any)=>({word:w.word,atMs:w.start_time*1000})),(data.spoken_seconds??duration)*1000).entries())playbackClock.schedule({id:`${data.id}-${data.seq}-pink-${i}`,time:base+atMs/1000,type:'spoken-pink'});
    if(data.trigger)scheduleSpokenTrigger(data.trigger,base+wordTime-start,`${data.id}-${data.seq}-trigger`);
    playbackClock.schedule({id:`${data.id}-${data.seq}-voice-start`,time:base,type:'voice-start',data:{requestId:data.id,seq:data.seq,queuedAt,delivery:replyDelivery}});
    lastVoiceMs=performance.now()-queuedAt;$('ai-status').textContent='Bambi is speaking …';
   },()=>complete(true),data.trigger?spokenTriggerOptions(data):undefined,
   conversation?{voiceTrack:data.voice_track,phase:sessionPhaseAt(clock.time,director.duration).phase,spokenSeconds:data.spoken_seconds,text:data.text,conversation:true,breath:data.breath,wordStart:data.timestamps?.[0]?.start_time,words:(data.timestamps??[]).map((w:any)=>({word:w.word,atMs:w.start_time*1000}))}:{voiceTrack:data.voice_track,breath:data.breath,before:data.cues_before,after:data.cues_after,spokenSeconds:data.spoken_seconds,sounds:data.sounds,ticks:data.ticks,devicesAtWord:data.devices_at_word,text:data.text,phase:sessionPhaseAt(clock.time,director.duration).phase,wordStart:data.timestamps?.[0]?.start_time,words:(data.timestamps??[]).map((w:any)=>({word:w.word,atMs:w.start_time*1000}))});
  }).catch(e=>{if(epoch===generation){replyFailed=true;narrationFlow.cancel();notice(`Could not play audio: ${e}`);}complete(false);});
 };
}
function addMessage(role:'assistant'|'user',text:string){const item=document.createElement('div');item.className='message '+role;const p=document.createElement('p');p.textContent=text;item.append(p);$('messages').append(item);playerComposer.clearHearing();while($('messages').children.length>40)$('messages').firstElementChild?.remove();$('messages').scrollTop=$('messages').scrollHeight;return p;}
function interrupt(remote=true,preserveSession=director.active,preserveInput=false,preserveTriggerEye=false){replyDelivery=undefined;heardDelivery=undefined;replyExpectsAnswer=null;triggerPresentation.clear();const requestId=replyGate.requestId;replyGate.cancel();if(!preserveInput)speechTurns.clear();narrationFlow.cancel();if(!preserveInput){concurrentInput.clear();updateListeningStatus('');cancelInputMessages();}if(reply?.dataset.playback==='true'){reply.dataset.displayText=speechPlayback.revealed(playbackClock.time);reply.dataset.playback='false';}if(reply&&jobId&&voiceQueue)reply.textContent=(playedReplyText+' '+speechPlayback.spoken(playbackClock.time)).trim();sentenceBoundary=true;sentenceEnds=[];if(!preserveSession)deviceControls.clear();const playback={id:jobId,chunks:speechPlayback.progress(playbackClock.time)};if(remote){send({type:'interrupt',requestId,playback,preserveSession});if(jobId&&reply?.parentElement){reply.parentElement.dataset.interrupted='true';reply.parentElement.title='Bambi paused. Unspoken audio has been cleared.';}}speechPlayback.clear();agentBusy=false;generation++;jobId='';audio?.stopVoice(true,preserveSession);playbackClock.clear();visuals?.clearTrigger(preserveTriggerEye);visuals?.clearVoiceReaction();visuals?.clearDescent();visuals?.clearBreath();if(visuals)visuals.pulse=0;voiceCaptionText='';voiceCaptionEnd=0;activeWordText='';activeWordStart=0;activeWordEnd=0;$('caption').textContent='';$('word').textContent='';voiceQueue=0;decoding=Promise.resolve();$('ai-status').textContent='Your Bambi companion';}
function beginDialogue(){
 if(!director.active||director.paused)return false;
 // Keep the joint-started session running during typing, listening and replies.
 // Only the explicit Pause/Stop controls change the transport.
 if(!dialogueActive){sessionEvents.userTurn();dialogueActive=true;if(!listenAndAdapt())interrupt();}
 return true;
}
function finishDialogue(){
 if(pendingTurns||agentBusy||voiceQueue||concurrentInput.pending||queuedTranscriptions||mic.recording||streamingSpeech.pending||sttController||value('chat-input').trim())return;
 dialogueActive=false;
 if(director.interactive)director.endInteractive();
}
async function saveSession(state:string){if(!sessionId)return;const id=sessionId;sessionId='';try{await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,duration:clock.time,state,scene:visuals?.scene??value('scene')})});}catch{}}
/** Release live work for both a manual end and a naturally completed session. */
function releaseSession(remote=true){
 cueRequest?.abort();transportEpoch++;sessionEvents.stop();audio?.resetSoundDesignSession();deviceControls.stop();
 microphoneEnabled=false;microphoneStarting=false;microphoneEpoch++;streamingSpeech.close();mic.stop();
 sttController?.abort();sttController=null;warmController?.abort();warmController=null;sessionStartup=null;
 clearTimeout(preparationTimer);companionPreparation.cancel();preparationAllowed=false;warming=false;
 interrupt(remote,false);clock.pause();clock.clear();playbackClock.clear();
 dialogueActive=false;replyDialogue=false;lastPhase=null;mediaCaptionText='';activeCaptionEnd=0;silencedUntil=0;visualFx=null;
 media.pause();audio?.stop();visuals?.stop();syncMicrophoneButtons();
 $('stage').classList.remove('playing','trigger-flash');$('start').textContent='Begin another session';$('start').removeAttribute('disabled');
 if(document.fullscreenElement)void document.exitFullscreen();
}
function hardStop(remote=true){
 void saveSession('ABORTED');releaseSession(remote);director.abort();
 if(media.src)media.currentTime=0;
 $('stage-label').textContent='Session ended';status('Session ended. Audio, AI, microphone and devices stopped.');
 syncPlayButton();syncEndSessionControl();
 if(remote){if(ws?.readyState===WebSocket.OPEN)send({type:'panic'});else void fetch('/api/panic',{method:'POST'}).catch(()=>{});}
}
function scheduleImported(){presentationEvents=importedTimeline.filter(event=>event.type==='scene').map(event=>({...event,time:event.time+(event.relativeTo==='session'?0:mediaStartedAt)})).sort((a,b)=>a.time-b.time);clock.clearScope('media');const position=clock.time;for(const event of importedTimeline){const time=(event.relativeTo==='session'?0:mediaStartedAt)+event.time;if((director.active)&&time<position)continue;clock.schedule({...event,time,id:crypto.randomUUID(),scope:'media'});}restoreMediaCaption(position-mediaStartedAt);}
document.addEventListener('fullscreenchange',()=>{lastPointer=performance.now();visuals?.resize();});
function syncPresentation(){
 if(!visuals||visuals.backend==='unavailable'){$('choreography-status').textContent=checked('visuals-enabled')?'Visuals unavailable. Audio and captions are still available.':'Visuals off';return;}
 const active=director.active;
 const phase=sessionPhaseAt(active?clock.time:0,director.duration).phase;
 const automated=checked('phase-visuals')&&(active||checked('visual-journey'));
 const position=clock.time;
 const timeline=active&&presentationEvents.length>0;
 let presentation=timeline?timelinePresentationAt(presentationEvents,position,timelineBase):automated?(checked('visual-journey')?immersiveChoreographyAt:choreographyAt)(active?clock.time:0,director.duration,manualPresentation):manualPresentation;
 if(active&&automated&&checked('visual-journey')&&!timeline&&!sessionEvents.active&&!filePlayback()&&checked('adaptive-delivery')&&heardDelivery)presentation=deliveryPresentation(presentation,heardDelivery);
 visuals.scene=presentation.scene;visuals.opacity=presentation.opacity;visuals.stableSettings={...presentation.spiral};
 if(document.body.dataset.scene!==presentation.scene)document.body.dataset.scene=presentation.scene;
 if($('stage').dataset.phase!==phase)$('stage').dataset.phase=phase;
 setLiveText('choreography-status',`${!checked('visuals-enabled')?'Visuals off · ':''}${timeline?'Timeline':automated?'Phase: '+phase:checked('phase-visuals')?'Auto visuals ready':'Manual'} · ${presentation.scene}${presentation.scene==='Spiral Focus'?' · '+spiralStyleName(presentation.spiral.style):''}${visuals.backend==='canvas2d'?' · alternative renderer':''}`);
}
$('timeline-clear').onclick=()=>{importedTimeline=[];timelineSource=null;presentationEvents=[];if(selected>=0){tracks[selected].timeline=[];tracks[selected].timelineSource=undefined;}clock.clearScope('media');mediaCaptionText='';activeCaptionEnd=0;visualFx=null;visuals?.clearTrigger();syncPresentation();$('timeline-info').textContent='Timeline removed. Automatic phase visuals are available again.';$<HTMLInputElement>('timeline-file').value='';};
function restoreMediaCaption(position:number){const globalPosition=mediaStartedAt+position;const eventTime=(event:TimelineEvent)=>event.time+(event.relativeTo==='session'?0:mediaStartedAt);const event=importedTimeline.filter(e=>e.type==='caption'&&eventTime(e)<=globalPosition&&globalPosition<eventTime(e)+(e.duration||4)).at(-1);mediaCaptionText=event?(event.data as any).text:'';activeCaptionStart=event?eventTime(event):0;activeCaptionEnd=event?activeCaptionStart+(event.duration||4):0;}
let sessionStartup:Promise<void>|null=null;
async function startSession(fullscreen=false){
 preparationAllowed=true;
 if(visuals){visuals.enabled=checked('visuals-enabled');syncPresentation();}
 if(fullscreen)void immerse();await profileReady;
 if(sessionStartup){await sessionStartup;return;}
 if(director.active&&!director.paused)return;if(director.paused){await togglePause();return;}
 const startup=prepareSession();sessionStartup=startup;
 try{await startup;}finally{if(sessionStartup===startup)sessionStartup=null;}
}
async function prepareSession(){warming=true;const controller=new AbortController();warmController=controller;$('start').setAttribute('disabled','');status(finishedTrackPlayback()?'Preparing your original session…':value('model').startsWith('cloud:')?'Preparing your remote AI and sound … The first run can take a few minutes.':'Getting your voice, sound and Bambi ready …');try{const engine=ensureAudio();await engine.init();controller.signal.throwIfAborted();if(visuals){visuals.enabled=checked('visuals-enabled');visuals.scene=value('scene') as Scene;}mediaStartedAt=0;syncPlaylistDuration();director.intensity=Number(value('intensity'));director.curve=value('curve') as Curve;
 clearTimeout(preparationTimer);await prepareCompanion();controller.signal.throwIfAborted();if(finishedTrackPlayback()&&checked('bambicloud-cues'))await loadRemoteCues(controller.signal);controller.signal.throwIfAborted();
 if(eventProgramEnabled()){await sessionEvents.prepare(director.duration*1000,director.intensity/100,controller.signal,importedEventProgram);}else sessionEvents.stop();
 if(controller.signal.aborted)return;remoteCues.seek(0);engine.resetSoundDesignSession();director.ready();director.start();sessionEvents.start();syncTriggerSettings();deviceControls.sync();lastPhase=null;visualFx=null;triggerPresentation.clear();visuals?.clearTrigger();ambientAgent.reset();narrationHasSpoken=false;narrationFlow.cancel();if(narrationEnabled())narrationFlow.start(clock.time);lastSessionTrigger=null;mediaStartedAt=0;if(selected>=0&&media.src)media.currentTime=0;mediaCaptionText='';activeCaptionEnd=0;timelineBase=structuredClone(manualPresentation);scheduleImported();syncPresentation();sessionId=crypto.randomUUID();$('stage').classList.add('playing');$('stage-label').textContent='Your little Bambi moment';$('start').textContent='Session running';if(selected>=0&&value('mode')!=='conversation'){try{await media.play();}catch{notice('Unsupported file. Choose another file or open Bambi Chat.');}}if(controller.signal.aborted)return;syncAudioPreset();engine.ambience(!filePlayback()&&Number(value('bus-ambient'))>0);const preset=brainwaveSelection();engine.brainwave(!filePlayback()&&checked('brainwave-enabled'),preset?.carrier,preset?.beat,Number(value('brainwave-volume')));status(finishedTrackPlayback()?'Playing the original session. Space pauses; press Escape twice to stop everything.':'Ready, sweetie. Space pauses; press Escape twice to stop everything.');
 }catch(e){if(!controller.signal.aborted){notice(String(e));status('Could not get ready. Please try again.');}}finally{if(warmController===controller){warming=false;warmController=null;$('start').removeAttribute('disabled');}}}
async function immerse(){try{await $('stage').requestFullscreen();lastPointer=performance.now();}catch{notice('Fullscreen is unavailable here. Your session is still running.');}}
async function toggleFullscreen(){if(document.fullscreenElement)await document.exitFullscreen();else await immerse();}
async function togglePause(){if(warming)return;if(['IDLE','READY','ABORTED','FINISHED'].includes(director.state)){await startSession(false);return;}if(!audio)return;if(!director.paused){director.togglePause();sessionEvents.pause();deviceControls.sync();media.pause();await audio.context.suspend();}else{await audio.context.resume();director.togglePause();sessionEvents.resume();deviceControls.sync();if(!director.held&&selected>=0&&value('mode')!=='conversation')await media.play().catch(()=>{});}finishDialogue();syncPlayButton();$('stage-label').textContent=director.paused?'Paused':'Your little Bambi moment';}
function syncPlayButton(){
 const state=warming?'preparing':director.paused?'paused':director.active?'playing':'idle';
 const button=$<HTMLButtonElement>('pause');if(button.dataset.state===state)return;
 button.dataset.state=state;button.disabled=warming;
 $('play-icon').textContent=warming?'◌':state==='playing'?'Ⅱ':'▶';
 $('play-label').textContent=warming?'Preparing':state==='playing'?'Pause':state==='paused'?'Resume':'Start';
 button.setAttribute('aria-label',warming?'Preparing session':state==='playing'?'Pause session':state==='paused'?'Resume session':'Start session');
 button.setAttribute('aria-busy',String(warming));
}
function syncEndSessionControl(){
 // Plain file playback needs only Play/Pause. Live work and preparation must
 // always have a direct way to end, even with a muted microphone or on Pause.
 const visible=warming||microphoneEnabled||microphoneStarting||deviceControls.enabled||agentBusy||voiceQueue>0||pendingTurns>0||!!sttController||
  director.active&&(!filePlayback()||companionEnabled());
 const button=$<HTMLButtonElement>('panic');
 if(button.hidden===!visible)return;
 if(!visible&&document.activeElement===button)$('pause').focus({preventScroll:true});
 button.hidden=!visible;
}
function scheduleSpokenTrigger(trigger:string,time:number,id:string){playbackClock.schedule({id,time,type:'trigger-cue',data:{text:trigger,playSound:false,source:'speech'}});}
function spokenTriggerOptions(data:{trigger:string;spoken_seconds:number;pre_pause_ms?:number;post_pause_ms?:number;pause_ms?:number}){
 return {trigger:data.trigger,spokenSeconds:data.spoken_seconds,prePauseMs:data.pre_pause_ms,postPauseMs:data.post_pause_ms,
  ...((filePlayback()||!checked('trigger-sound'))?{sequenceEnabled:false,snap:false,moan:false,effects:false,effectPauseMs:0,plainPauseMs:0,postPauseMs:data.post_pause_ms??data.pause_ms}:{})};
}
document.addEventListener('trigger-detected',(event)=>{const detail=(event as CustomEvent).detail;if(!clock.running&&detail?.playSound!==false)return;lastSessionTrigger=detail?.triggerName||null;triggerPresentation.show(detail?.triggerName||'',playbackClock.time);visuals?.triggerPulse(playbackClock.time,detail?.visualEffect);if(!filePlayback()&&checked('trigger-sound')&&detail?.playSound!==false)audio?.triggerSound(detail?.triggerName||'');});
function resetBackgroundControls(preset:AudioPreset){
 $<HTMLInputElement>('background-drone').checked=preset.drone.enabled;$<HTMLInputElement>('background-noise').checked=preset.noise.enabled;
 $<HTMLInputElement>('background-drone-db').value=String(preset.mix.drone);$<HTMLInputElement>('background-noise-db').value=String(preset.mix.noise);$<HTMLSelectElement>('background-noise-type').value=preset.noise.type;
 backgroundControlsInitialized=true;
}
function currentAudioPreset():AudioPreset|undefined{
 const base=health.audioPresets?.[value('audio-preset')];if(!base)return;
 if(!backgroundControlsInitialized){resetBackgroundControls(base);applyProfile(savedBackground);}
 const preset=structuredClone(base) as AudioPreset;
 preset.drone.enabled=checked('background-drone');preset.noise.enabled=checked('background-noise');preset.noise.type=value('background-noise-type') as AudioPreset['noise']['type'];
 preset.mix.drone=Number(value('background-drone-db'));preset.mix.noise=Number(value('background-noise-db'));return preset;
}
function syncAudioPreset(){const preset=currentAudioPreset();if(!preset)return;
 const originalAvailable=health.localSounds?.includes('drone');const recorded=originalAvailable&&checked('original-sounds')&&preset.noise.enabled&&preset.drone.enabled&&['bambi_classic','bambi_classic_deep'].includes(preset.id);
 $<HTMLInputElement>('original-sounds').disabled=!originalAvailable||!preset.drone.enabled||!['bambi_classic','bambi_classic_deep'].includes(preset.id);
 audio?.useOriginalDrone(recorded);audio?.configurePreset(preset,director.active&&!filePlayback());
 $('background-drone-label').textContent=preset.mix.drone+' dB';$('background-noise-label').textContent=preset.mix.noise+' dB';
 $<HTMLInputElement>('background-drone-db').disabled=!preset.drone.enabled;
 $<HTMLInputElement>('background-noise-db').disabled=!preset.noise.enabled||recorded;$<HTMLSelectElement>('background-noise-type').disabled=!preset.noise.enabled||recorded;
 $('background-source-note').textContent=recorded?'The original drone includes recorded noise. Turn it off to choose your own noise type and level.':!preset.noise.enabled?'Noise is off. Enabled background tones play on their own.':'Generated background: adjust tones and noise separately.';
}
function voiceName(){const main=value('voice'),second=value('voice2'),weight=Number(value('voice-mix'));return second?`${main}(${Math.round((1-weight)*100)})+${second}(${Math.round(weight*100)})`:main;}
async function ask(text:string,autonomous=false,speechEpoch?:number,bypassFeedback=false,inputShown=false,narrationTicket?:number){
 const requestGeneration=generation,requestTransport=transportEpoch;
 if(!autonomous){pendingTurns++;narrationFlow.cancel();}
 try{
 await profileReady;await promptContextReady;
 if(requestTransport!==transportEpoch)return;
 if(autonomous&&(requestGeneration!==generation||!director.active))return;
 if(narrationTicket!==undefined&&(!narrationEnabled()||!narrationFlow.valid(narrationTicket)))return;
 if(narrationTicket!==undefined&&!narrationReady()){narrationFlow.defer(clock.time,narrationPause());return;}
 if(speechEpoch!==undefined&&(speechEpoch!==microphoneEpoch||!microphoneEnabled))return;
 if(ws?.readyState!==WebSocket.OPEN){notice('Start the local server to chat with Bambi.');finishDialogue();return;}
 if(autonomous&&(concurrentInput.pending||value('ai-mode')==='off'||['local','official'].includes(value('mode'))||dialogueActive))return;
 if(!autonomous)enableConversationInput();
 if(!director.active)await startSession();
 if(requestTransport!==transportEpoch)return;
 if(director.paused){notice('Resume your session before Bambi speaks.');return;}
 if(!director.active)return;
 if(speechEpoch!==undefined&&(speechEpoch!==microphoneEpoch||!microphoneEnabled))return;
 if(autonomous&&clock.time<silencedUntil)return;
 if(!autonomous&&isStopRequest(text)){if(!inputShown)addMessage('user',text);hardStop();return;}
 if(!autonomous&&!bypassFeedback&&listenAndAdapt()&&(agentBusy||voiceQueue||concurrentInput.pending)){
  if(narrationEnabled())narrationFlow.turnStarted();queueConcurrentInput(text,speechEpoch===undefined?'text':'speech');return;
 }
 if(autonomous){if(narrationTicket===undefined&&!director.enterInteractive(false))return;if(agentBusy||voiceQueue)interrupt(true,director.active,false,true);}
 else{if(!beginDialogue())return;interrupt(true,director.active,bypassFeedback);}
 const intent=resolveReplyIntent(text,value('prompt-template'),!autonomous,autonomous?'narration':undefined,lastReplyIntent),narration=intent==='narration';
 warmController?.abort();warmController=null;replyDialogue=!autonomous;agentBusy=true;replyFailed=false;notice('');
 replyNarrationPhase=narrationTicket!==undefined?sessionPhaseAt(clock.time,director.duration).phase:null;
 if(narrationEnabled()){if(narrationTicket===undefined)narrationFlow.turnStarted();if(narrationTicket!==undefined)narrationHasSpoken=true;}
 if(!autonomous){ambientAgent.message(clock.time,value('ai-mode')==='ambient'?matchingTrigger(text)||'':'');if(!inputShown)highlightTriggers(addMessage('user',text));if(!isContinuationRequest(text))lastQuestion=text;}
 const session=snapshotSession({elapsedSeconds:clock.time,totalSeconds:director.duration,scene:visuals?.scene??value('scene') as Scene,intensityPercent:director.intensity,activeTriggers:selectedTriggers(),lastTrigger:lastSessionTrigger});
 session.deliveryIntensityPercent=Math.round(director.level*1000)/10;
 if(autonomous){session.triggerTiming=currentTriggerTiming();if(session.triggerTiming.enabled)session.activeTriggers=triggersForPhase(session.phase,session.phaseProgress,session.triggerTiming);}
 send(buildChatRequest({type:'chat',requestId:replyGate.issue(),interaction:interaction(),source:autonomous?'engine':'user',text,intent:isContinuationRequest(text)?'continuation':intent,...(speechEpoch!==undefined?{inputTiming:{speechEndToRequestMs:Math.min(120000,Math.max(0,performance.now()-speechEndTime)),sttMs:lastSttMs}}:{}),sampling:value('sampling-profile')==='creative'?'creative':'qwen',soundDesign:autonomous&&(checked('sound-design')||checked('tick-enabled')),dialogue:!autonomous,
  session,dualVoice:checked('dual-voice'),adaptiveDelivery:narrationTicket!==undefined&&checked('adaptive-delivery')&&!filePlayback(),adaptiveVisuals:Number(value('visual-opacity'))>0&&session.phase!=='awakening'&&checked('visuals-enabled')&&checked('phase-visuals')&&checked('visual-journey')&&!checked('reduced')&&!presentationEvents.length&&!filePlayback(),
  model:value('model'),backend:nativeSamplingModels.includes(value('model'))?'llama.cpp':'ollama',voice:voiceName(),speed:Math.min(1.5,Math.max(.5,Number(value('speed')))),preset:value('audio-preset') as 'bambi_local_clean'|'bambi_classic'|'bambi_classic_deep'|'bambi_voice_test',speak:!['text','off'].includes(value('ai-mode')),persona:value('persona'),promptId:value('prompt-template') as 'bambisleep-classic'|'gentle-induction'|'custom',username:value('bambi-name'),selectedTriggers:session.activeTriggers,collar:checked('collar-enabled'),collarName:value('collar-name'),context:modelContext(value('model'),value('prompt-template')),maxTokens:replyTokenBudget(Number(value('response-length')),value('performance')==='latency',narration,text)},health.modelConnections));
 }finally{if(!autonomous)pendingTurns=Math.max(0,pendingTurns-1);finishDialogue();}
}
$<HTMLFormElement>('chat-form').onsubmit=e=>{e.preventDefault();const input=$<HTMLTextAreaElement>('chat-input');const text=input.value.trim();if(text){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));void ask(text);}};
$<HTMLTextAreaElement>('chat-input').oninput=()=>{if(narrationEnabled()){if(agentBusy||voiceQueue)narrationFlow.turnStarted();else narrationFlow.defer(clock.time,narrationPause());}if(value('chat-input').trim())beginDialogue();else finishDialogue();};
$<HTMLTextAreaElement>('chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$<HTMLFormElement>('chat-form').requestSubmit();}};

function syncMicrophoneButtons(){
 const state:MicrophoneState=!microphoneEnabled?'muted':microphoneStarting?'starting':mic.recording||mic.speechPending?'listening':sttController||streamingSpeech.pending?'transcribing':mic.blocked?'waiting':'ready';
 const activity=audio?.foregroundOutputActive('AI_VOICE')?'speaking':agentBusy||voiceQueue||pendingTurns||sessionEvents.narrationPending?'thinking':warming||companionPreparation.pending?'preparing':'idle';
 renderMicrophoneButton($('mic'),state,activity);
 setLiveText('ai-status',$('mic').querySelector('.voice-toggle-state')?.textContent||'Mic off');
 const text=state==='muted'?'Microphone muted':microphoneStatus[state];
 if($('mic-status').textContent!==text)$('mic-status').textContent=text;
}
function enableConversationInput(spoken=false){
 let changed=false;
 if(['local','official'].includes(value('mode'))){$<HTMLSelectElement>('mode').value='hybrid';changed=true;}
 if(value('ai-mode')==='off'||spoken&&value('ai-mode')==='text'){$<HTMLSelectElement>('ai-mode').value='interactive';changed=true;}
 if(changed)updateSettings();
}
async function toggleMicrophone(){
 if(microphoneEnabled){speechTurns.clear();concurrentInput.clear('speech');cancelInputMessages('speech');updateListeningStatus('');microphoneEnabled=false;microphoneStarting=false;microphoneEpoch++;streamingSpeech.close();mic.stop();sttController?.abort();sttController=null;syncMicrophoneButtons();finishDialogue();$('ai-status').textContent='Microphone muted';return;}
 microphoneEnabled=true;microphoneStarting=true;const epoch=++microphoneEpoch;syncMicrophoneButtons();
 try{
  await profileReady;if(epoch!==microphoneEpoch||!microphoneEnabled)return;
  if(!health.whisper)await refreshHealth();
  if(epoch!==microphoneEpoch||!microphoneEnabled)return;
  const recognition=value('mic-recognizer'),useStreaming=recognition!=='whisper'&&health.streamingSpeech;
  if(recognition==='streaming'&&!health.streamingSpeech)throw Error(health.desktopAlpha?'Open Setup to install streaming speech, then try the microphone again.':'Streaming speech is not installed. Run npm run setup:streaming-speech and restart the server.');
  if(!useStreaming&&!health.whisper)throw Error('Local speech recognition is offline. Install streaming speech or start the local Whisper service.');
  enableConversationInput(true);await startSession();
  if(epoch!==microphoneEpoch||!microphoneEnabled||!director.active){if(epoch===microphoneEpoch){microphoneEnabled=false;microphoneStarting=false;syncMicrophoneButtons();}return;}
  mic.configure(value('mic-playback-mode'),value('mic-sensitivity'),Number(value('mic-turn-pause')),!listenAndAdapt(),listenAndAdapt());
  if(useStreaming){
   try{await streamingSpeech.connect(new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws/speech'));}
   catch(error){if(epoch!==microphoneEpoch||!microphoneEnabled)return;if(!health.whisper||recognition==='streaming')throw error;notice('Streaming speech unavailable. Using local Whisper.');}
  }
  if(epoch!==microphoneEpoch||!microphoneEnabled){streamingSpeech.close();return;}
  await mic.init();if(epoch!==microphoneEpoch||!microphoneEnabled||!mic.stream)return;
  mic.vad=true;microphoneStarting=false;syncMicrophoneButtons();notice('');
 }catch(e){if(epoch===microphoneEpoch){microphoneEnabled=false;microphoneStarting=false;streamingSpeech.close();mic.stop();syncMicrophoneButtons();notice('Microphone: '+String(e));}}
}

$('mic').addEventListener('click',()=>void toggleMicrophone());
$('conversation-policy').addEventListener('change',()=>{concurrentInput.clear();cancelInputMessages();updateListeningStatus('');});
syncMicrophoneButtons();

$('audio-preset').addEventListener('change',()=>{const base=health.audioPresets?.[value('audio-preset')];if(base){savedBackground={};resetBackgroundControls(base);}const preset=currentAudioPreset();if(preset){$<HTMLSelectElement>('voice').value=preset.voice;$<HTMLSelectElement>('voice2').value='';$<HTMLInputElement>('speed').value=String(preset.speed);updateSettings();}});
$('start').onclick=()=>void startSession(false);$('fullscreen').onclick=()=>void toggleFullscreen();$('panic').onclick=()=>hardStop();$('pause').onclick=()=>void togglePause();$('mute').onclick=()=>{ensureAudio().mute();const button=$('mute'),muted=audio!.muted;button.dataset.muted=String(muted);button.setAttribute('aria-pressed',String(muted));button.setAttribute('aria-label',muted?'Unmute audio':'Mute audio');button.title=muted?'Unmute audio':'Mute audio';};
for(const scene of sceneNames){const o=document.createElement('option');o.value=scene;o.textContent=scene;$('scene').append(o);}
const triggerTimingControls=initTriggerTiming(previewPhaseCue,()=>{if(previewController){previewController.abort();previewController=null;}if(!director.active){interrupt();notice('Preview stopped.');}});
const preferenceIds=['conversation-style','bambicloud-cues','player-cue-markers','session-events','event-haptics','narration-enabled','adaptive-delivery',...Object.keys(narrationPauses).map(phase=>'narration-pause-'+phase),'spiral-style','spiral-depth','visual-journey','visual-fixation','visual-focus-words','sampling-profile','visual-voice-sync','visual-tick-sync','visual-reactivity','voice-echoes','dual-voice','trigger-timing-config',...devicePreferenceIds,'breath-visuals','breath-sound','sound-design','sound-defaults','sound-bass-fallback','tick-enabled','tick-defaults','tick-dives','visuals-enabled','mode','scene','phase-visuals','visual-opacity','intensity','duration','curve','ai-mode','model','voice','voice2','voice-mix','audio-preset','mic-recognizer','mic-playback-mode','mic-sensitivity','mic-interruptible','conversation-policy','mic-turn-pause','mic-smart-turns',...backgroundPreferenceIds,'speed','performance','persona','motion','density','reduced','subtitles','master','bus-session','bus-voice','bus-ambient','bus-effects','prompt-template','bambi-name','trigger-selection','triggers-enabled','trigger-sound','trigger-snap','trigger-moan','trigger-extra-effects','trigger-wiper-seconds','trigger-bubble-inflate','trigger-bubble-squeak','trigger-bubble-gap','trigger-inflate-db','trigger-squeak-db','trigger-tick-db','trigger-snap-db','trigger-moan-db','trigger-wiper-db','trigger-pop-db','trigger-bell-db','trigger-pop-variant','trigger-moan-variant','trigger-wiper-variant','trigger-effect-pause','trigger-plain-pause','original-sounds','collar-enabled','collar-name','response-length','spiral-mode','spiral-speed','spiral-complexity','spiral-alpha','spiral-color-a','spiral-color-b','brainwave-enabled','brainwave-preset','brainwave-volume'];
function profile(){return {'dialogue-version':1,'visuals-version':2,...savedBackground,...Object.fromEntries(preferenceIds.filter(id=>backgroundControlsInitialized||!backgroundPreferenceIds.includes(id)).map(id=>[id,[...deviceBooleanPreferenceIds,'bambicloud-cues','player-cue-markers','session-events','event-haptics','narration-enabled','adaptive-delivery','visual-journey','visual-focus-words','visual-voice-sync','visual-tick-sync','voice-echoes','dual-voice','breath-visuals','breath-sound','sound-design','sound-defaults','sound-bass-fallback','tick-enabled','tick-defaults','tick-dives','mic-interruptible','visuals-enabled','phase-visuals','reduced','subtitles','triggers-enabled','trigger-sound','trigger-snap','trigger-moan','trigger-extra-effects','trigger-bubble-inflate','trigger-bubble-squeak','original-sounds','background-drone','background-noise','collar-enabled','brainwave-enabled'].includes(id)?checked(id):value(id)])),duration:sessionDuration.preference};}
function syncVisualVisibility(){const enabled=checked('visuals-enabled');if(!enabled||!visuals?.enabled)visualFx=null;if(visuals)visuals.enabled=enabled&&!['ABORTED','FINISHED'].includes(director.state);}
function toggleVisuals(){$<HTMLInputElement>('visuals-enabled').checked=!checked('visuals-enabled');updateSettings();}
function updateSettings(){if(!checked('adaptive-delivery')||filePlayback()||sessionEvents.active){heardDelivery=undefined;audio?.setNarrationDelivery();}cueTimeline.refresh();if(!eventProgramEnabled())sessionEvents.stop();if(sessionEvents.active&&!checked('event-haptics'))deviceControls.clear();syncNarration();triggerTimingControls.sync();syncVisualVisibility();if(!checked('breath-visuals'))visuals?.clearBreath();if(audio)audio.breathSoundEnabled=!filePlayback()&&checked('breath-sound');mic.configure(value('mic-playback-mode'),value('mic-sensitivity'),Number(value('mic-turn-pause')),!listenAndAdapt(),listenAndAdapt());syncTriggerSettings();director.intensity=Number(value('intensity'));if(!filePlayback())sessionDuration.select();syncPlaylistDuration();if(sessionEvents.active)director.duration=sessionEvents.program!.durationMs/1000;director.curve=value('curve') as Curve;$('intensity-label').textContent=value('intensity');manualPresentation={scene:value('scene') as Scene,opacity:Number(value('visual-opacity')),spiral:{speed:Number(value('spiral-speed')),complexity:Number(value('spiral-complexity')),alpha:Number(value('spiral-alpha')),colorA:value('spiral-color-a'),colorB:value('spiral-color-b'),mode:value('spiral-mode'),style:value('spiral-style') as SpiralStyle,depth:Number(value('spiral-depth'))}};$('visual-reactivity-label').textContent=value('visual-reactivity')+'%';$('stage').dataset.focusWords=String(checked('subtitles')||checked('visual-focus-words'));if(visuals){visuals.fixation=value('visual-fixation') as 'none'|'dot'|'heart';visuals.voiceSync=checked('visual-voice-sync');visuals.tickSync=checked('visual-tick-sync');visuals.reactionStrength=Number(value('visual-reactivity'))/100;visuals.scene=value('scene') as Scene;visuals.reduced=checked('reduced');visuals.motion=Number(value('motion'));visuals.density=Number(value('density'));visuals.stableSettings={speed:Number(value('spiral-speed')),complexity:Number(value('spiral-complexity')),alpha:Number(value('spiral-alpha')),colorA:value('spiral-color-a'),colorB:value('spiral-color-b'),mode:value('spiral-mode'),style:value('spiral-style') as SpiralStyle,depth:Number(value('spiral-depth'))};}syncContent();if(timelineSource&&timelineDuration!==director.duration){importedTimeline=parseTimelineJSON(timelineSource,director.duration);timelineDuration=director.duration;timelineBase=structuredClone(manualPresentation);if(selected>=0){tracks[selected].timeline=importedTimeline;tracks[selected].timelineSource=timelineSource??undefined;}scheduleImported();syncPresentation();}syncPresentation();$('official-note').classList.toggle('hidden',value('mode')!=='official');$('length').textContent=format(director.duration);for(const [id,bus] of Object.entries({'master':'MASTER','bus-session':'SESSION','bus-voice':'AI_VOICE','bus-ambient':'AMBIENCE','bus-effects':'EFFECTS'}))audio?.set(bus as Bus,Number(value(id)));syncAudioPreset();if(clock.running){audio?.ambience(!filePlayback()&&Number(value('bus-ambient'))>0);const preset=brainwaveSelection();audio?.brainwave(!filePlayback()&&checked('brainwave-enabled'),preset?.carrier,preset?.beat,Number(value('brainwave-volume')));}if(value('ai-mode')==='off'||value('mode')==='local'||value('mode')==='official'){interrupt();finishDialogue();}navigation.syncSummary();queueCompanionPreparation();localStorage.setItem('bambi-profile',JSON.stringify(profile()));lastProfileSave=performance.now();}
for(const id of preferenceIds){$(id).addEventListener('input',()=>{if(id==='player-cue-markers'){cueTimeline.refresh();localStorage.setItem('bambi-profile',JSON.stringify(profile()));lastProfileSave=performance.now();return;}if(id==='visual-journey'&&checked(id))$<HTMLInputElement>('phase-visuals').checked=true;if(id==='scene'||id==='visual-opacity'||id.startsWith('spiral-'))$<HTMLInputElement>('phase-visuals').checked=false;if(id==='background-noise'&&!checked(id))$<HTMLInputElement>('original-sounds').checked=false;if(id==='original-sounds'&&checked(id))$<HTMLInputElement>('background-noise').checked=true;updateSettings();});}
for(const [id,style] of Object.entries({'immersive-max':'tunnel','immersive-tunnel':'tunnel','immersive-loop':'loop','immersive-fractal':'fractal','immersive-vortex':'vortex','immersive-infinity':'infinity','immersive-prism':'prism','immersive-orb':'orb'}))$(id).onclick=()=>{
 $<HTMLSelectElement>('scene').value='Spiral Focus';$<HTMLSelectElement>('spiral-style').value=style;
 for(const [key,val] of Object.entries({'spiral-depth':'.9','spiral-speed':style==='infinity'?'.55':'.45','spiral-complexity':'1.4','spiral-alpha':'1','visual-opacity':'1','visual-reactivity':'100','spiral-color-a':'#f52c9e','spiral-color-b':'#ffe1f7'}))$<HTMLInputElement>(key).value=val;
 $<HTMLSelectElement>('spiral-mode').value='breathe';$<HTMLSelectElement>('visual-fixation').value='heart';
 for(const key of ['visuals-enabled','visual-voice-sync','visual-tick-sync','visual-focus-words'])$<HTMLInputElement>(key).checked=true;
 $<HTMLInputElement>('visual-journey').checked=id==='immersive-max';$<HTMLInputElement>('phase-visuals').checked=id==='immersive-max';
 updateSettings();
};
let previewController:AbortController|null=null,previewSequence=0;
async function previewPhaseCue(trigger:string,phase:SessionPhase='conditioning',progress=0){
 if(director.active){notice('Stop your session before playing an individual sound preview.');return;}
 await profileReady;
 previewController?.abort();interrupt();const controller=new AbortController();previewController=controller;const previewEpoch=generation;
 try{
  const engine=ensureAudio();await engine.init();if(controller.signal.aborted||previewEpoch!==generation)return;
  notice('Preparing your phase cue …');
  const response=await fetch('/api/trigger-preview',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]),body:JSON.stringify({trigger,voice:voiceName(),speed:Number(value('speed')),preset:value('audio-preset')})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Preview unavailable');
  if(controller.signal.aborted||previewEpoch!==generation||director.active)return;
  const bytes=Uint8Array.from(atob(data.audio),(c:string)=>c.charCodeAt(0)).buffer;
  engine.resetSoundDesignSession();
  if(visuals)visuals.enabled=checked('visuals-enabled');
  await engine.playVoice(bytes,(_start,_duration,wordTime)=>{
   if(previewEpoch!==generation)return;
   notice('Playing '+phase+' cue: '+trigger);
   scheduleSpokenTrigger(trigger,playbackClock.time+wordTime-engine.outputTime,`preview-${previewEpoch}-${++previewSequence}`);
  },()=>{if(previewEpoch===generation)notice('Your phase cue preview is finished.');},
   spokenTriggerOptions({...data,trigger}),
   {text:trigger,phase,spokenSeconds:data.spoken_seconds});
 }catch(error){if(!controller.signal.aborted)notice(String(error));}
 finally{if(previewController===controller)previewController=null;}
}
$('trigger-preview').onclick=async()=>{const button=$<HTMLButtonElement>('trigger-preview');button.disabled=true;try{await previewPhaseCue(value('trigger-preview-word'));}finally{button.disabled=false;}};
$('reset-background').onclick=()=>{const preset=health.audioPresets?.[value('audio-preset')];if(preset){savedBackground={};resetBackgroundControls(preset);updateSettings();}};
$('ai-mode').addEventListener('change',()=>ambientAgent.reset(clock.time));
$('conversation-style').addEventListener('change',()=>{interrupt();finishDialogue();if(narrationEnabled()&&director.active)narrationFlow.defer(clock.time,narrationPause());});
$('prompt-template').addEventListener('change',()=>{interrupt();finishDialogue();promptContextReady=fetch('/api/conversation',{method:'POST'}).catch(()=>{});syncContent();});
$('performance').addEventListener('change',()=>{const wanted=modelForPerformance(health.models||[],value('performance')==='quality');if(wanted)$<HTMLSelectElement>('model').value=wanted;updateSettings();});
$<HTMLInputElement>('reduced').checked=matchMedia('(prefers-reduced-motion: reduce)').matches;
function format(t:number){return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;}
function trackName(track:Track){return track.file?.name??track.remote?.title??'Unavailable track';}
const sessionLibrary=new SessionLibrary<Track>({items:()=>tracks,selected:()=>selected,choose:selectTrack,save:persistTracks,analyze:analyzeLibraryTrack});
function renderTracks(){sessionLibrary.render();}
async function analyzeLibraryTrack(track:Track,info:HTMLElement,analyze:HTMLButtonElement){if(!track.file)return;analyze.disabled=true;const transcript=health.whisper&&checked('analysis-transcript');try{notice('Analyzing your file locally. Your audio stays on this device.');const r=await fetch('/api/analyze?transcribe='+Boolean(transcript),{method:'POST',body:track.file});const data=await r.json();if(!r.ok)throw Error(data.error);if(data.captions?.length){track.timelineSource=undefined;track.timeline=data.captions.map((x:any)=>({...x,id:crypto.randomUUID(),data:{text:x.text}}));if(tracks[selected]===track){importedTimeline=track.timeline!;timelineSource=null;scheduleImported();restoreMediaCaption(media.currentTime);}}const canvas=document.createElement('canvas');canvas.width=320;canvas.height=36;canvas.style.width='100%';canvas.title='Locally analyzed waveform';const ctx=canvas.getContext('2d')!;ctx.fillStyle='#dc79c9';data.waveform.forEach((peak:number,i:number)=>ctx.fillRect(i*320/data.waveform.length,18-peak*16,Math.max(1,320/data.waveform.length),Math.max(1,peak*32)));info.append(canvas);$('timeline-info').textContent=`${data.silence.length} pauses / ${data.captions?.length||0} captions`;notice('Analysis saved. Future runs use the local cache.');}catch(e){notice('Analysis: '+String(e));}finally{analyze.disabled=false;}}

function persistTracks(){
 for(const t of tracks)libraryMetadata.set(t.id,{id:t.id,favorite:t.favorite,notes:t.notes,tags:t.tags,plays:t.plays,lastPlayed:t.lastPlayed,...(t.remote?{remote:t.remote}:{})});
 const metadata=[...libraryMetadata.values()];localStorage.setItem('bambi-library',JSON.stringify(metadata));
 const encoder=new TextEncoder();let batch:TrackMetadata[]=[],bytes=2;
 const save=(items:TrackMetadata[])=>void fetch('/api/library',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(items)}).then(r=>{if(!r.ok)throw Error('Library save failed');}).catch(()=>notice('Library is saved in this browser; the server backup is unavailable.'));
 for(const item of metadata){const size=encoder.encode(JSON.stringify(item)).length+1;if(bytes+size>96000&&batch.length){save(batch);batch=[];bytes=2;}batch.push(item);bytes+=size;}if(batch.length)save(batch);
}
function canSeekMedia(){return selected>=0&&['local','hybrid'].includes(value('mode'))&&Number.isFinite(media.duration)&&media.duration>0;}
function filePlayback(){return selected>=0&&value('mode')!=='conversation';}
function eventProgramEnabled(){return checked('session-events')&&!filePlayback()&&!['local','official'].includes(value('mode'));}
function finishedTrackPlayback(){return !!tracks[selected]?.remote&&['local','official'].includes(value('mode'));}
function remoteQueue(index=selected){const id=tracks[index]?.remote?.playlistId;return tracks.map((track,i)=>({track,index:i})).filter(item=>id&&item.index>=index&&item.track.remote?.playlistId===id&&item.track.remote.url);}
function syncPlaylistDuration(){
 if(!filePlayback()){director.duration=sessionDuration.showSession();return;}
 const remote=!!tracks[selected]?.remote;
 const total=remote?remoteQueue().reduce((sum,item)=>sum+(item.index===selected&&Number.isFinite(media.duration)?media.duration:(item.track.remote!.durationMs/1000||1)),0):media.duration;
 director.duration=sessionDuration.showMedia(total,mediaStartedAt,remote);
}
const remoteCues=new BambiCloudCuePlayback();let cueRequest:AbortController|null=null,cueFailureNotice:string|null=null;
function remoteCueStatus(text:string){
 $('bambicloud-cue-status').textContent=text;$('bambicloud-cue-status').hidden=!text;
}
async function loadRemoteCues(signal?:AbortSignal){
 cueRequest?.abort();cueRequest=null;remoteCues.load([]);cueTimeline.load([]);if(finishedTrackPlayback())audio?.stopEventCues();const track=tracks[selected],url=track?.remote?.cueUrl;
 if(cueFailureNotice&&$('notice').textContent===cueFailureNotice)notice('');cueFailureNotice=null;
 if(!track?.remote){remoteCueStatus('');return;}
 if(!url){const text='This recording has no timed trigger cues. Original audio plays without synchronized trigger words or effects.';remoteCueStatus('');$('timeline-info').textContent=text;return;}
 remoteCueStatus('Loading timed trigger cues…');
 const controller=new AbortController();cueRequest=controller;
 try{const r=await fetch('/api/bambicloud/cues?url='+encodeURIComponent(url),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000),...(signal?[signal]:[])])});const data=await r.json();if(!r.ok)throw Error(data.error||'Timed cues unavailable.');
  if(controller.signal.aborted||signal?.aborted||tracks[selected]!==track)return;const cues=parseBambiCloudCues(data.cues);remoteCues.load(cues,media.currentTime);cueTimeline.load(cues);remoteCueStatus('');$('timeline-info').textContent=cues.length+' source-timed trigger cues'+(data.adjustedEnds?' · '+data.adjustedEnds+' display intervals adjusted':'')+(data.skipped?' · '+data.skipped+' invalid entries skipped':'');
 }catch(error){if(!controller.signal.aborted&&!signal?.aborted){cueFailureNotice=String(error);notice(cueFailureNotice);remoteCueStatus('Timed cues could not be loaded. Original audio can still play.');}}finally{if(cueRequest===controller)cueRequest=null;}
}
$('bambicloud-cues').onchange=()=>{triggerPresentation.clear();visuals?.clearTrigger();if(finishedTrackPlayback())audio?.stopEventCues();void loadRemoteCues();};
$('library-play').onclick=async()=>{navigation.show('session');playerControls.reveal();if(director.active){if(director.paused)await togglePause();}else await startSession(false);};
function selectTrack(index:number){
 if(!tracks[index]||!tracks[index].file&&!tracks[index].remote?.url){notice('This track is not available for public streaming.');return;}
 interrupt();media.pause();if(mediaUrl)URL.revokeObjectURL(mediaUrl);visualFx=null;visuals?.clearTrigger();selected=index;const track=tracks[index];
 track.plays++;track.lastPlayed=new Date().toISOString();persistTracks();mediaStartedAt=director.active?clock.time:0;
 if(track.remote||!['local','hybrid'].includes(value('mode'))){sessionEvents.stop();$<HTMLSelectElement>('mode').value='local';$<HTMLInputElement>('experience-join').checked=false;}
 importedTimeline=track.timeline||[];timelineSource=track.timelineSource??null;timelineDuration=0;timelineBase=structuredClone(manualPresentation);
 if(timelineSource){importedTimeline=parseTimelineJSON(timelineSource,director.duration);timelineDuration=director.duration;}
 mediaCaptionText='';activeCaptionEnd=0;scheduleImported();mediaUrl=track.file?URL.createObjectURL(track.file):null;
 media.src=mediaUrl??'/api/bambicloud/stream?url='+encodeURIComponent(track.remote!.url!);media.classList.toggle('hidden',!track.file?.type.startsWith('video/'));
 syncPlaylistDuration();updateSettings();void loadRemoteCues();$('media-name').textContent=trackName(track);renderTracks();
 if(clock.running)void media.play().catch(e=>notice(String(e)));
}
$<HTMLInputElement>('files').onchange=async e=>{await profileReady;for(const file of (e.target as HTMLInputElement).files||[]){const id=file.name+':'+file.size+':'+file.lastModified;if(tracks.some(t=>t.id===id))continue;const old=libraryMetadata.get(id);tracks.push({file,id,favorite:old?.favorite||false,notes:old?.notes||'',tags:old?.tags||'',plays:old?.plays||0,lastPlayed:old?.lastPlayed||''});}renderTracks();if(selected<0&&tracks.length)selectTrack(0);};
media.onloadedmetadata=()=>{cueTimeline.refresh();if(Number.isFinite(media.duration)){$<HTMLInputElement>('seek').max=String(media.duration);$('length').textContent=format(media.duration);syncPlaylistDuration();}};
let playlistRequest:AbortController|null=null;
$('bambicloud-cancel').onclick=()=>playlistRequest?.abort();
$('bambicloud-import').onsubmit=async event=>{
 event.preventDefault();await profileReady;const url=value('bambicloud-url').trim(),id=playlistIdFromUrl(url);
 if(!id){$('bambicloud-status').textContent='Enter a https://bambicloud.com/playlist/… URL.';return;}
 playlistRequest?.abort();const controller=new AbortController();playlistRequest=controller;
 $<HTMLButtonElement>('bambicloud-load').disabled=true;$('bambicloud-cancel').hidden=false;$('bambicloud-status').textContent='Loading playlist from BambiCloud…';
 try{
  const response=await fetch('/api/bambicloud/playlist?url='+encodeURIComponent(url),{signal:controller.signal});const data=await response.json();
  if(!response.ok)throw Error(data.error??'Could not load playlist.');
  if(data.id!==id||!Array.isArray(data.tracks)||data.tracks.length>500)throw Error('Unsupported playlist response.');
  const playlist=data as BambiCloudPlaylist,items=playlist.tracks.map(item=>BambiCloudTrackSchema.parse(item));
  if(items.some(item=>item.playlistId!==id))throw Error('Unsupported playlist response.');
  for(const remote of items){const trackId=bambiCloudTrackId(remote),existing=tracks.find(t=>t.id===trackId),old=libraryMetadata.get(trackId);
   if(existing)existing.remote=remote;else tracks.push({id:trackId,remote,favorite:old?.favorite??false,notes:old?.notes??'',tags:old?.tags??'',plays:old?.plays??0,lastPlayed:old?.lastPlayed??''});
  }
  persistTracks();renderTracks();const available=items.filter(t=>t.url).length;
  $('bambicloud-status').textContent=`${playlist.title} added. ${available} of ${items.length} sessions available. Choose one below to play.`;
 }catch(error){$('bambicloud-status').textContent=controller.signal.aborted?'Playlist loading cancelled.':error instanceof Error?error.message:'Could not load playlist.';}
 finally{if(playlistRequest===controller){playlistRequest=null;$<HTMLButtonElement>('bambicloud-load').disabled=false;$('bambicloud-cancel').hidden=true;}}
};
media.onerror=()=>notice('The selected audio could not be played. Try another public track or a local file.');
media.onended=()=>{
 const next=tracks[selected]?.remote?remoteQueue().find(item=>item.index>selected)?.index:tracks.findIndex((t,i)=>i>selected&&!!t.file);
 if(selected>=0&&next!==undefined&&next>=0){selectTrack(next);}else{media.pause();if(filePlayback()&&director.active)director.duration=Math.max(.001,clock.time);notice('Playlist complete.');}
};
media.onseeking=()=>{visuals?.clearSceneTransition();remoteCues.seek(media.currentTime);triggerPresentation.clear();visuals?.clearTrigger();audio?.stopEventCues();};
$<HTMLInputElement>('seek').oninput=()=>{if(!canSeekMedia())return;const t=Number(value('seek'));if(selected>=0&&Number.isFinite(media.duration)){media.currentTime=Math.min(t,media.duration);}interrupt();visualFx=null;visuals?.clearSceneTransition();clock.seek(selected>=0?mediaStartedAt+t:t);finishDialogue();sessionEvents.seek(clock.time*1000);restoreMediaCaption(t);};
$<HTMLInputElement>('timeline-file').onchange=async e=>{const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;try{const text=await file.text();if(file.name.endsWith('.json')){const events=parseTimelineJSON(text,director.duration);timelineSource=text;timelineDuration=director.duration;importedTimeline=events;}else{timelineSource=null;const time=(s:string)=>s.split(':').reduce((a,b)=>a*60+Number(b.replace(',','.')),0);importedTimeline=[];for(const block of text.split(/\r?\n\r?\n/)){const lines=block.split(/\r?\n/),idx=lines.findIndex(l=>l.includes('-->'));if(idx<0)continue;const parts=lines[idx].split(' --> '),start=time(parts[0]),end=time(parts[1].split(' ')[0]);if(!Number.isFinite(start)||!Number.isFinite(end))continue;importedTimeline.push({id:crypto.randomUUID(),time:start,type:'caption',duration:end-start,data:{text:lines.slice(idx+1).join(' ').replace(/<[^>]+>/g,'')}});}}
 timelineBase=structuredClone(manualPresentation);if(selected>=0){tracks[selected].timeline=importedTimeline;tracks[selected].timelineSource=timelineSource??undefined;}scheduleImported();syncPresentation();restoreMediaCaption(selected>=0?media.currentTime:clock.time);$('timeline-info').textContent=`${importedTimeline.length} events loaded. They begin with your session.`;}catch(e){notice('Timeline: '+String(e));}};
function handleEvent(event:TimelineEvent){if(sessionEvents.active&&['caption','scene','visual','ambient','silence','trigger-cue','word'].includes(event.type)&&!(event.type==='trigger-cue'&&(event.data as any)?.source==='speech'))return;const d=event.data as any;if(event.type==='spoken-pink')visuals?.pinkPulse(playbackClock.time);if(event.type==='caption'){if(clock.time-event.time<=.15)triggerFlash(d.text,!filePlayback());mediaCaptionText=d.text;activeCaptionStart=event.time;activeCaptionEnd=event.time+(event.duration||4);}if(event.type==='trigger-cue')triggerFlash(d.text,!filePlayback()&&d.playSound!==false);if(event.type==='voice-caption'){voiceCaptionText=d.text;voiceCaptionEnd=event.time+(event.duration||4);}if(event.type==='word'){activeWordText=d.text;activeWordStart=event.time;activeWordEnd=event.time+(event.duration||.5);}if(event.type==='voice-start'){if(deliveryModes.includes(d.delivery)&&checked('adaptive-delivery')&&!filePlayback()&&!sessionEvents.active){heardDelivery=d.delivery;audio?.setNarrationDelivery(heardDelivery);}else{heardDelivery=undefined;audio?.setNarrationDelivery();}send({type:'playback-start',id:d.requestId,seq:d.seq});send({type:'metric',name:'audio.playback',value:{requestId:d.requestId,clock:clock.time}});if(speechEndTime){send({type:'metric',name:'speech-end-to-voice-start',value:performance.now()-speechEndTime});speechEndTime=0;}}if(event.type==='visual'&&visuals){const parsed=ActionSchema.safeParse(d);if(parsed.success&&parsed.data.type==='visual'){visuals.effect=parsed.data.effect;visualFx={start:event.time,end:event.time+parsed.data.durationMs/1000,level:Math.min(parsed.data.intensity,director.level+.1)};}}if(event.type==='scene'&&visuals&&sceneNames.includes(d.scene)&&event.scope!=='media'){manualPresentation=mergePresentation(manualPresentation,d);$<HTMLInputElement>('phase-visuals').checked=false;$<HTMLSelectElement>('scene').value=d.scene;$<HTMLInputElement>('visual-opacity').value=String(manualPresentation.opacity);for(const [key,v] of Object.entries(manualPresentation.spiral))if($('spiral-'+key))$<HTMLInputElement>('spiral-'+key).value=String(v);updateSettings();}if(event.type==='ambient'&&!filePlayback()){audio?.set('AMBIENCE',d.level);audio?.ambience(d.level>0);}if(event.type==='silence'){interrupt();silencedUntil=event.time+d.durationMs/1000;}}
async function refreshHealth(){try{const r=await fetch('/api/health');health=await r.json();syncAudioPreset();$('health-llm').textContent=value('model').startsWith('cloud:')?(health.cloud?.ready?'AI cloud':'Cloud offline'):(health.ollama||health.llamaModels?.length?'AI local':'AI offline');$('health-tts').textContent=health.kokoro?'Kokoro ready':'Voice offline';$('health-llm').classList.toggle('ok',!!health.cloud?.ready||health.ollama||!!health.llamaModels?.length);$('health-tts').classList.toggle('ok',health.kokoro);$('health-audio').classList.toggle('ok',!!audio&&audio.context.state==='running');for(const [id,list] of [['model',health.models],['voice',health.voices],['voice2',health.voices],['audio-preset',Object.keys(health.audioPresets||{})]] as [string,string[]][]){const current=value(id);if(list?.length){const select=$<HTMLSelectElement>(id);const currentOptions=[...select.options].map(o=>o.value).filter(Boolean);if(list.join()!==currentOptions.join()||id==='model'&&[...select.options].some(option=>option.textContent!==modelLabel(option.value,health.modelLabels))){select.replaceChildren();if(id==='voice2'){const none=document.createElement('option');none.value='';none.textContent='No blend';select.append(none);}for(const item of list){const option=document.createElement('option');option.value=item;option.textContent=id==='audio-preset'?health.audioPresets[item].label:id==='model'?modelLabel(item,health.modelLabels):item.replace('af_','').replace('bf_','British ');select.append(option);}if([...select.options].some(o=>o.value===current))select.value=current;else if(id==='voice')select.value='af_heart';else if(id==='voice2')select.value='';else if(id==='audio-preset')select.value='bambi_local_clean';else if(id==='model')select.value=health.models.includes(health.selectedModel)?health.selectedModel:modelForPerformance(health.models,value('performance')==='quality')||health.models[0];}}}navigation.syncSummary();queueCompanionPreparation();}catch{}}
$('hud-toggle').onclick=()=>{hudVisible=!hudVisible;$('hud').classList.toggle('hidden',!hudVisible);};
$('stage').addEventListener('pointermove',()=>{lastPointer=performance.now();});
$('stage').addEventListener('pointerdown',()=>{lastPointer=performance.now();},{passive:true});
document.addEventListener('keydown',e=>{
 if(e.defaultPrevented||e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key==='Escape'){const now=performance.now();if(now-esc<900)hardStop();esc=now;return;}
 if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;
 if(e.code==='Space'){e.preventDefault();void togglePause();return;}
 if(e.key.toLowerCase()==='f'){e.preventDefault();void toggleFullscreen();return;}
 if((e.target as HTMLElement).closest('button'))return;
 if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();$<HTMLInputElement>('intensity').value=String(Math.min(100,Math.max(0,Number(value('intensity'))+(e.key==='ArrowUp'?5:-5))));updateSettings();}
 if(e.key.toLowerCase()==='m')$('mute').click();if(e.key.toLowerCase()==='v')toggleVisuals();if(e.key.toLowerCase()==='a'){$<HTMLSelectElement>('ai-mode').value=value('ai-mode')==='off'?'voice':'off';updateSettings();}if(e.key.toLowerCase()==='h')$('hud-toggle').click();if(e.key.toLowerCase()==='i'){sessionEvents.userTurn();interrupt();finishDialogue();}
});
function clearPendingConversation(){transportEpoch++;microphoneEpoch++;streamingSpeech.reset();interrupt();sttController?.abort();sttController=null;finishDialogue();}
$('new-conversation').onclick=async()=>{clearPendingConversation();try{const r=await fetch('/api/conversation',{method:'POST'});if(!r.ok)throw Error('Could not start a new conversation.');$('messages').replaceChildren();addMessage('assistant','A fresh little beginning, sweetie. What mood are we in?');notice('New conversation. Saved preferences and earlier memories remain available.');}catch(e){notice(String(e));}};
initMemoryPanel(notice,clearPendingConversation);
function setLiveText(id:string,text:string){const node=$(id);if(node.textContent!==text)node.textContent=text;}
function controlTick(wall:number){
 const was=director.state;
 // The original track decides its end, including buffering and metadata rounding.
 if(filePlayback()&&director.active&&!media.ended)director.duration=Math.max(director.duration,clock.time+Math.max(1,(Number.isFinite(media.duration)?media.duration:(tracks[selected].remote?.durationMs??0)/1000)-media.currentTime));
 if(clock.running&&!media.paused&&checked('bambicloud-cues'))for(const cue of remoteCues.tick(media.currentTime)){triggerCue(cue.trigger);triggerPresentation.show(cue.trigger,playbackClock.time,cue.stop-cue.start);if(checked('triggers-enabled')&&/^pink$/i.test(cue.trigger.trim()))visuals?.pinkPulse(playbackClock.time);}
 director.update();syncPlayButton();
 const phase=sessionPhaseAt(clock.time,director.duration);
 audio?.updateSessionPhase(phase.phase,phase.progress,clock.running);
 if(clock.running&&phase.phase!==lastPhase){lastPhase=phase.phase;deviceControls.sync();}
 deviceControls.tick(wall);
 sessionEvents.tick(clock.time*1000,dialogueActive||agentBusy||voiceQueue>0||mic.recording||!!sttController);
 if(narrationEnabled()){
  const ticket=narrationFlow.next(clock.time,director.duration,narrationReady());
  if(ticket!==null)void ask(narrationDirective(phase.phase,!narrationHasSpoken,director.duration-clock.time,interaction()==='situational'),true,undefined,false,false,ticket).catch(error=>{narrationFlow.cancel();notice(String(error));});
 }
 if(!sessionEvents.active&&!narrationEnabled()&&clock.running&&value('ai-mode')==='ambient'&&['conversation','hybrid'].includes(value('mode'))){
  const agent=ambientAgent.next(clock.time,!agentBusy&&!voiceQueue&&!concurrentInput.pending&&!queuedTranscriptions&&!mic.recording&&!sttController&&clock.time>=silencedUntil&&director.state!=='COOLDOWN');
  if(agent)void ask(ambientDirective(agent.reason,value('bambi-name'),agent.trigger),true);
 }
 director.update();
 if(director.state==='FINISHED'&&was!=='FINISHED'){
  void saveSession('FINISHED');releaseSession();
  $('stage-label').textContent='All settled, sweetie. Your session is complete.';
  $('start').textContent='Begin another session';status('Take a little moment, sweetie. Begin again whenever you are ready.');
 }
 syncPlayButton();syncEndSessionControl();
 for(const event of clock.tick())handleEvent(event);
 for(const event of playbackClock.tick())handleEvent(event);
 if(reply?.dataset.playback==='true'){const text=speechPlayback.revealed(playbackClock.time);if(reply.dataset.displayText!==text)reply.dataset.displayText=text;}
 if(wall-lastHealth>6000){lastHealth=wall;void refreshHealth();if(ws?.readyState===WebSocket.CLOSED)connect();}
 if(lastProfileSave&&wall-lastProfileSave>700){
  lastProfileSave=0;
  void fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(profile())}).catch(()=>{});
 }
}
function frame(wall:number){if(audio){const tick=audio.tickStatus;setLiveText('tick-status',tick.active?'Tick playing · '+tick.bpm+' BPM · '+tick.interval.toFixed(2)+' s per tick':'Tick off');}$('caption').textContent='';$('word').textContent=(checked('subtitles')||checked('visual-focus-words'))&&playbackClock.time>=activeWordStart&&playbackClock.time<activeWordEnd?activeWordText:'';const t=clock.time;const position=canSeekMedia()?media.currentTime:t;setLiveText('stage-clock',format(t));setLiveText('elapsed',format(position));$('media-seek').hidden=!canSeekMedia();$<HTMLInputElement>('seek').disabled=!canSeekMedia();if(canSeekMedia())setLiveText('length',format(media.duration));$('stage-state').textContent=director.paused?'Pause':director.state==='IDLE'?'Preview':director.state==='ABORTED'?'Stopped':director.state==='FINISHED'?'Complete':director.held?'Listening':'Playing';const seek=$<HTMLInputElement>('seek');if(document.activeElement!==seek){seek.value=String(position);if(selected<0)seek.max=String(director.duration);}syncMicrophoneButtons();playerControls.present(wall);if(visualFx&&visuals){visuals.pulse=t<visualFx.end?visualFx.level*Math.sin(Math.PI*Math.max(0,(t-visualFx.start)/(visualFx.end-visualFx.start))):0;if(t>=visualFx.end)visualFx=null;}syncPresentation();sessionEvents.present(clock.time*1000,checked('subtitles')||checked('visual-focus-words'));if(sessionEvents.reservedBlank)triggerPresentation.clear();triggerPresentation.present(playbackClock.time,checked('triggers-enabled')&&(checked('subtitles')||checked('visual-focus-words')||finishedTrackPlayback()&&checked('bambicloud-cues')));$<HTMLInputElement>('duration').disabled=sessionEvents.active||filePlayback();$<HTMLInputElement>('event-program-file').disabled=director.active||warming||filePlayback();const pressured=presentationGovernor.observe(previousFrameAt?wall-previousFrameAt:0,wall,voiceQueue>0);previousFrameAt=wall;if(visuals){visuals.busy=pressured||companionPreparation.pending||warming||agentBusy||voiceQueue>0;visuals.sceneTransitions=!sessionEvents.active&&presentationEvents.length===0;}visuals?.render(t,director.active?director.level:.35,audio?.level()||0,wall,playbackClock.time,audio?.outputTime,audio?.visualSignal());if(hudVisible){const h=health.hardware||{};$('hud').textContent=`${director.state}${director.paused?' / paused':''}  ${t.toFixed(2)} s\n${visuals?.fps.toFixed(0)||'—'} FPS / quality ${visuals?.quality.toFixed(2)||'—'}\nGPU ${h.gpuLoad??'—'}% / VRAM ${h.vramUsed?(h.vramUsed/2**30).toFixed(2):'—'} GiB\nRAM free ${h.ramFree?(h.ramFree/2**30).toFixed(1):'—'} GiB\nAI ${tokensPerSecond.toFixed(1)} tok/s / TTFT ${ttft.toFixed(0)} ms\nSpeech queue ${voiceQueue} / decode ${lastVoiceMs.toFixed(0)} ms\nAudio ${audio?.context.state||'idle'} / ${audio?.context.baseLatency.toFixed(3)||'—'} s\nIntensity ${(director.level*100).toFixed(0)}`;}}
function applyProfile(stored:Record<string,unknown>){for(const [id,v] of Object.entries(stored)){if(!preferenceIds.includes(id))continue;if(id==='duration'){sessionDuration.restore(v);continue;}if(backgroundPreferenceIds.includes(id))savedBackground[id]=v;if((id==='voice'||id==='voice2')&&v!==''&&!['af_heart','af_bella','af_sarah','af_nicole','af_sky','af_river','af_aoede','bambi_classic'].includes(String(v)))continue;const input=$<HTMLInputElement>(id);if(typeof v==='boolean')input.checked=v;else if(typeof v==='string'||typeof v==='number'){if(input.tagName==='SELECT'&&![...($<HTMLSelectElement>(id).options)].some(o=>o.value===String(v))){const option=document.createElement('option');option.value=String(v);option.textContent=id==='model'?modelLabel(String(v),health.modelLabels):String(v);input.append(option);}input.value=String(v);}}}
function localJSON(key:string,fallback:any){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
const deviceControls=initDeviceControls(send,()=>audio,()=>({running:director.active,paused:director.paused||director.held,elapsed:clock.time,duration:director.duration,tickBpm:audio?.tickStatus.bpm??0,tickPhaseMs:audio?.tickStatus.phaseMs??0}),()=>sessionEvents.active);
const navigation=initNavigation();
const playerControls=initSessionControls();
const playerComposer=initPlayerComposer();
const profileReady=(async()=>{await contentReady;try{const response=await fetch('/api/desktop/capabilities');if(response.ok){desktopCapabilities=await response.json();if(desktopCapabilities.alpha)preparationAllowed=false;}}catch{}const local=localJSON('bambi-profile',{});const saved=localJSON('bambi-library',[]);for(const item of Array.isArray(saved)?saved:[])if(item?.id)libraryMetadata.set(item.id,item);const results=await Promise.allSettled(['/api/preferences','/api/library'].map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('Profile unavailable');return r.json();}));const stored={...local,...(results[0].status==='fulfilled'?results[0].value:{})};if(stored['dialogue-version']!==1){stored['mic-playback-mode']='headphones';stored['mic-interruptible']=true;stored['mic-turn-pause']='650';}applyProfile(migrateVisualPreferences(stored));if(results[1].status==='fulfilled'&&Array.isArray(results[1].value))for(const item of results[1].value)if(item?.id)libraryMetadata.set(item.id,item);for(const item of libraryMetadata.values()){const remote=BambiCloudTrackSchema.safeParse(item.remote);if(remote.success&&item.id===bambiCloudTrackId(remote.data))tracks.push({...item,remote:remote.data});}renderTracks();localStorage.setItem('bambi-library',JSON.stringify([...libraryMetadata.values()]));updateSettings();})();
void profileReady.then(()=>{connect();void refreshHealth();const runtimeLoop=new RuntimeLoop(controlTick,frame,{now:()=>performance.now(),hidden:()=>document.hidden,requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:id=>cancelAnimationFrame(id),setTimer:(callback,ms)=>setInterval(callback,ms),clearTimer:id=>clearInterval(id as ReturnType<typeof setInterval>)});runtimeLoop.start();
document.addEventListener('visibilitychange',()=>controlTick(performance.now()));
window.addEventListener('pagehide',()=>runtimeLoop.stop());window.addEventListener('pageshow',()=>runtimeLoop.start());
(window as any).bambi={director,clock,playbackClock,sessionEvents,get audio(){return audio;},get visuals(){return visuals;},hardStop,startSession,ask};});

$<HTMLInputElement>('event-program-file').onchange=async event=>{const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file||director.active||warming)return;try{if(file.size>1000000)throw Error('Event program is too large');const program=ProgramSchema.parse(JSON.parse(await file.text()));if(program.durationMs<60000||program.durationMs>7200000)throw Error('Choose a program between one minute and two hours');importedEventProgram=program;sessionDuration.restore(program.durationMs/1000);$<HTMLInputElement>('session-events').checked=true;updateSettings();$('event-status').textContent=`${program.events.length} authored events loaded`;}catch(error){notice('Event program: '+String(error));input.value='';}};
$('event-program-clear').onclick=()=>{if(director.active||warming)return;importedEventProgram=undefined;$<HTMLInputElement>('event-program-file').value='';$('event-status').textContent='Original development sequence';};

// The sample enters the same local-file player and controls as user imports.
void profileReady.then(async()=>{
 const capabilities=desktopCapabilities;if(!capabilities)return;if(!capabilities.smoke&&!capabilities.alpha)return;
 $('desktop-smoke').hidden=false;
 if(capabilities.alpha){$('desktop-smoke').querySelector('span')!.textContent='Local AI alpha · use Setup to install and prepare';const link=document.createElement('a');link.href='/setup';link.textContent='Set up local AI';$('desktop-smoke').append(link);}
 const applySmoke=()=>{
  $<HTMLSelectElement>('ai-mode').value='off';$<HTMLSelectElement>('mode').value='local';
  $<HTMLInputElement>('narration-enabled').checked=false;$<HTMLInputElement>('session-events').checked=false;
  for(const id of ['mic','immersive-mic']){const node=$<HTMLButtonElement>(id);if(node&&capabilities.smoke){node.disabled=true;node.title='Microphone recognition is unavailable in this smoke build';}}
  updateSettings();
 };
 if(capabilities.smoke)applySmoke();
 $('offline-sample').onclick=async()=>{
  try{hardStop();applySmoke();let index=tracks.findIndex(track=>track.id==='desktop-offline-chimes-v1');
   if(index<0){const bytes=await(await fetch(capabilities.sample)).blob();const file=new File([bytes],'Offline chimes.wav',{type:'audio/wav',lastModified:0});index=tracks.length;tracks.push({id:'desktop-offline-chimes-v1',file,favorite:false,notes:'Original synthetic packaging sample. No speech or private recording.',tags:'offline sample',plays:0,lastPlayed:''});}
   selectTrack(index);navigation.show('session');playerControls.reveal();status('Offline sample loaded. Press Start.');
  }catch(error){notice('Offline sample: '+String(error));}
 };
}).catch(()=>{});
