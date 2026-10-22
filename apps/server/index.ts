// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {validateSettings,migrateStoredSettings,profileMetadata} from '../../packages/settings';
import {ImportSettingsSchema,SettingsFileSchema,selectedFileSettings} from '../../packages/settings/transfer';

import {desktopSmoke,desktopAlpha,desktop,resourcePath} from '../../packages/runtime/paths';
import {desktopSetup,alphaModels,DesktopSetup} from '../../packages/runtime/desktop-setup';
import {desktopServices} from '../../packages/runtime/desktop-services';
import {ModelCalibration,CalibrationProfiles,calibrationModels,calibrationPerformance} from '../../packages/runtime/model-calibration';
import {calibrationContext} from '../../packages/runtime/calibration-context';
import type {RuntimeTuning} from '../../packages/runtime/runtime-tuning.mjs';
import {readFileSync as readCalibrationFile} from 'node:fs';
import {ReplyTraces} from '../../packages/ai/trace';
import {SpokenOutputGate,SpokenContractError} from '../../packages/speech/contract';
import {sceneDraftLook} from '../../packages/session-director/regie/draft';
import {bambiCloudRouter} from './bambicloud';
import {BambiCloudTrackSchema,bambiCloudTrackId} from '../../packages/media/bambicloud';
import { loadEnvFile } from 'node:process';
import { ChatRequestSchema, audioPresetSchema, PROTOCOL_VERSION, modelConnection, type ModelConnection } from '../../packages/ai/request';
import { resolveReplyIntent } from '../../packages/ai/intent';
import { CloudBackend, cloudConfiguration, CLOUD_MODEL_ALIAS } from '../../packages/ai/cloud';
import {LocalEmbeddings} from '../../packages/ai/embeddings';
import {SemanticMemory} from '../../packages/ai/semantic-memory';
import { memoryContext, explicitMemory, sceneMemoryContext } from '../../packages/ai/memory';
import {transcribe} from '../../packages/speech/whisper';
import {StreamingSpeechService} from '../../packages/speech/streaming/service';
import {buildSpeechVocabulary,speechVocabularyPrompt} from '../../packages/speech/vocabulary';
import {triggersForPhase} from '../../packages/session-director/trigger-timing';
import { narrationDeliveryAt, deliverySpeed, deliveryWordBudget, eventDelivery } from '../../packages/session-director/delivery';
import { buildFixedReplyPrompt, buildReplyPrompt } from '../../packages/ai/prompt';
import {languageStyleDirection} from '../../packages/ai/language-style';
import {buildCharacterDocument,buildCharacterPrefix,buildEventNarrationPrefix,eventNarrationMessages} from '../../packages/ai/character';
import {buildSituationalBase} from '../../packages/content/situational';
import {SituationalConversation,SituationalTurnStream,situationalPassageComplete} from '../../packages/ai/situational';
import {SpokenBlockStream,spokenBlockGrammar} from '../../packages/ai/spoken-blocks';
import {replyControlPrefixes} from '../../packages/ai/prompt';
import {replyBlockBudget} from '../../packages/ai/response';
import { EventSpeechRequestSchema, renderEventSpeech, joinWav, wavDurationMs, SpeechWindowError, eventTextGrammar } from '../../packages/session-director/events/speech';
import { compileEvent } from '../../packages/session-director/events/runtime';
import { SceneRequestSchema } from '../../packages/session-director/regie/request';
import { scenePlanningInstruction, planScene, repairRevealAnchor } from '../../packages/session-director/regie/planner';
import {nextStoryMoment} from '../../packages/session-director/regie/story-contract';
import {storyExchange} from '../../packages/session-director/regie/story';
import { synthesisArcs, compileScene, RevealAlignmentError } from '../../packages/session-director/regie/compiler';
import {InferenceResources,speechBatchBoundary,SpeechProgressGuard} from '../../packages/ai/inference';
import {fitContext,estimateChatTokens} from '../../packages/ai/context';
import {preflightReplyContext} from '../../packages/ai/preflight';
import {replyTokenBudget,replyWordBudget,narrationPassageComplete} from '../../packages/ai/response';
import {DualVoiceSession} from '../../packages/speech/dual-voice';
import {triggerAliases} from '../../config/trigger-sequence';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { existsSync, readFileSync, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { analyzeMedia } from '../../packages/media/analysis';
import { resolve } from 'node:path';
import { nativeSamplingModels, communityQwen,communityQwen4B,nativeCheckpointModel,anubisMiniV1,ANUBIS_CONTEXT,modelSampling,nativeModelSampling,modelRuntimeInfo } from '../../packages/ai/models';
import { prepareNativeModel, stopNativeModel, calibrationDevices } from '../../packages/ai/runtime';
import {kvCacheMode} from '../../packages/runtime/kv-cache';
import {dflashMode} from '../../packages/runtime/dflash';
import {ScriptDisplayStream} from '../../packages/speech/script';
import { samplingProfile } from '../../config/sampling';
import { OllamaBackend, LlamaBackend, type Message, type LLMBackend } from '../../packages/ai';
import { ReplyProgress, PlaybackReportSchema, DialogueDisplayStream, spokenHistoryMessages } from '../../packages/ai/dialogue';
import {ListeningInputSchema,decideListening} from '../../packages/ai/listening';
import { ActionStream } from '../../packages/ai/actions';
import {SpeechRenderAhead} from '../../packages/speech/renderer-queue';
import { Kokoro, isMossVoice, mossCapabilities } from '../../packages/speech/tts';
import { Store } from '../../packages/storage';
import {ImportSchema,MAX_BACKUP_BYTES,MAX_PROFILE_BYTES,checkedSize} from '../../packages/profiles/schema';
import { LocalKnowledge } from '../../packages/knowledge';
import { contentCatalog, contentRoot, defaultTriggers, prompts, triggerData } from '../../packages/content';
import { performanceSnapshot, hardwareProfile } from '../../packages/hardware';
import { recommendModels,type ModelRecommendation } from '../../packages/ai/recommendation';
import { modelInventory } from '../../packages/ai/model-inventory';
import {localModelCatalog} from '../../packages/ai/model-catalog';
import {AccessPolicy,AccessChoicesSchema} from '../../packages/safety/access';
import {localContextPrompt} from '../../packages/ai/local-context';
import {approximateIpLocation,IP_LOCATION_PROVIDER} from '../../packages/hardware/ip-location';
import { ActionSchema } from '../../packages/safety/actions';
import { localRequestAllowed } from '../../packages/safety/local-access';
import {DeviceController} from '../../packages/devices/controller';
import {LocalBLEBridge} from '../../packages/devices/bridge';
import {devicePrompt} from '../../packages/devices/commands';
import { localSoundCatalog, localSoundFiles, type LocalSoundId } from '../../packages/audio/local-sounds';
if(!desktop&&existsSync('.env.cloud'))loadEnvFile('.env.cloud');
const cloudConfig=desktop?null:cloudConfiguration(),cloud=cloudConfig?new CloudBackend(cloudConfig,{signal:()=>access.signal('cloudAI')}):null;
const modelConnections:Record<string,ModelConnection>=cloudConfig?{[CLOUD_MODEL_ALIAS]:{backend:'cloud' as const,context:cloudConfig.context}}:{};
if(desktopAlpha)for(const model of localModelCatalog.filter(m=>m.desktopSupported))modelConnections[model.alias]={backend:'llama.cpp',context:model.context};
modelConnections[anubisMiniV1]={backend:'llama.cpp',context:ANUBIS_CONTEXT};
const backendFor=(model:string,requested?:string):LLMBackend=>{if(desktopAlpha){if(model!==desktopSetup!.model||requested&&requested!=='llama.cpp')throw Error('Select the verified desktop model.');return llama;}if(model===CLOUD_MODEL_ALIAS){access.require('cloudAI');if(!cloud)throw Error('Cloud inference has not been configured');return cloud;}if(requested==='cloud')throw Error('Unknown cloud model');return requested==='llama.cpp'||nativeSamplingModels.includes(model)?llama:ollama;};
const app=express(),server=createServer(app),wss=new WebSocketServer({noServer:true,maxPayload:128*1024});
const store=new Store(process.env.BAMBI_DATABASE||undefined),knowledge=new LocalKnowledge(),ollama=new OllamaBackend(),llama=new LlamaBackend(),kokoro=new Kokoro(process.env.BAMBI_TTS_URL||undefined);
const access=new AccessPolicy(store);
const inference=new InferenceResources(),traces=new ReplyTraces(),sceneTraces=new ReplyTraces();
const calibration=new ModelCalibration(),calibrationProfiles=new CalibrationProfiles(resolve('runtime/model-calibration.json'));
let calibrationAdmission=false;
let calibrationAdmissionController:AbortController|null=null;
const calibrationState=()=>calibrationAdmission?{...calibration.state,phase:'running' as const,model:(store.get('profile',{}) as Record<string,unknown>).model,configuration:0,configurations:4,turn:0,stage:'checking-installed-files'}:{...calibration.state,comparisons:[...(calibration.state.profiles??[]).map(profile=>({model:profile.model,performance:calibrationPerformance(profile),...(profile.winner===null?{error:'No configuration passed the repeat test.'}:{})})),...(calibration.state.modelErrors??[]).filter(item=>!calibration.state.profiles?.some(profile=>profile.model===item.model)).map(item=>({...item,performance:null}))]};
const semanticMemory=new SemanticMemory(store,new LocalEmbeddings(resolve('.runtime/memory-models')),{onError:error=>store.metric('memory.retrieval-error',{error:String(error)})});void semanticMemory.index();
const devices=new DeviceController(undefined,undefined,undefined,true,()=>access.allowed('devices')),bleBridge=new LocalBLEBridge();
const savedProfile=store.get('profile',{}) as Record<string,unknown>;
const startupSettings=migrateStoredSettings(savedProfile);
if(!startupSettings['prompt-template']){
 Object.assign(startupSettings,{'prompt-template':'bambisleep-classic','bambi-name':startupSettings['bambi-name']??'Bambi','trigger-selection':startupSettings['trigger-selection']??JSON.stringify(defaultTriggers),'response-length':startupSettings['response-length']??'2048',scene:startupSettings.scene??'Spiral Focus'});
 store.beginConversation();
}
if(typeof startupSettings['narration-enabled']!=='boolean')Object.assign(startupSettings,{'narration-enabled':!desktopSmoke,'session-events':startupSettings['session-events']??!desktopSmoke,'conversation-style':startupSettings['conversation-style']??'reactive',mode:startupSettings.mode??(desktopSmoke?'local':'conversation'),'ai-mode':startupSettings['ai-mode']??(desktopSmoke?'off':'voice')});
if(!startupSettings.speed)startupSettings.speed='0.78';
if(!startupSettings.model)startupSettings.model=cloud&&process.env.BAMBI_CLOUD_DEFAULT==='true'?CLOUD_MODEL_ALIAS:communityQwen;
// Startup migrations preserve valid explicit choices and participate in the same revision contract.
if(JSON.stringify(savedProfile)!==JSON.stringify({...startupSettings,...profileMetadata}))store.saveSettings(store.settingsSnapshot().revision,validateSettings(startupSettings));
const audioPresets=Object.fromEntries(['bambi_local_clean','bambi_classic','bambi_classic_deep','bambi_voice_test'].map(id=>[id,JSON.parse(readFileSync(resourcePath('presets/audio',id+'.json'),'utf8'))]));

const streamingSpeech=new StreamingSpeechService();
const speechSockets=new WebSocketServer({noServer:true,maxPayload:16384});
speechSockets.on('connection',socket=>{if(!access.allowed('microphone')){socket.close(1008,'Microphone access is disabled.');return;}streamingSpeech.attach(socket);});
const port=z.coerce.number().int().min(1024).max(65535).parse(process.env.BAMBI_PORT||6969);
app.disable('x-powered-by');
app.use((req,res,next)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Frame-Options','DENY');
 if(req.path.startsWith('/api/')||req.path.startsWith('/health/'))res.setHeader('Cache-Control','no-store');
 if(!localRequestAllowed(req.headers,port)){res.status(403).json({error:'Local companion origin required'});return;}next();
});
// Only a selected offline restore needs a larger body; ordinary APIs stay bounded.
app.use('/api/profiles/import',express.json({limit:MAX_BACKUP_BYTES+4096}));
app.use(express.json({limit:'128kb'}));
// Enforce optional feature choices for direct HTTP callers as well as UI controls.
app.use((req,res,next)=>{
 if((calibration.busy||calibrationAdmission)&&!['GET','HEAD'].includes(req.method)&&!['/api/models/calibration/cancel','/api/models/setup/cancel','/api/access','/api/panic','/api/desktop/shutdown','/api/models/onboarding'].includes(req.path)){res.status(409).json({error:'A local AI performance test is running. Cancel it before starting other work.'});return;}
 const permission=req.path==='/api/transcribe'?'microphone':
  /^\/api\/devices\/(?:scan|connect)$/.test(req.path)?'devices':
  req.path.startsWith('/api/bambicloud/')?'onlineMedia':
  req.method==='POST'&&['/api/models/setup/install','/api/desktop/setup/install'].includes(req.path)?'modelDownloads':null;
 if(permission&&!access.allowed(permission)){res.status(403).json({error:`Allow this feature in Privacy & access first.`,permission});return;}
 if(permission==='onlineMedia'){
  const signal=access.signal('onlineMedia'),close=()=>res.destroy();signal.addEventListener('abort',close,{once:true});res.on('close',()=>signal.removeEventListener('abort',close));
 }
 next();
});
app.get('/api/access',(_req,res)=>res.json(access.snapshot()));
let accessSaving=false;
app.put('/api/access',async(req,res)=>{
 const parsed=AccessChoicesSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid access choices.'});return;}
 if(accessSaving){res.status(409).json({error:'Access choices are being saved. Try again in a moment.'});return;}accessSaving=true;
 try{
  const record=access.update(parsed.data,revoked=>{if(revoked.includes('devices'))devices.stop();});
  healthTime=0;
  if(!record.choices.microphone){streamingSpeech.close();for(const controller of listeningControllers)controller.abort();for(const socket of speechSockets.clients)socket.close(1008,'Microphone access is disabled.');}
  if(!record.choices.devices)await bleBridge.disconnect();
  // Discard prepared replies so revoked context cannot be emitted by a pending contribution.
  for(const ws of wss.clients){cancel(ws,'access-changed');send(ws,{type:'access-changed',access:record});}
  for(const controller of eventRenderControllers)controller.abort();if(calibration.busy||calibrationAdmission)modelSetup?.cancel();calibrationAdmissionController?.abort();calibration.cancel();
  res.json(record);
 }catch{res.status(500).json({error:'Access choices could not be saved. Try again.'});}finally{accessSaving=false;}
});
app.get('/api/access/location/provider',(_req,res)=>res.json({...IP_LOCATION_PROVIDER,automatic:false}));
let locating=false,lastLocationRequest=0,locationController:AbortController|null=null;
app.post('/api/access/location',async(_req,res)=>{
 if(!access.allowed('approximateLocation')){res.status(403).json({error:'Allow approximate IP location in Privacy & access first.',permission:'approximateLocation'});return;}
 if(locating||Date.now()-lastLocationRequest<30000){res.status(429).json({error:'Wait a moment before requesting the IP location again.'});return;}
 locating=true;lastLocationRequest=Date.now();
 const controller=new AbortController();locationController=controller;res.on('close',()=>controller.abort());
 try{const place=await approximateIpLocation(AbortSignal.any([controller.signal,access.signal('approximateLocation')]));controller.signal.throwIfAborted();access.setPlace(place);res.json({place});}
 catch{if(!res.headersSent&&!res.destroyed)res.status(503).json({error:'The approximate IP location could not be determined. Try again later. No new location was saved.'});}
 finally{locating=false;locationController=null;}
});
app.delete('/api/access/location',(_req,res)=>{locationController?.abort();access.clearPlace();for(const ws of wss.clients){cancel(ws,'location-cleared');send(ws,{type:'access-changed',access:access.snapshot()});}for(const controller of eventRenderControllers)controller.abort();res.json(access.snapshot());});
// Unqualified services cannot spawn tools, probe or reuse unrelated local services.
if(desktop){
 app.use((req,res,next)=>{
  if((desktopSmoke&&/^\/api\/(?:warm|listen|events|trigger-preview|voice-lab)(?:\/|$)/.test(req.path))||/^\/api\/(?:transcribe|analyze|devices|bambicloud)(?:\/|$)/.test(req.path)){
   res.status(503).json({error:'This packaging smoke build includes offline playback. AI, speech, devices and online media are not installed or qualified.'});return;
  }next();
 });
 app.get('/api/desktop/identity',(req,res)=>{
  if(req.headers['x-bambi-instance']!==process.env.BAMBI_INSTANCE_TOKEN){res.status(403).end();return;}
  res.json({app:'bambi-local',service:'backend',desktopProtocol:1,pid:process.pid,node:process.version,instance:process.env.BAMBI_INSTANCE_TOKEN});
 });
 app.get('/api/desktop/capabilities',(_req,res)=>res.json({smoke:desktopSmoke,alpha:desktopAlpha,sample:'/samples/offline-chimes.wav',ai:!!desktopSetup?.verified,speech:desktopServices.speechReady,runtime:desktopAlpha?desktopServices.capabilities:undefined,devices:false}));
 app.post('/api/desktop/shutdown',(req,res)=>{
  if(req.headers['x-bambi-instance']!==process.env.BAMBI_INSTANCE_TOKEN){res.status(403).end();return;}
  res.json({ok:true});setImmediate(()=>process.emit('SIGTERM'));
 });
 if(desktopAlpha){
  void desktopSetup!.check();
  app.get('/api/desktop/setup',(_req,res)=>res.json(desktopSetup!.snapshot));
  app.post('/api/desktop/setup/install',(_req,res)=>{if(['downloading','verifying','preparing'].includes(desktopSetup!.state.phase)){res.status(409).json({error:'Setup is busy.'});return;}void desktopSetup!.install(undefined,access.signal('modelDownloads'));res.json({ok:true});});
  app.post('/api/desktop/setup/copy',(req,res)=>{if(!process.env.BAMBI_INSTANCE_TOKEN||req.headers['x-bambi-instance']!==process.env.BAMBI_INSTANCE_TOKEN){res.status(403).end();return;}if(typeof req.body.directory!=='string'||req.body.directory.length>4096){res.status(400).end();return;}if(['downloading','verifying','preparing'].includes(desktopSetup!.state.phase)){res.status(409).json({error:'Setup is busy.'});return;}void desktopSetup!.install(req.body.directory);res.json({ok:true});});
  app.get('/api/desktop/setup/sources',async(_req,res)=>{try{res.json({sources:await desktopSetup!.sources.list()});}catch{res.status(503).json({error:'Saved model locations could not be checked.'});}});
  app.post('/api/desktop/setup/sources',async(req,res)=>{
   if(!process.env.BAMBI_INSTANCE_TOKEN||req.headers['x-bambi-instance']!==process.env.BAMBI_INSTANCE_TOKEN){res.status(403).json({error:'Choose model files using the app’s file dialog.'});return;}
   const parsed=z.object({path:z.string().min(1).max(4096),kind:z.enum(['file','folder'])}).strict().safeParse(req.body);
   if(!parsed.success){res.status(400).json({error:'Choose a GGUF file or a model folder.'});return;}
   try{const id=await desktopSetup!.sources.add(parsed.data.path,parsed.data.kind);res.json({id,sources:await desktopSetup!.sources.list()});}catch(error){res.status(400).json({error:String(error)});}
  });
  app.delete('/api/desktop/setup/sources/:id',async(req,res)=>{try{await desktopSetup!.sources.remove(req.params.id);res.json({ok:true});}catch{res.status(503).json({error:'The saved model location could not be removed.'});}});
  app.post('/api/desktop/setup/import',async(req,res)=>{
   const parsed=z.object({source:z.string().uuid()}).strict().safeParse(req.body);
   if(!parsed.success){res.status(400).json({error:'Choose a saved model location.'});return;}
   if(desktopSetup!.busy||active.size||listeningControllers.size||eventRenderControllers.size){res.status(409).json({error:'Finish or cancel the active setup or session first.'});return;}
   try{const source=await desktopSetup!.sources.find(parsed.data.source,desktopSetup!.model);if(desktopSetup!.busy||active.size||listeningControllers.size||eventRenderControllers.size){res.status(409).json({error:'Finish or cancel the active setup or session first.'});return;}void desktopSetup!.install(source.root,undefined,source.modelFile);res.json({ok:true});}catch(error){res.status(400).json({error:String(error)});}
  });
  app.post('/api/desktop/setup/cancel',(_req,res)=>{desktopSetup!.cancel();res.json({ok:true});});
  app.post('/api/desktop/setup/prepare',async(_req,res)=>{const controller=new AbortController();res.on('close',()=>controller.abort());try{await inference.local.run(async()=>{if(calibration.busy||calibrationAdmission)throw Error('Cancel the performance test before starting local AI.');await prepareConfiguredNativeModel(desktopSetup!.model,desktopSetup!.context,controller.signal);},controller.signal);healthTime=0;res.json({ok:true});}catch(error){res.status(503).json({error:String(error)});}});
 }
}
app.use('/api/bambicloud',bambiCloudRouter());
app.get('/api/diagnostics/replies',(_req,res)=>res.json({clock:"server-relative milliseconds",replies:traces.snapshot()}));
app.get('/api/diagnostics/scenes',(_req,res)=>res.json({clock:'server-relative milliseconds',scenes:sceneTraces.snapshot()}));
let healthCache:unknown=null,healthTime=0;
async function health(){
 if(Date.now()-healthTime<4000&&healthCache)return healthCache;
 if(desktopSmoke)return {protocolVersion:PROTOCOL_VERSION,desktopSmoke:true,modelConnections:{},cloud:{configured:false,ready:false},web:true,database:true,audio:'browser',ollama:false,kokoro:false,streamingSpeech:false,whisper:false,models:[],voices:[],llamaModels:[],localSounds:[],audioPresets,speechCapabilities:{},hardware:performanceSnapshot(),kvCache:kvCacheStatus(),dflash:dflashStatus(),contentProfile:store.get('profile',{}),knowledgeChunks:knowledge.chunks.length};
 if(desktopAlpha){const voices=desktopServices.speechReady?await kokoro.voices().catch(()=>[]):[];const models=desktopSetup!.verified?[desktopSetup!.model]:[];return {protocolVersion:PROTOCOL_VERSION,desktopAlpha:true,setup:desktopSetup!.snapshot,runtime:desktopServices.capabilities,modelConnections,web:true,database:true,audio:'browser',cloud:{configured:false,ready:false},ollama:false,whisper:false,kokoro:voices.length>0,voices,streamingSpeech:desktopSetup!.verified&&streamingSpeech.available,models,llamaModels:desktopServices.modelReady?models:[],selectedModel:desktopSetup!.model,selectedBackend:'llama.cpp',audioPresets,speechCapabilities:kokoro.capabilities,hardware:performanceSnapshot(),kvCache:kvCacheStatus(),dflash:dflashStatus(),contentProfile:store.get('profile',{}),knowledgeChunks:knowledge.chunks.length,localSounds:[]};}
 const results=await Promise.allSettled([
  fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(2500)}).then(async response=>{if(!response.ok)throw Error('Ollama unavailable');return response.json() as Promise<{models?:{name:string;size?:number}[]}>}),
  kokoro.voices(),llama.models(),fetch('http://127.0.0.1:8081/',{signal:AbortSignal.timeout(1800)}).then(r=>r.ok),cloud&&access.allowed('cloudAI')?cloud.models():Promise.resolve([]),hardwareProfile()
 ]);
 const ollamaTags=results[0].status==='fulfilled'&&Array.isArray(results[0].value.models)?results[0].value.models:[];
 const ollamaModels=ollamaTags.map(model=>model.name).filter((name):name is string=>typeof name==='string');
 const nativePins=['docs/community-models.json','docs/qwen36-model.json','docs/comparison-models.json','docs/anubis-model.json'].filter(existsSync).flatMap(path=>{const value=JSON.parse(readFileSync(path,'utf8'));return Array.isArray(value)?value:[value];});
 const installed=modelInventory({models:ollamaTags});
 const models=[...new Set([...ollamaModels,...installed.filter(model=>model.installed&&model.backend==='llama.cpp').map(model=>model.id),...nativePins.filter(m=>nativeSamplingModels.includes(m.alias)&&existsSync(resolve('models/community',m.file))).map(m=>m.alias)])];
 const cloudReady=results[4].status==='fulfilled'&&results[4].value.length>0;if(cloudConfig)models.push(CLOUD_MODEL_ALIAS);
 const voices=results[1].status==='fulfilled'?results[1].value:[];const llamaModels=results[2].status==='fulfilled'?results[2].value:[];
 const hardware=results[5].status==='fulfilled'?results[5].value:{platform:'unknown',architecture:'unknown',cpu:'Unknown',cpuThreads:0,ramTotal:0,ramAvailable:0,unifiedMemory:false,gpus:[],warnings:['Hardware detection unavailable.']};
 const recommendation=recommendModels(hardware,installed,{ollama:ollamaModels.length>0,native:llamaModels.length>0});
 const saved=store.get('profile',{}) as Record<string,string>,preferredModel=saved.model||communityQwen,profile=saved['sampling-profile']==='creative'?'creative':'qwen';
 const reportedSampling=preferredModel.startsWith('cloud:')?samplingProfile(profile):nativeSamplingModels.includes(preferredModel)?nativeModelSampling(preferredModel,profile):modelSampling(preferredModel,profile);
 healthCache={protocolVersion:PROTOCOL_VERSION,modelConnections,modelLabels:cloudConfig?{[CLOUD_MODEL_ALIAS]:cloudConfig.model+' · Remote'}:{},cloud:{configured:!!cloud,ready:cloudReady,model:cloudConfig?.model},web:true,ollama:ollamaModels.length>0,kokoro:voices.length>0,streamingSpeech:streamingSpeech.available,whisper:results[3].status==='fulfilled'&&results[3].value===true,database:true,audio:'browser',models,voices,audioPresets,speechCapabilities:kokoro.capabilities,voiceCapabilities:Object.fromEntries(voices.map((voice:string)=>[voice,isMossVoice(voice)?mossCapabilities:kokoro.capabilities])),ttsRuntime:'kokoro-onnx CPU offline',localSounds:localSoundCatalog().assets.filter(asset=>asset.status==='available'&&asset.url).map(asset=>asset.id),llamaModels,selectedModel:process.env.BAMBI_CLOUD_DEFAULT==='true'&&cloud?CLOUD_MODEL_ALIAS:(store.get('profile',{}) as Record<string,string>).model||communityQwen,kvCache:kvCacheStatus(),dflash:dflashStatus(),contentProfile:store.get('profile',{}),sampling:{...reportedSampling,context:modelConnection(preferredModel,'bambisleep-classic',modelConnections).context},modelRuntimeInfo:Object.fromEntries(models.map(model=>[model,modelRuntimeInfo(model)]).filter(([,info])=>info)),selectedBackend:modelConnection((store.get('profile',{}) as Record<string,string>).model||communityQwen,'bambisleep-classic',modelConnections).backend,hardware:performanceSnapshot(),hardwareProfile:hardware,modelRecommendation:recommendation,knowledgeChunks:knowledge.chunks.length};
 healthTime=Date.now();return healthCache;
}
app.get('/api/health',async(_req,res)=>res.json(await health()));
const modelSetup=desktopSetup??(!desktop?new DesktopSetup(resolve('models'),[],false):null);
app.get('/api/models/onboarding',(_req,res)=>res.json({done:store.get('model-onboarding',false)}));
app.post('/api/models/onboarding',(_req,res)=>{store.set('model-onboarding',true);res.json({ok:true});});
app.get('/api/models/catalog',async(req,res)=>{
 try{
  const hardware=await hardwareProfile(req.query.refresh==='1');
  const current=await health() as {models?:string[];ollama?:boolean;llamaModels?:string[];selectedModel?:string;modelRecommendation?:ModelRecommendation};
  const candidates=modelInventory({models:desktop?[]:(current.models??[]).filter(name=>!name.startsWith('cloud:')).map(name=>({name,size:current.modelRecommendation?.alternatives.find(model=>model.id===name)?.weightsBytes??undefined}))},{desktop,directory:modelSetup?.directory,installedModel:modelSetup?.model,verified:modelSetup?.verified});
  const recommendation=recommendModels(hardware,candidates,{ollama:!!current.ollama,native:desktopAlpha||!!current.llamaModels?.length,platformReady:desktopAlpha?true:desktopSmoke?false:undefined});
  res.json({...recommendation,desktop,downloadsAvailable:!!modelSetup,buildMode:desktopSmoke?'smoke':desktopAlpha?'alpha':'development',selectedModel:desktop?modelSetup?.model:current.selectedModel,setup:modelSetup?{...modelSetup.snapshot,calibration:calibrationState()}:null,speechBytes:desktopAlpha?alphaModels.assets.slice(1).reduce((n,a)=>n+a.bytes,0):0});
 }catch{res.status(503).json({error:'Hardware and model information could not be loaded. Try again.'});}
});
app.get('/api/models/setup',(_req,res)=>res.json(modelSetup?{...modelSetup.snapshot,calibration:calibrationState()}:null));
function calibrationEndpoint(url:string,expectedPort:number){try{const value=new URL(url);return value.protocol==='http:'&&['127.0.0.1','localhost'].includes(value.hostname)&&value.port===String(expectedPort)&&value.pathname==='/'&&!value.search&&!value.username&&!value.password;}catch{return false;}}
async function measuredProfile(model:string,profile:Record<string,unknown>){
 if(!desktopAlpha&&!calibrationEndpoint(llama.url,8080))return null;
 if(!(await calibrationProfiles.list()).some(item=>item.model===model))return null;
 const contexts=await Promise.allSettled([calibrationContext(model,profile,true),calibrationContext(model,profile,false)]);
 for(const context of contexts)if(context.status==='fulfilled'){const saved=await calibrationProfiles.find(context.value.input.key);if(saved&&calibrationPerformance(saved))return saved;}
 return null;
}
app.get('/api/models/calibration',async(_req,res)=>{
 const model=(store.get('profile',{}) as Record<string,unknown>).model;
 let measured=null;
 if(typeof model==='string'&&calibrationModels.includes(model))try{measured=await measuredProfile(model,store.get('profile',{}) as Record<string,unknown>);}catch{}
 const saved=await Promise.allSettled(calibrationModels.map(async alias=>{const result=await measuredProfile(alias,store.get('profile',{}) as Record<string,unknown>);return result?{model:alias,performance:calibrationPerformance(result),profile:result}:null;}));
 const comparisons=saved.flatMap(result=>result.status==='fulfilled'&&result.value?[result.value]:[]);
 res.json({...calibrationState(),savedComparisons:comparisons.map(({profile,...result})=>result),savedProfiles:comparisons.map(result=>result.profile),supported:!desktopSmoke&&(desktopAlpha||process.platform==='linux'&&process.arch==='x64'),measured:measured?calibrationPerformance(measured):null});
});
app.post('/api/models/calibration',async(req,res)=>{
 const modelId=z.enum(calibrationModels as [string,...string[]]);
 const parsed=z.object({model:modelId,models:z.array(modelId).min(1).max(calibrationModels.length).optional(),experimental:z.array(modelId).max(calibrationModels.length).default([]),tryAnyway:z.array(modelId).max(calibrationModels.length).default([]),speech:z.boolean().default(true)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Choose installed, supported catalog models.'});return;}
 if(desktopSmoke||!desktopAlpha&&(process.platform!=='linux'||process.arch!=='x64')){res.status(400).json({error:'Performance testing is unavailable in this build.'});return;}
 if(calibration.busy||calibrationAdmission||modelSetup?.busy||active.size||listeningControllers.size||eventRenderControllers.size||transcribing||speechSockets.clients.size||devices.status.enabled){res.status(409).json({error:'Finish setup and stop conversation, microphone, devices and session work before testing.'});return;}
 calibrationAdmission=true;
 const admission=new AbortController();calibrationAdmissionController=admission;
 const original=parsed.data.model,originalTrial=modelSetup?.model===original&&modelSetup.tryAnyway===true;
 let launched=false;
 const restore=async()=>{if(!modelSetup||modelSetup.model===original)return;await inference.local.run(async()=>{await stopNativeModel();await modelSetup.select(original,originalTrial);healthTime=0;},AbortSignal.timeout(180000));};
 try{
  const profile=store.get('profile',{}) as Record<string,unknown>,models=parsed.data.models??[original];
  if(new Set(models).size!==models.length)throw Error('Choose each model once.');
  if(!desktopAlpha&&(!calibrationEndpoint(llama.url,8080)||parsed.data.speech&&!calibrationEndpoint(kokoro.url,8882)))throw Error('Performance testing requires the app-owned local model and voice endpoints. Custom endpoints cannot calibrate this PC.');
  if(profile.model!==original)throw Error('Select this model before starting its performance test.');
  const contexts=new Map<string,Awaited<ReturnType<typeof calibrationContext>>>();
  for(const model of models){
   if(model!==original&&localModelCatalog.find(pin=>pin.alias===model)?.qualification==='experimental'&&!parsed.data.experimental.includes(model))throw Error('Confirm each experimental comparison model.');
   if(kvCacheMode(profile['q8-kv-cache'],model,process.platform)!=='default'||dflashMode(profile['dflash-4b'],model,process.platform)!=='off')throw Error('Turn off experimental KV cache and DFlash before testing the baseline setup.');
   const context=await calibrationContext(model,profile,parsed.data.speech);admission.signal.throwIfAborted();
   const trial=parsed.data.tryAnyway.includes(model)||model===original&&originalTrial;
   await inference.local.run(async()=>{admission.signal.throwIfAborted();await modelSetup!.select(model,trial);admission.signal.throwIfAborted();if(!modelSetup!.verified)await modelSetup!.check();},admission.signal);
   admission.signal.throwIfAborted();if(!modelSetup!.verified)throw Error('Install and verify '+model+' before comparing it. No downloads were started.');
   contexts.set(model,context);
  }
  if(active.size||listeningControllers.size||eventRenderControllers.size||transcribing||speechSockets.clients.size||devices.status.enabled)throw Error('Local work started while checking the setup. Stop it before testing.');
  const first=contexts.values().next().value!;
  if(parsed.data.speech&&!desktopAlpha&&!(await kokoro.voices()).includes(first.settings.voice))throw Error('Start the selected local voice before testing speech. You can choose a text-only test.');
  admission.signal.throwIfAborted();
  calibration.start([...contexts.values()].map(context=>context.input),input=>{
   const context=contexts.get(input.model)!;
   return {
    exclusive:(work,signal)=>inference.local.run(work,signal,-20),
    devices:signal=>calibrationDevices(input.context,signal),
    prepare:async(tuning,signal)=>{signal.throwIfAborted();await modelSetup!.select(input.model,parsed.data.tryAnyway.includes(input.model)||input.model===original&&originalTrial);signal.throwIfAborted();await prepareNativeModel(input.model,input.context,signal,'default','off',tuning);},
    stop:()=>stopNativeModel(),backend:llama,
    capabilities:()=>{if(desktopAlpha){const value=desktopServices.capabilities;return {backend:value.backend,cudaVersion:value.cudaVersion,device:value.deviceName,offloadedLayers:value.offloadedLayers};}try{const value=JSON.parse(readCalibrationFile('runtime/owned-processes.json','utf8')).llama?.acceleration;return {backend:value?.backend??null,cudaVersion:value?.cudaVersion,device:value?.deviceName,offloadedLayers:value?.offloadedLayers};}catch{return {backend:null};}},
    memory:()=>({available:performanceSnapshot().ramFree}),
    speech:async(signal,text)=>{for await(const chunk of kokoro.speak(text,context.settings.voice,context.settings.speed,signal,context.settings.preset)){if(chunk.audio&&chunk.text?.trim())return;}throw Error('No speech audio was produced.');},
    save:async(value,signal)=>{const current=await calibrationContext(input.model,profile,parsed.data.speech);if(current.input.key!==input.key)throw Error('Runtime or companion settings changed during measurement. Run the test again.');await calibrationProfiles.save(value,signal);},
   };
  },models.length>1||modelSetup!.model!==original?restore:undefined);launched=true;res.json({ok:true});
 }catch(error){if(!launched)try{await restore();}catch{res.status(500).json({error:'The comparison stopped, but restoring the original selection failed. Reopen model setup.'});return;}res.status(400).json({error:error instanceof Error?error.message:'Performance test could not start.'});}
 finally{calibrationAdmission=false;calibrationAdmissionController=null;healthTime=0;}
});
app.post('/api/models/calibration/cancel',(_req,res)=>{if(calibration.busy||calibrationAdmission)modelSetup?.cancel();calibrationAdmissionController?.abort(Error('Performance test cancelled.'));calibration.cancel();res.json({ok:true});});
app.post('/api/models/select',async(req,res)=>{
 const parsed=z.object({model:z.string().min(1).max(200),experimental:z.boolean().optional(),tryAnyway:z.boolean().optional()}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Choose a model from the catalog.'});return;}
 if(!modelSetup){res.status(503).json({error:'Model installation is unavailable in this smoke build.'});return;}
 if(active.size||listeningControllers.size||eventRenderControllers.size){res.status(409).json({error:'End the current conversation or session before changing models.'});return;}
 if(!desktop){
  const current=await health() as {models?:string[]};
  const candidate=modelInventory({models:(current.models??[]).map(name=>({name}))}).find(model=>model.id===parsed.data.model);
  if(candidate?.installed&&candidate.promptCompatible!==false){const snapshot=store.settingsSnapshot();store.saveSettings(snapshot.revision,{...snapshot.settings,model:candidate.id});healthTime=0;res.json({ok:true,model:candidate.id});return;}
 }
 const model=localModelCatalog.find(m=>m.alias===parsed.data.model);
 if(model?.qualification==='experimental'&&!parsed.data.experimental){res.status(400).json({error:'Confirm the experimental model before selecting it.'});return;}
 try{await modelSetup.select(parsed.data.model,parsed.data.tryAnyway??false);const snapshot=store.settingsSnapshot();store.saveSettings(snapshot.revision,{...snapshot.settings,model:modelSetup.model});healthTime=0;res.json({ok:true,model:modelSetup.model,tryAnyway:modelSetup.tryAnyway});}
 catch(error){res.status(modelSetup.busy?409:400).json({error:String(error)});}
});
app.post('/api/models/setup/install',(_req,res)=>{
 if(!modelSetup){res.status(503).json({error:'Downloads are unavailable in this build.'});return;}
 if(modelSetup.busy){res.status(409).json({error:'Setup is busy. Wait or cancel it first.'});return;}
 if(active.size||listeningControllers.size||eventRenderControllers.size){res.status(409).json({error:'End the conversation or session before installing model data.'});return;}
 void modelSetup.install(undefined,access.signal('modelDownloads'));res.json({ok:true});
});
app.post('/api/models/setup/cancel',(_req,res)=>{calibrationAdmissionController?.abort(Error('Performance test cancelled.'));calibration.cancel();modelSetup?.cancel();res.json({ok:true});});

app.get('/api/devices/status',(_req,res)=>res.json({...devices.status,bleSetup:bleBridge.supported,bridgeProcess:bleBridge.status}));
app.get('/api/devices/scan',async(_req,res)=>{try{res.json({devices:await bleBridge.scan()});}catch(error){res.status(503).json({error:String(error)});}});
app.post('/api/devices/connect',async(req,res)=>{devices.stop();try{res.json(await bleBridge.connect(req.body));}catch(error){res.status(503).json({error:String(error)});}});
app.post('/api/devices/disconnect',async(_req,res)=>{devices.stop();const snapshot=store.settingsSnapshot();store.saveSettings(snapshot.revision,{...snapshot.settings,'device-auto-connect':false});await bleBridge.disconnect();res.json({ok:true});});
for(const name of ['web','ollama','kokoro','whisper','database','audio'])app.get('/health/'+name,async(_req,res)=>{const h=await health() as Record<string,unknown>;res.status(h[name]?200:503).json({service:name,status:h[name]});});

app.post('/api/warm',async(req,res)=>{
 const d=chatSchema.pick({model:true,voice:true,speed:true,preset:true,speak:true,sampling:true,promptId:true,username:true,selectedTriggers:true,collar:true,collarName:true,persona:true,narrationStyle:true,soundDesign:true,dualVoice:true,nsfw:true,rawRoleplay:true,adaptiveDelivery:true,context:true,maxTokens:true,interaction:true,conversationTopic:true}).extend({narration:z.boolean().default(true)}).safeParse(req.body);
 if(!d.success){res.status(400).json({error:'Invalid warmup'});return;}
 const controller=new AbortController();res.on('close',()=>controller.abort());
 // A measured full Classic prefix takes over two minutes even on a modern
 // CPU. Keep native cold preparation bounded without cutting its prompt.
 const timeoutMs=d.data.model===CLOUD_MODEL_ALIAS&&cloudConfig?cloudConfig.timeoutMs:nativeSamplingModels.includes(d.data.model)?600000:120000;
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]);
 try{
  const data={...d.data,...modelConnection(d.data.model,d.data.promptId,modelConnections)},backend=backendFor(data.model);
  // Keep model selection, budget checks, prefix preparation and voice probing
  // in one slot so a concurrent request cannot switch runtimes between stages.
  const contextCheck=await inference.forBackend(backend).run(async()=>{
   const localReplyActive=[...active.values()].some(job=>job.backend!=='cloud');
   if(backend!==cloud&&localReplyActive)throw Error('A local reply is still active. Finish or stop it before preparing a model.');
   if(backend===llama)await prepareConfiguredNativeModel(data.model,data.context,signal);
   else if(backend===ollama)await stopNativeModel(signal);
   const authoredBase=buildCharacterDocument(data).core;
   const base=data.interaction==='situational'?buildSituationalBase(data,authoredBase):authoredBase;
   const prompt=buildFixedReplyPrompt(base,data.interaction,data);
   const count=(messages:Message[])=>backend.countTokens?backend.countTokens(messages,signal):Promise.resolve(estimateChatTokens(messages));
   const checkpointPrefix=backend===llama&&nativeCheckpointModel(data.model)?prompt:undefined;
   const budgets=await preflightReplyContext(base,{...data,safetyTokens:backend.countTokens?256:512,tokenCount:backend.countTokens?'exact':'estimate',checkpointPrefix},count);
   const plan=await fitContext(prompt,[],'Ready.',count,data.context,1,backend.countTokens?256:512,1,'',{checkpointPrefix});
   for await(const _ of backend.stream(plan.messages,data.model,signal,data.context,1,data.sampling)){}
   if(data.speak){for await(const _ of kokoro.speak('Ready.',data.voice,data.speed,signal,data.preset)){}}
   return {tokenCount:backend.countTokens?'exact':'estimate',fixedPromptHash:createHash('sha256').update(prompt).digest('hex'),budgets};
  },signal,-10);
  res.json({ok:true,contextCheck,model:data.model,interaction:data.interaction,runtime:modelRuntimeInfo(data.model)});
 }catch(e){if(!res.headersSent&&!controller.signal.aborted)res.status(503).json({error:e instanceof Error?e.message:'AI preparation failed.'});}
});

// Voice Lab uses the same fixed local speech service; no cloud routing or keys.
app.get('/voice-lab',(_req,res)=>res.sendFile('voice-lab.html',{root:resourcePath(existsSync(resourcePath('dist/web/voice-lab.html'))?'dist/web':'apps/web/public')}));
app.post('/api/trigger-preview',async(req,res)=>{const parsed=z.object({trigger:z.string().max(100),voice:z.string().max(150),speed:z.number().min(.5).max(1.5),preset:audioPresetSchema}).safeParse(req.body);if(!parsed.success||!triggerAliases.includes(parsed.data.trigger.toUpperCase())){res.status(400).json({error:'Invalid trigger preview'});return;}const controller=new AbortController();res.on('close',()=>controller.abort());try{for await(const chunk of kokoro.speak(parsed.data.trigger,parsed.data.voice,parsed.data.speed,controller.signal,parsed.data.preset,triggerAliases)){res.json(chunk);return;}res.status(503).json({error:'No speech audio available'});}catch(error){if(!res.headersSent&&!controller.signal.aborted)res.status(503).json({error:'Local sound preview unavailable: '+String(error)});}});
app.get('/api/local-sounds/catalog',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json(localSoundCatalog());});
app.get('/api/local-sounds/:id.wav',(req,res)=>{const asset=localSoundCatalog().assets.find(item=>item.id===req.params.id&&item.status==='available'&&item.url);if(!asset){res.status(404).json({error:'No verified private sound available'});return;}res.setHeader('Cache-Control','no-store');res.type('audio/wav').sendFile(resolve('runtime/imported-sounds',localSoundFiles[asset.id as LocalSoundId]));});
app.get('/api/voice-lab/catalog',async(_req,res)=>{try{const r=await fetch(kokoro.url+'/lab/catalog',{signal:AbortSignal.timeout(5000)});res.status(r.status).json(await r.json());}catch{res.status(503).json({error:'Local voice offline. Run ./scripts/start.sh or set up ./scripts/setup-local-tts.sh.'});}});
app.post('/api/voice-lab/render',async(req,res)=>{const controller=new AbortController();res.on('close',()=>controller.abort());try{const r=await fetch(kokoro.url+'/lab/render',{method:'POST',redirect:'error',headers:kokoro.renderHeaders(),body:JSON.stringify(req.body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(180000)])});if(!r.ok){res.status(r.status).json(await r.json());return;}for(const name of ['x-audio-duration','x-render-seconds','x-audio-peak','x-audio-preset']){const v=r.headers.get(name);if(v)res.setHeader(name,v);}res.type('audio/wav').send(Buffer.from(await r.arrayBuffer()));}catch(e){if(!res.headersSent&&!controller.signal.aborted)res.status(503).json({error:'Local rendering unavailable: '+String(e)});}});

const eventRenderControllers = new Set<AbortController>();
app.post('/api/director/scene', async(req,res)=>{
 const parsed=SceneRequestSchema.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Invalid scene planning request'});return;}
 if(eventRenderControllers.size>=2){res.status(429).json({error:'Scene preparation is busy'});return;}
 const input=parsed.data,controller=new AbortController();eventRenderControllers.add(controller);res.on('close',()=>controller.abort());
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);
 const traceId=input.requestId??randomUUID();sceneTraces.begin(traceId,input.model.startsWith('cloud:')?'cloud':'local',input.model);
 try {
  const c=input.planningContext;
  const confirmedPreferences=sceneMemoryContext(store);
  if(input.promptId==='bambi-companion')c.currentLook=sceneDraftLook(c);
  const eligible=new Set(input.selectedTriggers.map(t=>t.toLowerCase()));
  if(c.pool.triggers.some(t=>t!=='Blink'&&!eligible.has(t.toLowerCase())))throw Error('Planner cue is outside the selected trigger pool');
  const connection=modelConnection(input.model,input.promptId,modelConnections),backend=backendFor(input.model,connection.backend);
  // Retain the existing local admission/lifecycle owner. Qualification uses
  // private fixture endpoints and lifecycle files, never the shared runner.
  const prepareSceneBackend=async()=>{if(backend===cloud)return;
    for(const other of active.values())if(other.backend!=='cloud'&&(other.backend!==backend.name||other.model!==input.model||other.context!==connection.context))throw Error('Another client is using the local model');
    if(backend===llama)await prepareConfiguredNativeModel(input.model,connection.context,signal);else await stopNativeModel(signal);
  };
  if(backend!==cloud)await inference.local.run(prepareSceneBackend,signal);
  sceneTraces.mark(traceId,'model-ready');
  const character=buildCharacterDocument(input,c.phase),characterPrefix=buildCharacterPrefix(character.core,input.narrationStyle);
  const system=[characterPrefix,character.phase,localContextPrompt(access.snapshot(),backend===cloud,input.localContext),
    '=== SCENE PLANNING OUTPUT CONTRACT ===\nThe following application request asks for bounded presentation data in JSON, not spoken narration. Retain the complete selected character when writing spoken text fields. This JSON contract overrides conflicting marker examples, plain-text-only instructions and passage length targets. The engine owns transport, phases and output limits. You may choose and combine allowed capabilities inside those limits. No code, tools or device actions.',
    languageStyleDirection(input)].filter(Boolean).join('\n\n');
  const reservedTriggers=triggerData.triggers.map(trigger=>trigger.name);
  // 9B local models must finish preparation, a possible validated retry and
  // speech synthesis within the existing deadline. Compose smaller scenes
  // while retaining the entire character and all admitted capabilities.
  const compactPlan=backend===llama&&/-9b(?:-|:)/i.test(input.model);
  const englishSpeech=kokoro.capabilities.languages.length===1&&kokoro.capabilities.languages[0]==='en';
  const storyMoment=englishSpeech?nextStoryMoment(c):null;
  const outputBudget=storyMoment&&storyMoment.beat!=='adapt'?(storyExchange(c,storyMoment)?768:256):compactPlan?1536:3072;
  const draft=input.promptId==='bambi-companion';
  const instruction=scenePlanningInstruction(c,reservedTriggers,{compact:compactPlan,maxTokens:outputBudget,englishSpeech,draft});
  const count=(messages:Message[])=>backend.countTokens?backend.countTokens(messages,signal):Promise.resolve(estimateChatTokens(messages));
  const checkpointPrefix=backend===llama&&nativeCheckpointModel(input.model)?characterPrefix:undefined;
  const fitted=await fitContext(system,[],instruction,count,connection.context,outputBudget,backend.countTokens?256:512,Math.min(1024,outputBudget),confirmedPreferences,{fastPlanning:!!backend.countTokens,checkpointPrefix});
  sceneTraces.mark(traceId,'context-ready');sceneTraces.event(traceId,'input-tokens',{value:fitted.inputTokens});
  let plan=await planScene(c,{backend,queue:inference.forBackend(backend),model:input.model,contextTokens:connection.context,messages:fitted.messages,maxTokens:fitted.maxTokens,reservedTriggers,compact:compactPlan,speechLanguages:kokoro.capabilities.languages,draft},signal);
  sceneTraces.mark(traceId,'plan-ready');
  const measured=[],innerVoice=new DualVoiceSession(c.phase);
  for(const arc of synthesisArcs(plan)) {
    signal.throwIfAborted();const parts:Uint8Array[]=[],words:{word:string;atMs:number;endMs:number}[]=[];let cursor=0;
    // Use the existing distinct inner timbre at synthesis time. The compiler
    // retains ownership of its timed playback track, gain and spatial mix.
    for await(const chunk of kokoro.speak(arc.inner?'[bambi]'+arc.text:arc.text,input.voice,deliverySpeed(input.speed,arc.delivery),signal,input.preset,[],true,arc.inner?innerVoice:undefined,arc.delivery)) {
      if(!chunk.audio)continue;const bytes=new Uint8Array(Buffer.from(chunk.audio,'base64'));
      for(const word of chunk.timestamps??[])words.push({word:word.word,atMs:cursor+word.start_time*1000,endMs:cursor+word.end_time*1000});
      cursor+=wavDurationMs(bytes);parts.push(bytes);
    }
    measured.push({id:arc.id,bytes:joinWav(parts),words});
  }
  sceneTraces.mark(traceId,'audio-ready');
  const compileOptions={atMs:input.atMs,durationMs:input.durationMs,baseline:input.baseline,continuous:input.continuous,reservedTriggers:triggerData.triggers.map(t=>t.name),instanceId:'regie-'+randomUUID()};
  let scene:ReturnType<typeof compileScene>;
  try{scene=compileScene(plan,c,measured,compileOptions);}catch(error){
    if(!(error instanceof RevealAlignmentError))throw error;
    sceneTraces.mark(traceId,'anchor-repair');
    plan=await repairRevealAnchor(plan,error,c,{backend,queue:inference.forBackend(backend),model:input.model,contextTokens:connection.context,messages:fitted.messages,beforeRepair:prepareSceneBackend},signal);
    scene=compileScene(plan,c,measured,compileOptions);
  }
  signal.throwIfAborted();
  if(JSON.stringify(confirmedPreferences)!==JSON.stringify(sceneMemoryContext(store)))throw Error('Confirmed preferences changed during scene preparation. Prepare a new scene.');
  sceneTraces.mark(traceId,'compiled');sceneTraces.finish(traceId,'done');res.json({...scene,requestId:input.requestId});
 }catch(error){const message=error instanceof Error?error.message:String(error);if(controller.signal.aborted)sceneTraces.finish(traceId,'interrupted');else sceneTraces.fail(traceId,message);if(!res.headersSent&&!controller.signal.aborted)res.status(signal.aborted?504:422).json({error:message});}
 finally{eventRenderControllers.delete(controller);}
});
app.post('/api/events/render', async (req, res) => {
 const parsed = EventSpeechRequestSchema.safeParse(req.body);
 if (!parsed.success) { res.status(400).json({error:'Invalid engine speech window'}); return; }
 if (parsed.data.experimentProfile && process.env.BAMBI_NEXT_GEN_COMPARISON !== '1') {res.status(400).json({error:'Comparison experiment is disabled'});return;}
 if (eventRenderControllers.size >= 2) { res.status(429).json({error:'Event speech preparation is busy'}); return; }
 const input = parsed.data, controller = new AbortController(); eventRenderControllers.add(controller); res.on('close', () => controller.abort());
 const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
 try {
  const connection = modelConnection(input.model, 'bambisleep-classic', modelConnections), backend = backendFor(input.model, connection.backend);
  const eventSlot=compileEvent(input.event).speech.find(slot=>slot.payloadId===input.payloadId);
  const eventPace=eventSlot?.speech.delivery??eventDelivery(eventSlot?.speech.mode??'narrate',input.event.phase);
  const eventPrefix=backend===llama&&nativeCheckpointModel(input.model)?buildEventNarrationPrefix(input):undefined;
  const rendered = await renderEventSpeech(input, {
   knownTriggers: triggerData.triggers.map(trigger => trigger.name),
   generate: async (instruction, requestSignal, words, exactPhrase) => {
    if (backend !== cloud) await inference.local.run(async () => { for (const other of active.values()) if (other.backend !== 'cloud' && (other.backend !== backend.name || other.model !== input.model || other.context !== connection.context)) throw Error('Another client is using the local model'); if (backend === llama) await prepareConfiguredNativeModel(input.model, connection.context, requestSignal); else await stopNativeModel(requestSignal); }, requestSignal);
   const messages=eventNarrationMessages(input,instruction,localContextPrompt(access.snapshot(),backend===cloud,input.localContext));
   const outputTokens=Math.min(512,Math.max(64,words*4));
   const count=(messages:Message[])=>backend.countTokens?backend.countTokens(messages,requestSignal):Promise.resolve(estimateChatTokens(messages));
   const plan=await fitContext(messages[0].content,[],instruction,count,connection.context,outputTokens,backend.countTokens?256:512,Math.min(64,outputTokens),'',{checkpointPrefix:eventPrefix});
    let text = '';
    for await (const chunk of inference.forBackend(backend).stream(backend, plan.messages, input.model, requestSignal, connection.context, plan.maxTokens, input.sampling, backend === llama && input.experimentProfile !== 'next-gen-ab' ? eventTextGrammar(words, exactPhrase, [...triggerData.triggers.map(t=>t.name),'Blink'].filter(name=>!exactPhrase?.toLowerCase().includes(name.toLowerCase()))) : undefined)) {
     text += chunk.text;
     if (text.trim().split(/\s+/).length >= words && /[.!?]["”']?\s*$/.test(text)) break;
    }
    return text;
   },
   render: async (text, requestSignal) => {
    const parts: Uint8Array[] = [], words: {word:string;atMs:number;endMs:number}[] = []; let cursor = 0;
    // No trigger/script parsing: the engine validates plain text and owns all effects.
    for await (const chunk of kokoro.speak(text, input.voice, deliverySpeed(input.speed,eventPace), requestSignal, input.preset, [], true, undefined, eventPace)) {
     if (!chunk.audio) continue;
     const bytes = new Uint8Array(Buffer.from(chunk.audio, 'base64'));
     for (const word of chunk.timestamps ?? []) words.push({word:word.word,atMs:cursor + word.start_time * 1000,endMs:cursor + word.end_time * 1000});
     cursor += wavDurationMs(bytes); parts.push(bytes);
    }
    return {bytes:joinWav(parts),words};
   },
  }, signal);
  if (!signal.aborted) res.json({...rendered,...(input.requestId?{requestId:input.requestId}:{})});
 } catch (error) { if (!res.headersSent && !controller.signal.aborted) res.status(signal.aborted ? 504 : 422).json({error:error instanceof Error ? error.message : String(error),...(error instanceof SpeechWindowError?{speechBudget:{wordsPerMs:error.wordsPerMs,durationMs:error.durationMs,targetMs:error.targetMs}}:{})}); }
 finally { eventRenderControllers.delete(controller); }
});
if (process.env.BAMBI_NEXT_GEN_COMPARISON === '1') {
 app.get('/api/next-gen-comparison/:artifact', (req,res) => {
  const name=req.params.artifact;
  if (!/^(?:manifest|scores|transcripts|current|reference|adaptive|live-bridge)(?:\.bambi)?\.json$/.test(name) && !/^(?:current|reference|adaptive)\.wav$/.test(name)) {res.status(404).end();return;}
  const path=resolve('runtime/next-gen-comparison',name);
  if (!existsSync(path)) {res.status(404).json({error:'Build the local comparison first: see docs/NEXT_GEN_COMPARISON.md'});return;}
  res.setHeader('Cache-Control','no-store');res.sendFile(path);
 });
}
app.get('/api/voice-lab/comparison',(_req,res)=>{const path=resolve('runtime/voice-comparison/comparison.json');res.json(existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{candidates:[]});});
app.get('/api/voice-lab/comparison/:voice', (req,res)=>{if(!/^(af_(heart|bella|sarah|nicole|sky|river|aoede)|bambi_classic)$/.test(req.params.voice)){res.status(400).json({error:'Unknown comparison voice'});return;}const path=resolve('runtime/voice-comparison',req.params.voice+'.wav');if(!existsSync(path)){res.status(404).json({error:'Render comparisons with tools/voice_lab.py compare.'});return;}res.sendFile(path);});
app.get('/api/content',(_req,res)=>res.json(contentCatalog()));
app.get('/api/content/prompts/:id',(req,res)=>{const prompt=prompts.find(p=>p.id===req.params.id);if(!prompt){res.status(404).json({error:'Unknown prompt'});return;}res.json(prompt);});
app.get('/api/triggers/json',(_req,res)=>res.json(triggerData));
app.use('/content/stable-2.0/public/docs',express.static(resolve(contentRoot,'public/docs'),{index:false,dotfiles:'deny'}));
app.use('/content/stable-2.0',(_req,res)=>res.status(404).end());
app.use('/assets/sounds',express.static(resourcePath('assets/sounds'),{dotfiles:'deny'}));
app.get('/api/preferences',(_req,res)=>{
 const snapshot=store.settingsSnapshot();res.setHeader('X-Settings-Revision',snapshot.revision);res.setHeader('X-Settings-Profile',snapshot.profile);
 res.json({...snapshot.settings,...profileMetadata});
});
app.get('/api/settings',(_req,res)=>res.json(store.settingsSnapshot()));
app.put('/api/preferences',(req,res)=>{
 const envelope=z.object({revision:z.number().int().nonnegative(),settings:z.unknown()}).strict().safeParse(req.body);
 if(!envelope.success){res.status(400).json({error:'A settings revision and validated settings are required'});return;}
 let settings;try{settings=validateSettings(envelope.data.settings);}catch{res.status(400).json({error:'Invalid settings; no changes saved'});return;}
 try{
  const current=store.settingsSnapshot().settings;
  settings={...settings,'q8-kv-cache':current['q8-kv-cache']===true,'dflash-4b':current['dflash-4b']===true};
  const result=store.saveSettings(envelope.data.revision,settings);healthTime=0;res.status(result.conflict?409:200).json(result);
 }
 catch{res.status(500).json({error:'Could not write settings to private storage; retry saving'});}
});
app.post('/api/settings/import',(req,res)=>{
 const parsed=ImportSettingsSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid settings file or selected sections'});return;}
 const {revision,requestId,file,sections}=parsed.data;
 const current=store.settingsSnapshot();
 if(current.revision===revision)panic();
 const imported=selectedFileSettings(file,sections);if(sections.includes('machine')&&Object.keys(file.sections.machine??{}).length)imported['device-auto-connect']=false;
 const result=store.saveSettings(revision,{...current.settings,...imported},true,{id:requestId,fingerprint:JSON.stringify({file,sections})});healthTime=0;
 res.status(result.conflict?409:200).json(result);
});
app.post('/api/settings/undo',(req,res)=>{
 const parsed=z.object({revision:z.number().int().nonnegative()}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Invalid settings revision'});return;}
 const snapshot=store.settingsSnapshot();if(snapshot.revision===parsed.data.revision&&snapshot.undoRevision===parsed.data.revision)panic();
 const result=store.undoSettings(parsed.data.revision);healthTime=0;res.status(result.conflict?409:200).json(result);
});
app.get('/api/settings/presets',(_req,res)=>res.json(store.settingsPresets()));
app.post('/api/settings/presets',(req,res)=>{
 const parsed=SettingsFileSchema.safeParse(req.body);if(!parsed.success||parsed.data.kind!=='preset'){res.status(400).json({error:'Invalid portable preset'});return;}
 try{res.json(store.saveSettingsPreset(parsed.data));}catch{res.status(400).json({error:'Could not save preset; keep at most 50 names'});}
});
app.delete('/api/settings/presets',(req,res)=>{
 const parsed=z.object({name:z.string().min(1).max(80)}).strict().safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid preset name'});return;}
 res.json(store.deleteSettingsPreset(parsed.data.name));
});
const cacheControllers=new Set<AbortController>();
function kvCacheStatus(){return {supported:process.platform==='linux'&&!desktopSmoke,model:communityQwen,enabled:!desktopSmoke&&kvCacheMode((store.get('profile',{}) as Record<string,unknown>)['q8-kv-cache'],communityQwen,process.platform)==='q8_0'};}
function dflashStatus(){return {supported:process.platform==='linux'&&!desktop,model:communityQwen4B,enabled:!desktop&&dflashMode((store.get('profile',{}) as Record<string,unknown>)['dflash-4b'],communityQwen4B,process.platform)==='on',draftTokens:3};}
async function prepareConfiguredNativeModel(model:string,context:number,signal?:AbortSignal){
 const profile=store.get('profile',{}) as Record<string,unknown>;
 const mode=kvCacheMode(profile['q8-kv-cache'],model,process.platform);
 let tuning:RuntimeTuning|undefined;
 if(!calibration.busy&&calibrationModels.includes(model)&&mode==='default'&&dflashMode(profile['dflash-4b'],model,process.platform)==='off'){
  try{const saved=await measuredProfile(model,profile);if(saved)tuning=calibrationPerformance(saved)?.tuning;}catch{}
 }
 await prepareNativeModel(model,context,signal,mode,desktop?'off':dflashMode(profile['dflash-4b'],model,process.platform),tuning);
}
app.post('/api/runtime/kv-cache',async(req,res)=>{
 const parsed=z.object({enabled:z.boolean(),model:z.literal(communityQwen)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Choose the Hauhau 9B Q8 cache setting.'});return;}
 if(!kvCacheStatus().supported){res.status(400).json({error:'Experimental Q8 KV cache is available on Linux.'});return;}
 if([...active.values()].some(job=>job.backend!=='cloud')||eventRenderControllers.size){res.status(409).json({error:'Finish or stop local replies and Guided preparation before changing the cache.'});return;}
 const controller=new AbortController();cacheControllers.add(controller);res.on('close',()=>controller.abort());
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(660000)]);
 try{
  await inference.local.run(async()=>{
   signal.throwIfAborted();
   if([...active.values()].some(job=>job.backend!=='cloud')||eventRenderControllers.size)throw Error('Local AI is busy. Stop its reply before changing the cache.');
   const context=modelConnection(communityQwen,'bambisleep-classic',modelConnections).context;
   await prepareNativeModel(communityQwen,context,signal,parsed.data.enabled?'q8_0':'default');
   signal.throwIfAborted();
   store.set('profile',{...(store.get('profile',{}) as Record<string,unknown>),'q8-kv-cache':parsed.data.enabled});healthTime=0;
  },signal);
  res.json({ok:true,...kvCacheStatus()});
 }catch(error){if(!res.headersSent&&!res.destroyed)res.status(signal.aborted?409:503).json({error:signal.aborted?'Cache preparation cancelled.':error instanceof Error?error.message:'Cache preparation failed.'});}
 finally{cacheControllers.delete(controller);}
});
app.post('/api/runtime/dflash',async(req,res)=>{
 const parsed=z.object({enabled:z.boolean(),model:z.literal(communityQwen4B)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Choose the Hauhau 4B DFlash setting.'});return;}
 if(!dflashStatus().supported){res.status(400).json({error:'DFlash testing is available in the Linux local app.'});return;}
 if([...active.values()].some(job=>job.backend!=='cloud')||eventRenderControllers.size){res.status(409).json({error:'Finish or stop local replies and Guided preparation before changing DFlash.'});return;}
 const controller=new AbortController();cacheControllers.add(controller);res.on('close',()=>controller.abort());
 const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(660000)]);
 try{
  await inference.local.run(async()=>{
   signal.throwIfAborted();
   if([...active.values()].some(job=>job.backend!=='cloud')||eventRenderControllers.size)throw Error('Local AI is busy. Stop its reply before changing DFlash.');
   const context=modelConnection(communityQwen4B,'bambisleep-classic',modelConnections).context;
   await prepareNativeModel(communityQwen4B,context,signal,'default',parsed.data.enabled?'on':'off');
   signal.throwIfAborted();
   store.set('profile',{...(store.get('profile',{}) as Record<string,unknown>),'dflash-4b':parsed.data.enabled});healthTime=0;
  },signal);
  res.json({ok:true,...dflashStatus()});
 }catch(error){if(!res.headersSent&&!res.destroyed)res.status(signal.aborted?409:503).json({error:signal.aborted?'DFlash preparation cancelled.':error instanceof Error?error.message:'DFlash preparation failed.'});}
 finally{cacheControllers.delete(controller);}
});
app.get('/api/profiles/backup',(req,res)=>{
 let transaction=false;try{store.db.exec('BEGIN');transaction=true;const backup=store.exportProfileBackup(req.query.memory==='true',req.query.library==='true');store.db.exec('COMMIT');transaction=false;res.json(backup);}catch{if(transaction)store.db.exec('ROLLBACK');res.status(422).json({error:'This profile cannot be exported within the backup limits. Nothing was changed.'});}
});
app.get('/api/profiles/recovery',(_req,res)=>res.json(store.recoveryPoints()));
app.get('/api/profiles/recovery/:id',(req,res)=>{const point=store.recoveryPoint(req.params.id);if(!point){res.status(404).json({error:'Recovery point was not found.'});return;}res.json(point);});
app.post('/api/profiles/import',(req,res)=>{
 const parsed=ImportSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid or unsupported profile. Nothing was changed.'});return;}
 if(!parsed.data.groups.length&&!parsed.data.memory&&!parsed.data.library){res.status(400).json({error:'Choose at least one group to import.'});return;}
 try{
  checkedSize(parsed.data.document,parsed.data.document.format==='bambi-backup'?MAX_BACKUP_BYTES:MAX_PROFILE_BYTES);
  panic();void bleBridge.disconnect().catch(()=>{});
  const result=store.importProfile(parsed.data);healthTime=0;res.json({ok:true,...result});
  // Clear cached settings in every window, including tabs with pending saves.
  for(const socket of wss.clients)send(socket,{type:'profile-imported'});
 }catch{res.status(422).json({error:'The profile could not be restored. Existing data was retained.'});}
});

let transcribing=false;
const speechVocabulary=buildSpeechVocabulary();
app.get('/api/speech/vocabulary',(_req,res)=>res.json({terms:speechVocabulary,prompt:speechVocabularyPrompt(speechVocabulary,store.get('profile',{})),maxPromptBytes:600}));
app.post('/api/transcribe',express.raw({type:['audio/wav','application/octet-stream'],limit:'8mb'}),async(req,res)=>{if(transcribing){res.status(429).json({error:'Speech recognition is busy. Give it a moment.'});return;}if(!Buffer.isBuffer(req.body)||req.body.length<44||req.body.toString('ascii',0,4)!=='RIFF'){res.status(400).json({error:'16-kHz WAV audio required'});return;}transcribing=true;const start=performance.now();const controller=new AbortController();res.on('close',()=>controller.abort());try{const vocabulary=speechVocabularyPrompt(speechVocabulary,store.get('profile',{}),store.recent().slice(-3).map(turn=>turn.content).join(' '));const data=await transcribe(new Blob([new Uint8Array(req.body)],{type:'audio/wav'}),AbortSignal.any([controller.signal,access.signal('microphone'),AbortSignal.timeout(45000)]),'http://127.0.0.1:8081',vocabulary);store.metric('stt.ready',{ms:performance.now()-start});res.json({text:data.text,segments:data.segments||[],latencyMs:performance.now()-start});}catch(e){if(!res.headersSent)res.status(503).json({error:'Local speech recognition: '+String(e)});}finally{transcribing=false;}});

app.get('/api/memory',(_req,res)=>res.json({semantic:semanticMemory.available?'ready':'not-installed',turns:store.recent(16),summary:store.conversationSummary(),facts:store.memoryFacts(),conversationId:store.get('conversationId','legacy')}));
app.get('/api/memory/export',(_req,res)=>{res.setHeader('Content-Disposition','attachment; filename=\"bambi-memory.json\"');res.json(store.exportMemory());});
function publishMemoryChange(){for(const ws of wss.clients){cancel(ws);send(ws,{type:'memory-changed'});}}
app.put('/api/memory/facts',(req,res)=>{const parsed=z.object({key:z.string().trim().min(1).max(80),value:z.string().trim().min(1).max(1000),sourceTurnId:z.number().int().positive().nullable().default(null)}).strict().safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid preference'});return;}try{const id=store.saveMemory(parsed.data.key,parsed.data.value,parsed.data.sourceTurnId);publishMemoryChange();res.json({id});}catch{res.status(400).json({error:'A source must be one of your user messages.'});}});
app.delete('/api/memory/facts/:id',(req,res)=>{const removed=store.forgetFact(Number(req.params.id));if(removed)publishMemoryChange();res.status(removed?200:404).json({ok:removed});});
app.post('/api/conversation',(_req,res)=>{for(const ws of wss.clients)cancel(ws);store.beginConversation();res.json({ok:true});});
app.delete('/api/memory',(_req,res)=>{store.clearMemory();publishMemoryChange();res.json({ok:true});});
app.get('/api/knowledge',(req,res)=>res.json(knowledge.search(String(req.query.q||'').slice(0,500))));

app.get('/api/library',(_req,res)=>res.setHeader('ETag',profileTag()).json(store.db.prepare('SELECT data FROM media').all().map((r:any)=>JSON.parse(r.data))));
const profileTag=()=>`"profile-${Number(store.get('profileImportRevision',0))}"`;
app.put('/api/library',(req,res)=>{if(req.headers['if-match']&&req.headers['if-match']!==profileTag()||Number(store.get('profileImportRevision',0))>0&&!req.headers['if-match']){res.status(409).json({error:'Reload after importing a profile before saving library changes.'});return;}const items=z.array(z.object({id:z.string().max(1000),favorite:z.boolean(),notes:z.string().max(10000),tags:z.string().max(1000),plays:z.number().int().min(0).optional(),lastPlayed:z.string().max(100).optional(),remote:BambiCloudTrackSchema.optional()}).refine(item=>!item.remote||item.id===bambiCloudTrackId(item.remote))).max(10000).safeParse(req.body);if(!items.success){res.status(400).json({error:'Invalid local library metadata'});return;}const statement=store.db.prepare('INSERT OR REPLACE INTO media(id,data) VALUES(?,?)');for(const item of items.data)statement.run(item.id,JSON.stringify(item));res.json({ok:true});});

app.get('/api/sessions',(_req,res)=>res.json(store.sessions()));
app.post('/api/session',(req,res)=>{const parsed=z.object({id:z.string().uuid(),duration:z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),state:z.string().max(20),scene:z.string().max(50),rating:z.number().min(1).max(10).optional()}).safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid session'});return;}store.saveSession(parsed.data.id,parsed.data);res.json({ok:true});});

let analyzing=false;const analysisControllers=new Set<AbortController>();
app.post('/api/analyze',async(req,res)=>{if(analyzing){res.status(429).json({error:'An analysis is already running.'});return;}analyzing=true;mkdirSync('runtime/media-analysis',{recursive:true});const path=resolve('runtime/media-analysis/'+crypto.randomUUID()+'.input');const controller=new AbortController();analysisControllers.add(controller);res.on('close',()=>controller.abort());let bytes=0;const hash=createHash('sha256');try{const limiter=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(bytes>1024*1024*1024){callback(Error('File exceeds 1 GiB'));return;}hash.update(chunk);callback(null,chunk);}});await pipeline(req,limiter,createWriteStream(path),{signal:controller.signal});const id=hash.digest('hex');const result=await analyzeMedia(path,id,req.query.transcribe==='true',controller.signal);store.metric('media.analyzed',{id,duration:result.duration});res.json(result);}catch(e){if(!res.headersSent)res.status(400).json({error:String(e)});}finally{rmSync(path,{force:true});analysisControllers.delete(controller);analyzing=false;}});

const playbackBufferSchema=z.object({type:z.literal('playback-buffer'),id:z.string().max(100),requestId:z.string().uuid().optional(),sample:z.number().int().min(0),seqs:z.array(z.number().int().min(0)).max(32),queuedSeconds:z.number().finite().min(0).max(120),speechSeconds:z.number().finite().min(0).max(120),queuedBytes:z.number().int().min(0).max(SpeechRenderAhead.maxBytes),running:z.boolean()}).strict().refine(r=>r.speechSeconds<=r.queuedSeconds&&new Set(r.seqs).size===r.seqs.length);
const audioScheduledSchema=z.object({type:z.literal('audio-scheduled'),id:z.string().max(100),requestId:z.string().uuid().optional(),seq:z.number().int().min(0),decodeMs:z.number().finite().min(0).max(120000),leadSeconds:z.number().finite().min(0).max(120),duration:z.number().finite().min(0).max(120)}).strict();
/** WAV container duration is rendered evidence; text length is never an audio estimate. */
function liveAudioSeconds(audio:string){
 if(!audio)return 0;const wav=Buffer.from(audio,'base64');let rate=0;
 if(wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('Live speech requires a complete WAV');
 for(let at=12;at+8<=wav.length;){const size=wav.readUInt32LE(at+4),tag=wav.toString('ascii',at,at+4);if(at+8+size>wav.length)throw Error('Truncated speech WAV');if(tag==='fmt '&&size>=16)rate=wav.readUInt32LE(at+16);if(tag==='data'&&rate>0)return size/rate;at+=8+size+(size%2);}
 throw Error('Speech WAV has no duration');
}
interface Active {ahead?:SpeechRenderAhead;requestId?:string;model:string;context:number;backend:string;feedback:string[];controller:AbortController;wake:()=>void;pending:Set<number>;pendingSentences:Map<number,number>;id:string;progress:ReplyProgress;userSaved:boolean;speak:boolean;generated:string;conversation?:SituationalConversation;turn?:SituationalTurnStream;closing?:boolean}
const active=new Map<WebSocket,Active>();
const situationalConversations=new WeakMap<WebSocket,{id:string;state:SituationalConversation}>();
function situationalConversation(ws:WebSocket){
 const id=String(store.get('conversationId','legacy')),previous=situationalConversations.get(ws);
 if(previous?.id===id)return previous.state;
 const state=new SituationalConversation();situationalConversations.set(ws,{id,state});return state;
}
function send(ws:WebSocket,data:unknown){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function cancel(ws:WebSocket,reason='cancelled'){const job=active.get(ws);if(job){traces.finish(job.id,'interrupted');job.controller.abort();job.wake();active.delete(ws);const delivered=job.progress.interrupted(job.speak,job.generated);if(job.userSaved){store.addTurn('assistant',delivered,reason);if(job.turn)job.conversation?.delivered(job.turn.action,delivered,job.closing);}for(const text of job.feedback)store.addTurn('user',text);}send(ws,{type:'interrupted',id:job?.id,requestId:job?.requestId});}
function panic(issuer?:WebSocket){if(calibration.busy||calibrationAdmission)modelSetup?.cancel();calibrationAdmissionController?.abort();calibration.cancel();for(const controller of cacheControllers)controller.abort();streamingSpeech.close();devices.stop();for(const controller of eventRenderControllers)controller.abort();for(const controller of listeningControllers)controller.abort();for(const c of analysisControllers)c.abort();for(const ws of wss.clients){cancel(ws);if(ws!==issuer)send(ws,{type:'panic'});}}
app.post('/api/panic',(_req,res)=>{panic();res.json({ok:true});});
const listeningControllers=new Set<AbortController>();
app.post('/api/listen',async(req,res)=>{
 const parsed=ListeningInputSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid listening input'});return;}
 const input=parsed.data;const controller=new AbortController();listeningControllers.add(controller);res.on('close',()=>controller.abort());const start=performance.now();
 try{
  // Avoid unloading/replacing a model while another reply is being spoken.
  if(input.backend==='llama.cpp'&&!nativeSamplingModels.includes(input.model))throw Error('Invalid native listening model');
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]);
  const connection={...input,...modelConnection(input.model,'bambisleep-classic',modelConnections)},backend=backendFor(connection.model,connection.backend);
  const decision=await inference.forBackend(backend).run(()=>decideListening(connection,backend,signal),signal,10);
  if(!controller.signal.aborted){store.metric('listening.decision',{action:decision.action,ms:performance.now()-start});res.json(decision);}
 }catch(error){if(!controller.signal.aborted&&!res.headersSent)res.status(503).json({error:'Listening planner unavailable: '+String(error)});}
 finally{listeningControllers.delete(controller);}
});
const consumedFeedback=new WeakMap<WebSocket,Set<string>>();
const consumedSchema=z.object({type:z.literal('feedback-consumed'),inputId:z.string().uuid(),replyId:z.string().max(100),text:z.string().trim().min(1).max(4000)}).strict();
function consumeFeedback(ws:WebSocket,raw:unknown){
 const parsed=consumedSchema.safeParse(raw);if(!parsed.success)return;
 const data=parsed.data;let seen=consumedFeedback.get(ws);if(!seen){seen=new Set();consumedFeedback.set(ws,seen);}if(seen.has(data.inputId))return;
 // A replacement can already be active before its begin reaches the client.
 // Empty replyId binds feedback to that current turn; explicit stale IDs don't.
 const job=active.get(ws);if(job&&data.replyId&&job.id!==data.replyId)return;
 seen.add(data.inputId);if(seen.size>128)seen.delete(seen.values().next().value!);
 if(job){job.feedback.push(data.text);job.conversation?.observe(data.text);}else store.addTurn('user',data.text);
}

const chatSchema=ChatRequestSchema;
async function chat(ws:WebSocket,data:z.infer<typeof chatSchema>){
 if(calibration.busy||calibrationAdmission){send(ws,{type:'error',requestId:data.requestId,text:'A local AI performance test is running. Cancel it before starting a conversation.'});return;}
 const situational=data.interaction==='situational';
 const intent=resolveReplyIntent(data.text,data.promptId,data.dialogue,data.intent,store.get('replyIntent','conversation') as 'conversation'|'narration'),narration=intent==='narration';
 data={...data,...modelConnection(data.model,data.promptId,modelConnections),intent,dialogue:!narration};
 data={...data,dualVoice:data.dualVoice&&narration,maxTokens:replyTokenBudget(data.maxTokens,false,narration,data.text)};
 if(!data.dialogue&&data.session?.triggerTiming?.enabled){const names=triggersForPhase(data.session.phase,data.session.phaseProgress,data.session.triggerTiming);data={...data,selectedTriggers:names,session:{...data.session,activeTriggers:names}};}
 const backendName=data.backend||(nativeSamplingModels.includes(data.model)?'llama.cpp':'ollama'),backend=backendFor(data.model,backendName);cancel(ws,'superseded');const job:Active={requestId:data.requestId,model:data.model,context:data.context,backend:backend.name,feedback:[],controller:new AbortController(),wake:()=>{},pending:new Set(),pendingSentences:new Map(),id:crypto.randomUUID(),progress:new ReplyProgress(),userSaved:false,speak:data.speak,generated:''};active.set(ws,job);const signal=job.controller.signal;let full='',sequence=0,sentenceId=0,first=true,firstAudio=true,ttsFailed=false;let chain=Promise.resolve();const start=performance.now();
 if(situational){job.conversation=situationalConversation(ws);job.turn=new SituationalTurnStream(true);job.closing=narration&&data.session?.phase==='awakening'&&!data.session.continuous;if(data.source==='user')job.conversation.observe(data.text);}else situationalConversations.delete(ws);
 traces.begin(job.id,backend.name,data.model,data.inputTiming);
 const alive=()=>!signal.aborted&&active.get(ws)===job;
 const replySend=(message:Record<string,unknown>)=>{if(alive())send(ws,{...message,id:job.id,requestId:job.requestId});};
 const queuedSentences=()=>new Set(job.pendingSentences.values()).size;
 const liveVoice=data.playbackBuffer===true&&process.env.BAMBI_LIVE_VOICE!=='0';
 if(liveVoice)job.ahead=new SpeechRenderAhead();
 const speechLookahead=data.dualVoice?6:2;
 const waitSlot=async(withinSentence=false,seconds=0,bytes=0,parallelInner=false)=>{const waitStarted=performance.now();while(alive()&&((!withinSentence&&queuedSentences()>=speechLookahead)||job.ahead&&!job.ahead.allows(seconds,bytes,parallelInner)||job.pending.size>=32||ws.bufferedAmount>1024*1024)){await new Promise<void>(resolve=>{job.wake=resolve;setTimeout(resolve,100);});}if(!alive())throw Error('Interrupted');traces.measure(job.id,'render-ahead-wait',performance.now()-waitStarted);};
 const delivery=data.adaptiveDelivery&&data.source==='engine'&&narration&&data.session? narrationDeliveryAt((data.session.cycleElapsedMin??data.session.elapsedMin)*60,data.session.totalMin*60):undefined;
 const spokenSpeed=delivery?deliverySpeed(data.speed,delivery):data.speed;
 const deliveryBudget=delivery?deliveryWordBudget(delivery,Math.max(0,(data.session!.totalMin-(data.session!.cycleElapsedMin??data.session!.elapsedMin))*60)):undefined;
 const spokenBudget=replyWordBudget(data.text,narration,{phase:data.session?.phase,focused:data.promptId==='bambi-companion',interaction:data.interaction,engineWords:deliveryBudget});
 const blockBudget=replyBlockBudget(data.text,narration,spokenBudget);
 const completionRequest=spokenBudget?`${spokenBudget.max} words`:data.text;
 const dualVoice=data.dualVoice?new DualVoiceSession(data.session?.phase):undefined;
 const speech=async(text:string)=>{if(!data.speak||ttsFailed||!alive())return;if((data.dialogue||situational)&&!(data.dualVoice&&text.startsWith('[bambi]'))){const clean=new ScriptDisplayStream(true,situational,false);text=clean.push(text)+clean.flush();}const sentence=sentenceId++;await waitSlot(false,0,0,!!dualVoice&&text.startsWith('[bambi]'));traces.mark(job.id,'first-sentence');traces.event(job.id,'synthesis-start',{sentenceId:sentence});const t=performance.now();try{for await(const chunk of kokoro.speak(text,data.voice,spokenSpeed,signal,data.preset,triggerData.triggers.map(trigger=>trigger.name),false,dualVoice,delivery,(name,ms)=>{traces.measure(job.id,name,ms);if(name==='renderer-first-wav')job.ahead?.rendered(ms);})){if(!alive())return;const bytes=Buffer.byteLength(chunk.audio??'','base64'),seconds=liveAudioSeconds(chunk.audio??'');await waitSlot(true,seconds,bytes,chunk.voice_track?.speaker==='bambi');const seq=sequence++;job.pending.add(seq);job.pendingSentences.set(seq,sentence);job.ahead?.sent(seq,seconds,bytes);traces.event(job.id,'audio-sent',{sentenceId:sentence,seq,value:seconds});job.progress.register(seq,chunk.text??text,chunk.voice_track?.speaker);replySend({type:'audio',id:job.id,seq,sentenceId:sentence,...chunk,text:chunk.text??text});if(firstAudio&&(chunk.text?.trim()||chunk.stream)){firstAudio=false;traces.mark(job.id,'first-audio');store.metric('tts.first-audio',{requestId:job.id,ms:performance.now()-start});}store.metric('tts.audio',{requestId:job.id,ms:performance.now()-t});}traces.event(job.id,'synthesis-end',{sentenceId:sentence});if(alive())replySend({type:'sentence-end',id:job.id,sentenceId:sentence});}catch(e){if(alive()){replySend({type:'sentence-end',id:job.id,sentenceId:sentence});ttsFailed=true;replySend({type:'notice',text:'Voice unavailable. Text continues.'});store.metric('tts.error',{error:String(e)});}}};
 let gate:SpokenOutputGate,displayStream:ScriptDisplayStream,spokenContractFailed=false;
 const enqueue=(sentences:string[])=>{for(const sentence of sentences){traces.mark(job.id,'first-sentence-ready');traces.event(job.id,'phrase-ready');chain=chain.then(async()=>{
  if(!alive()||spokenContractFailed)return;
  let accepted:string;
  try{accepted=await gate.accept(sentence,signal);}catch(error){
   if(!alive())return;spokenContractFailed=true;const reason=error instanceof SpokenContractError?error.code:'repair-failed';traces.event(job.id,'spoken-contract-rejected');store.metric('llm.spoken-contract',{requestId:job.id,reason});
   replySend({type:'notice',text:'The model could not complete a valid spoken thought after one correction. The unfinished remainder was not spoken. Reason: '+reason+'.'});return;
  }
  if(!alive())return;
  // Both text and TTS see only accepted output. Explicit routing restores Owner
  // after each imagined inner fragment, independent of model marker mistakes.
  const routed=data.dualVoice&&!accepted.startsWith('[bambi]')?'[owner]'+accepted:accepted;
  const committed=(full?' ':'')+routed;full+=committed;job.generated=full;
  const display=displayStream.push(committed);if(display)replySend({type:'token',text:display});
  await speech(accepted);
 });}chain.catch(()=>{});};
 try{
 const modelQueued=performance.now();
 if(backend!==cloud)await inference.local.run(async()=>{traces.mark(job.id,'model-slot-acquired');traces.measure(job.id,'model-queue-wait',performance.now()-modelQueued);for(const other of active.values())if(other!==job&&other.backend!== 'cloud'&&(other.backend!==backend.name||other.model!==data.model||other.context!==data.context))throw Error('Another client is using the local model. Finish that reply before switching models.');if(backend===llama)await prepareConfiguredNativeModel(data.model,data.context,signal);else await stopNativeModel(signal);},signal);if(!alive())return;traces.mark(job.id,'model-ready');replySend({type:'begin',id:job.id,dialogue:data.dialogue,protocolVersion:PROTOCOL_VERSION,configuration:{intent,liveVoice,model:data.model,backend:backend.name,context:data.context,sampling:data.sampling,preset:data.preset,dualVoice:data.dualVoice,...(delivery?{delivery}:{})}});store.metric('llm.request',{requestId:job.id,backend:backend.name,model:data.model,promptId:data.promptId,interaction:data.interaction,source:data.source});
 store.refreshConversationSummary();
 const history=store.conversation(128).filter(turn=>turn.content.trim());
 const playbackContext=history.some(turn=>turn.interruption)?'Internal playback state (never quote or speak): assistant turns may be unfinished played excerpts. Their unplayed output was discarded. Adapt to the latest input without assuming an unheard ending was heard.':'';
 const refs=knowledge.search(data.text,2),document=buildCharacterDocument(data,data.session?.phase);
 if(situational)document.core=buildSituationalBase(data,document.core);
 const summary=store.conversationSummary();
 const contextNotes=[document.phase,playbackContext,data.sceneHeardText?'Current scene speech already output before this user turn (quoted data): '+JSON.stringify(data.sceneHeardText):'',localContextPrompt(access.snapshot(),backend===cloud,data.localContext)].filter(Boolean).join('\n\n');
 const memoryStarted=performance.now();traces.mark(job.id,'memory-start');
 const retrievedMemory=narration&&!situational?undefined:await semanticMemory.retrieve(data.source==='engine'&&situational?job.conversation!.context():data.text,signal);if(!alive())return;traces.mark(job.id,'memory-ready');traces.measure(job.id,'memory-retrieval',performance.now()-memoryStarted);
 const optionalContext=[...memoryContext(store,data.text,retrievedMemory),...(situational&&summary?['Earlier conversation summary (quoted): '+JSON.stringify(summary)]:[]),...(!narration||data.promptId==='custom'?['Read-only reference excerpts (quoted, possibly outdated): '+JSON.stringify(refs)]:[])];
 const system=buildReplyPrompt(document.core,data.text,data.soundDesign,devicePrompt(!data.dialogue&&devices.isEnabled(ws)),data.session,contextNotes,data.dialogue,narration,data.interaction,job.conversation?.context(),data.dualVoice,data.conversationTopic,data,delivery?{mode:delivery,words:deliveryBudget!,visuals:data.adaptiveVisuals}:undefined);
 const tokenCache=new Map<string,number>();const countTokens=async(messages:Message[])=>{const key=JSON.stringify(messages);if(tokenCache.has(key))return tokenCache.get(key)!;const countedAt=performance.now();const count=backend.countTokens?await backend.countTokens(messages,signal):estimateChatTokens(messages);traces.measure(job.id,'tokenization',performance.now()-countedAt);tokenCache.set(key,count);return count;};
 const checkpointPrefix=backend===llama&&nativeCheckpointModel(data.model)?buildFixedReplyPrompt(document.core,data.interaction,data):undefined;
 const plan=await fitContext(system,spokenHistoryMessages(history),data.text,countTokens,data.context,data.maxTokens,backend.countTokens?256:512,narration&&!situational?2048:Math.min(512,data.maxTokens),optionalContext,{fastPlanning:!!backend.countTokens,checkpointPrefix});
 if(!alive())return;traces.mark(job.id,'context-ready');const messages=plan.messages;
 gate=new SpokenOutputGate({request:data.text,narration:narration||data.promptId==='bambi-companion',heardText:[data.sceneHeardText,...history.filter(turn=>turn.role==='assistant').slice(-3).map(turn=>turn.content)].filter(Boolean).join(' ')},async(text,speaker,reason,parentSignal)=>{
  traces.event(job.id,'spoken-contract-repair');
  const correction:Message[]=[...messages,{role:'assistant',content:text},{role:'user',content:'APPLICATION SPOKEN CORRECTION: Replace only the preceding rejected thought. '+reason+' Speaker='+speaker+'. '+(speaker==='bambi'?'Use the imagined listener’s feminine first-person perspective.':'Speak directly as the external female Owner.')+' Return only one complete spoken sentence. No headers, role tags, cues, stage directions or explanation. Preserve its intended meaning and the selected character style.'}];
  if(backend.structured)correction[correction.length-1].content+=' Return a JSON object with only text containing that sentence. This repair format overrides the normal spoken-line transport.';
  return inference.forBackend(backend).run(async()=>{
   const repairSignal=AbortSignal.any([parentSignal,AbortSignal.timeout(20000)]);
   const count=backend.countTokens?await backend.countTokens(correction,repairSignal):estimateChatTokens(correction);
   const budget=Math.min(256,data.context-count-plan.safetyTokens);if(budget<32)throw new SpokenContractError('fragment');
   if(backend.structured){
    const replacement=await backend.structured(correction,data.model,repairSignal,data.context,{type:'object',additionalProperties:false,required:['text'],properties:{text:{type:'string',minLength:1,maxLength:600,pattern:"^[a-zA-Z0-9 ,.!?;:'’()/_-]{1,599}[.!?]$"}}},{maxTokens:budget,temperature:.25});
    if(!replacement||typeof replacement!=='object'||typeof (replacement as {text?:unknown}).text!=='string')throw new SpokenContractError('fragment');
    return (replacement as {text:string}).text;
   }
   let replacement='';for await(const chunk of backend.stream(correction,data.model,repairSignal,data.context,budget,data.sampling)){replacement+=chunk.text;if(replacement.length>1800)throw new SpokenContractError('fragment');}
   return replacement;
  },parentSignal,5);
 });
 data={...data,maxTokens:plan.maxTokens};
 store.metric('llm.context',{requestId:job.id,interaction:data.interaction,systemCharacters:system.length,fixedPromptHash:createHash('sha256').update(buildFixedReplyPrompt(document.core,data.interaction,data)).digest('hex'),inputTokens:plan.inputTokens,maxTokens:plan.maxTokens,safetyTokens:plan.safetyTokens,droppedTurns:plan.droppedTurns,optionalContextIncluded:plan.optionalContextIncluded,context:data.context,memoryRetrieval:retrievedMemory?.mode??'lexical',planningCalls:plan.tokenizerCalls,exactFallback:plan.exactFallback,tokenCount:backend.countTokens?'tokenizer':'estimate'});
 if(data.source==='user'||!situational){const sourceTurn=store.addTurn('user',data.text);const remembered=explicitMemory(data.text);if(remembered)store.saveMemory(remembered.key,remembered.value,sourceTurn);}job.userSaved=true;store.set('replyIntent',intent);
 const blocks:SpokenBlockStream=new SpokenBlockStream(()=>data.dualVoice&&(!situational||['guide','close'].includes(job.turn!.action)),text=>blocks.completedBlocks>=blockBudget.max||job.turn?.action==='ask'&&/[?？]/u.test(text));
 const actionStream=new ActionStream(),dialogueStream=new DialogueDisplayStream();
 displayStream=new ScriptDisplayStream(false,false,data.dualVoice);
 let generationMessages=messages,rawGeneration='',candidateFull='',remaining=data.maxTokens,speechStalled=false,formatFailed=false;
 const deferredActions:unknown[]=[];
 const speechProgress=new SpeechProgressGuard();
 while(alive()&&remaining>0&&!spokenContractFailed){
  let continued=false,batchText='';const generationQueued=performance.now();let generationStarted:number|undefined;
  const turnGrammar=spokenBlockGrammar(backend,{dualVoice:data.dualVoice,situational,generated:!!rawGeneration,closing:job.closing,action:job.turn?.action,presentation:!situational&&data.promptId==='custom',controls:replyControlPrefixes(data.text,narration,data.dialogue,data.interaction,data.soundDesign,!!delivery,devices.isEnabled(ws)),minBlocks:Math.max(0,blockBudget.min-blocks.completedBlocks),maxBlocks:blockBudget.max-blocks.completedBlocks});
  for await(const token of inference.forBackend(backend).stream(backend,generationMessages,data.model,signal,data.context,remaining,data.sampling,turnGrammar,()=>{generationStarted=performance.now();traces.mark(job.id,'generation-start');traces.measure(job.id,'generation-queue-wait',generationStarted-generationQueued);})){
   if(!alive())break;
   if(first&&token.text){first=false;traces.mark(job.id,'first-token');const ms=performance.now()-start;replySend({type:'metric',name:'ttft',value:ms});store.metric('llm.first-token',{requestId:job.id,ms});}
   if(token.text){
    rawGeneration+=token.text;batchText+=token.text;
    const clean=dialogueStream.push(token.text),parsed=actionStream.push(job.turn?job.turn.push(clean):clean);
    let completedPhrase=false;
    if(parsed.display){
     const sentences=blocks.push(parsed.display).map(text=>{const end=job.turn?.action==='ask'?text.search(/[?？]/u):-1;return end<0?text:text.slice(0,end+1);});enqueue(sentences);if(sentences.length)candidateFull+=(candidateFull?' ':'')+sentences.join(' ');
     completedPhrase=sentences.some(sentence=>/\p{L}/u.test(sentence.replace(/\[[^\]]*\]/g,'')));
    }
    if(!situational)deferredActions.push(...parsed.actions);
    if(blocks.error){formatFailed=true;break;}
    if(data.speak&&!ttsFailed&&speechProgress.observe(token.text.length,completedPhrase,blocks.pendingCharacters)){
     speechStalled=true;traces.mark(job.id,'model-output-stalled');traces.event(job.id,'incomplete-speech',{value:speechProgress.pendingCharacters});
     store.metric('llm.incomplete-speech',{requestId:job.id,pendingCharacters:speechProgress.pendingCharacters});break;
    }
   }
   if(token.stats){replySend({type:'stats',data:token.stats});if(backendName==='llama.cpp')store.metric('llm.prefill',{requestId:job.id,...token.stats as Record<string,unknown>});}
   if(spokenContractFailed)break;
   if(blocks.atBoundary&&blocks.completedBlocks>=blockBudget.max&&!(backend.supportsTurnGrammar&&data.promptId==='custom'&&!situational))break;
   if(blocks.atBoundary&&(delivery||data.promptId==='bambi-companion'&&narration?narrationPassageComplete(candidateFull,data.session?.phase,completionRequest):situational?(narration||job.turn?.action==='ask')&&situationalPassageComplete(candidateFull,job.turn!.action,completionRequest):narration&&narrationPassageComplete(candidateFull,data.session?.phase,completionRequest))){store.metric('llm.passage-complete',{requestId:job.id,phase:data.session?.phase??'induction'});break;}
   if(data.speak&&!ttsFailed&&backend.supportsPrefill&&blocks.atBoundary&&blocks.completedBlocks<blockBudget.max&&speechBatchBoundary(batchText)){continued=true;break;}
  }
  if(generationStarted!==undefined)traces.measure(job.id,'generation-batch',performance.now()-generationStarted);
  if(!continued||!alive())break;
  // Releasing the generator above cancels inference while already buffered speech plays.
  // The next request prefills the SAME assistant response; it never restarts the greeting.
  const resumeWait=performance.now();await chain;
  while(alive()&&queuedSentences()>=speechLookahead)await new Promise<void>(resolve=>{job.wake=resolve;setTimeout(resolve,100);});
  if(!alive())break;
  traces.measure(job.id,'speech-backpressure',performance.now()-resumeWait);
  generationMessages=[...messages,{role:'assistant',content:rawGeneration}];
  const inputTokens=await countTokens(generationMessages);
  remaining=Math.min(plan.maxTokens-Math.max(0,inputTokens-plan.inputTokens),data.context-inputTokens-plan.safetyTokens);
  store.metric('llm.lookahead',{requestId:job.id,inputTokens,remaining,batchWords:batchText.replace(/\[[^\]]*\]/g,'').split(/\s+/).filter(Boolean).length,pendingAudio:job.pending.size});
 }

 if(speechStalled){
  // Keep already completed/queued speech, discard the unpronounceable remainder,
  // and report failure so automatic narration cannot restart this same loop.
  replySend({type:'notice',text:'The model stopped producing complete spoken sentences. The unfinished remainder was discarded. You can retry or choose another model.'});
 }else{
  const dialogueTail=dialogueStream.flush(),turnTail=job.turn?job.turn.push(dialogueTail)+job.turn.flush():dialogueTail;
  const finalText=actionStream.push(turnTail).display+actionStream.flush();enqueue(blocks.push(finalText));blocks.finish();formatFailed=!!blocks.error;
 }
 if(formatFailed){traces.event(job.id,'spoken-format-rejected');store.metric('llm.spoken-format',{requestId:job.id,reason:blocks.error?.code??'format'});replySend({type:'notice',text:'The model did not finish a valid spoken block. Completed speech was kept; the unfinished remainder was not spoken.'});}
 traces.mark(job.id,'generated');store.metric('llm.generated',{requestId:job.id,ms:performance.now()-start});await chain;
 if(alive()){const finalDisplay=displayStream.flush();if(finalDisplay)replySend({type:'token',text:finalDisplay});if(!spokenContractFailed&&!formatFailed)for(const action of deferredActions)replySend({type:'action',action});}
 while(alive()&&job.pending.size){await new Promise<void>(resolve=>{job.wake=resolve;setTimeout(resolve,100);});}
 if(alive()){const delivered=data.speak?job.progress.spoken:full;store.addTurn('assistant',delivered,spokenContractFailed?'spoken-contract':formatFailed?'invalid-spoken-format':speechStalled?'incomplete-model-output':ttsFailed?'voice-unavailable':null);const conversationAction=job.turn?.deliveredAction(delivered,job.closing);const expectsReply=conversationAction?job.conversation!.delivered(conversationAction,delivered,job.closing):undefined;for(const text of job.feedback)store.addTurn('user',text);job.feedback=[];job.userSaved=false;replySend({type:'done',id:job.id,audioComplete:data.speak&&!ttsFailed&&!speechStalled&&!spokenContractFailed&&!formatFailed&&sequence>0,...(job.turn?{expectsReply,conversationAction}:{})});traces.finish(job.id,speechStalled||spokenContractFailed||formatFailed?'error':'done');store.metric('llm.done',{requestId:job.id,ms:performance.now()-start});
 store.refreshConversationSummary();
 }
 }catch(e){if(alive()){traces.finish(job.id,'error');if(job.userSaved){store.addTurn('assistant',job.progress.interrupted(job.speak,job.generated),'error');for(const text of job.feedback)store.addTurn('user',text);job.feedback=[];job.userSaved=false;}replySend({type:'error',id:job.id,text:String(e)});store.metric('llm.error',{error:String(e)});}}finally{if(active.get(ws)===job)active.delete(ws);}
}
function handleDeviceMessage(ws:WebSocket,data:any){
 if(!['device-config','device-session','device-command','device-test','device-stop','device-clear','device-status'].includes(data.type))return false;
 if(!access.allowed('devices')&&!['device-stop','device-clear','device-status'].includes(data.type)){send(ws,{type:'device-status',...devices.status,ok:false,permission:'devices',error:'Allow device control in Privacy & access first.'});return true;}
 let ok=true;
 if(data.type==='device-config')ok=devices.configure(ws,data.settings,data.restart===true);
 if(data.type==='device-session')devices.heartbeat(ws,data.session);
 if(data.type==='device-command')ok=devices.command(ws,data.command,data.delayMs??0);
 if(data.type==='device-test')ok=data.settings?devices.preview(ws,data.settings,data.channel,data.intensity):devices.testChannel(ws,data.channel,data.intensity);
 if(data.type==='device-stop')devices.release(ws);
 if(data.type==='device-clear')devices.halt(ws);
 if(data.type!=='device-session')send(ws,{type:'device-status',...devices.status,bridgeProcess:bleBridge.status,owned:devices.isEnabled(ws),ok,...(data.type==='device-test'?{testResult:{ok,channel:data.channel,durationMs:500}}:{})});
 return true;
}
server.on('upgrade',(req,socket,head)=>{if(!localRequestAllowed(req.headers,port,true)||!['/ws','/ws/speech'].includes(req.url??'')){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}if(req.url==='/ws/speech'&&(!access.allowed('microphone')||calibration.busy||calibrationAdmission)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}const target=req.url==='/ws/speech'?speechSockets:wss;target.handleUpgrade(req,socket,head,ws=>target.emit('connection',ws,req));});
wss.on('connection',ws=>{ws.on('error',()=>{});send(ws,{type:'connected',protocolVersion:PROTOCOL_VERSION,replyCorrelation:true,conversationId:store.get('conversationId','legacy')});void health().then(data=>send(ws,{type:'health',data})).catch(()=>{});ws.on('close',()=>{devices.release(ws);cancel(ws,'disconnected');});ws.on('message',raw=>{try{const data=JSON.parse(raw.toString());if(desktopSmoke&&!['interrupt','panic','ack','metric','playback-start'].includes(data.type)){send(ws,{type:'error',requestId:data.requestId,text:'AI, speech and devices are unavailable in this packaging smoke build.'});return;}if(desktopAlpha&&(String(data.type).startsWith('device')||data.model&&data.model!==desktopSetup!.model)){send(ws,{type:'error',requestId:data.requestId,text:'This desktop alpha supports its verified local model; devices are unavailable.'});return;}if((calibration.busy||calibrationAdmission)&&!['interrupt','panic','ack','metric','playback-start','playback-buffer','audio-scheduled','device-stop','device-clear','device-status'].includes(data.type)){send(ws,{type:'error',requestId:data.requestId,text:'Cancel the local AI performance test before starting other work.'});return;}if(handleDeviceMessage(ws,data))return;if(data.type==='feedback-consumed'){consumeFeedback(ws,data);return;}if(data.type==='interrupt'){const report=PlaybackReportSchema.safeParse(data.playback);const current=active.get(ws);if(typeof data.requestId==='string'&&current?.requestId!==data.requestId)return;if(report.success&&report.data.id&&current&&current.id!==report.data.id)return;if(!data.preserveSession||!devices.cancelQueuedPlayback(ws))devices.halt(ws);if(report.success&&current?.id===report.data.id)for(const chunk of report.data.chunks)current.progress.played(chunk.seq,chunk.chars);cancel(ws,'interrupted');return;}if(data.type==='panic'){panic(ws);return;}if(data.type==='ack'){const job=active.get(ws);if(job&&data.id===job.id){if(job.pending.has(data.seq)&&data.played!==false)job.progress.played(data.seq);traces.event(job.id,data.played===false?'audio-discarded':'heard-ack',{seq:data.seq});job.pending.delete(data.seq);job.ahead?.acknowledged(data.seq);job.pendingSentences.delete(data.seq);job.wake();}return;}if(data.type==='playback-buffer'){const job=active.get(ws);const parsed=playbackBufferSchema.safeParse(data);if(job?.ahead&&parsed.success&&job.id===parsed.data.id&&job.requestId===parsed.data.requestId&&job.ahead.observe(parsed.data)){traces.buffer(job.id,job.ahead.snapshot);job.wake();}return;}if(data.type==='audio-scheduled'){const job=active.get(ws);const parsed=audioScheduledSchema.safeParse(data);if(job&&parsed.success&&job.id===parsed.data.id&&job.requestId===parsed.data.requestId&&job.pending.has(parsed.data.seq)){traces.event(job.id,'audio-scheduled',{seq:parsed.data.seq,value:parsed.data.leadSeconds});traces.measure(job.id,'browser-receive-to-schedule',parsed.data.decodeMs);}return;}if(data.type==='playback-start'){const job=active.get(ws);if(job&&job.id===data.id&&job.pending.has(data.seq))traces.mark(job.id,'playback-start');return;}if(data.type==='metric'){store.metric(String(data.name).slice(0,50),data.value);return;}if(data.type==='action'){const action=ActionSchema.safeParse(data.action);if(action.success)send(ws,{type:'action',action:action.data});return;}const parsed=chatSchema.safeParse(data);if(!parsed.success){send(ws,{type:'error',requestId:typeof data.requestId==='string'?data.requestId:undefined,text:'Invalid companion request'});return;}void chat(ws,parsed.data).catch(()=>send(ws,{type:'error',requestId:parsed.data.requestId,text:'The selected inference backend is unavailable.'}));}catch{send(ws,{type:'error',text:'Invalid message'});}});});
// Unknown API paths must not fall through to Vite's HTML fallback in development.
app.use('/api',(_req,res)=>res.status(404).json({error:'Not found'}));
for(const page of ['studio','setup','comparison'])app.get('/'+page,(_req,res)=>res.sendFile(page+'.html',{root:resourcePath(existsSync(resourcePath('dist/web/'+page+'.html'))?'dist/web':'apps/web')}));
if(existsSync(resourcePath('dist/web/index.html')))app.use(express.static(resourcePath('dist/web')));
else if(desktop)throw Error('Packaged web resources missing');
else {const {createServer:createVite}=await import('vite');const vite=await createVite({root:resourcePath('apps/web'),server:{middlewareMode:true,host:'127.0.0.1'},appType:'spa'});app.use(vite.middlewares);}
const savedDevice=store.get('profile',{}) as Record<string,unknown>;
if(!desktop&&access.allowed('devices')&&bleBridge.supported&&savedDevice['device-auto-connect']!==false&&savedDevice['device-bridge']==='local'&&savedDevice['device-address']){
 void bleBridge.connect({address:savedDevice['device-address'],...(savedDevice['device-write-char']?{writeChar:savedDevice['device-write-char']}:{})}).catch(error=>console.warn('Local BLE restore:',String(error)));
}
server.listen(port,'127.0.0.1',()=>console.log(`Bambi Local READY\nhttp://127.0.0.1:${port}`));
process.on('SIGTERM',()=>{desktopSetup?.cancel();streamingSpeech.close();void desktopServices.stop();semanticMemory.close();panic();devices.close();void bleBridge.disconnect();server.close();wss.close();speechSockets.close();setTimeout(()=>process.exit(0),400).unref();});

// The launcher IPC lease closes even after SIGKILL of the Electron parent.
if(desktop){
 if(process.platform==='win32'){
  if(process.env.BAMBI_WINDOWS_JOB_OWNED!=='1')throw Error('Windows desktop backend requires its native owned job');
 }else{process.on('disconnect',()=>process.emit('SIGTERM'));if(!process.connected)throw Error('Desktop backend requires an owned IPC lease');}
}
