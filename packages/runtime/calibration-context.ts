// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {stat,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import os from 'node:os';
import {buildCharacterDocument} from '../ai/character';
import {ChatRequestSchema} from '../ai/request';
import {buildSituationalBase} from '../content/situational';
import {buildFixedReplyPrompt} from '../ai/prompt';
import {downloadableModel} from '../ai/model-catalog';
import {resourcePlan} from './resource-plan';
import {acceleratorMode} from './accelerator-policy';
import {calibrationHardware,calibrationHash,calibrationModels} from './model-calibration';
import {hardwareProfile} from '../hardware';
import {backendRuntimeFiles} from './accelerator-runtime.mjs';
import {llamaExecutable,speechExecutable} from './executables';
import {desktopAlpha,resourcePath} from './paths';

const buildCache=new Map<string,{signature:string;hash:Promise<string>}>();
async function fileHash(path:string){
 const info=await stat(path),signature=[info.size,info.mtimeMs,info.ctimeMs].join(':'),cached=buildCache.get(path);
 if(cached?.signature===signature)return cached.hash;
 // Concurrent model comparisons share one streaming hash of large CUDA libraries.
 const hash=(async()=>{const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);const after=await stat(path);if([after.size,after.mtimeMs,after.ctimeMs].join(':')!==signature)throw Error('Runtime changed during performance profile identification.');return digest.digest('hex');})();
 buildCache.set(path,{signature,hash});
 try{return await hash;}catch(error){if(buildCache.get(path)?.hash===hash)buildCache.delete(path);throw error;}
}
async function optionalHash(path:string){try{return await fileHash(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export async function calibrationContext(model:string,profile:Record<string,unknown>,speech:boolean){
 if(!calibrationModels.includes(model))throw Error('Performance testing requires a supported pinned catalog model.');
 const pin=downloadableModel(model),hardware=await hardwareProfile(),acceleration=acceleratorMode(desktopAlpha?process.env.BAMBI_DESKTOP_ACCELERATOR:process.env.BAMBI_ACCELERATOR);
 let selectedTriggers:unknown=[];try{selectedTriggers=JSON.parse(String(profile['trigger-selection']??'[]'));}catch{}
 const settings=ChatRequestSchema.omit({type:true,text:true}).parse({model,context:pin.context,promptId:profile['prompt-template']??'bambisleep-classic',persona:profile.persona,username:profile['bambi-name'],selectedTriggers,collar:profile['collar-enabled']===true,collarName:profile['collar-name'],sampling:profile['sampling-profile']==='creative'?'creative':'qwen',interaction:profile['session-interaction']==='situational'?'situational':'reactive',conversationTopic:profile['conversation-topic']??'general',voice:profile.voice,speed:profile.speed===undefined?undefined:Number(profile.speed),preset:profile['audio-preset']});
 const authored=buildCharacterDocument(settings).core,base=settings.interaction==='situational'?buildSituationalBase(settings,authored):authored;
 const binary=desktopAlpha?llamaExecutable():resolve('.runtime/lib/ollama/llama-server');
 const binaries=[binary,...backendRuntimeFiles(dirname(binary),process.platform)];
 const runtime=await Promise.all(binaries.map(async path=>({file:path.split(/[\\/]/).slice(-2).join('/'),sha256:await fileHash(path)})));
 let voiceRuntime:unknown=null;
 if(speech){
  const models=process.env.BAMBI_MODELS_ROOT??resolve('models'),sources=resourcePath('packages/speech/local');
  const sourceHashes=desktopAlpha?[]:await Promise.all((await readdir(sources)).filter(name=>name.endsWith('.py')).sort().map(async name=>({file:name,sha256:await fileHash(resolve(sources,name))})));
  voiceRuntime={engine:await fileHash(desktopAlpha?speechExecutable():resolve('.runtime/tts-venv/bin/python')),sourceHashes,model:await fileHash(resolve(models,'kokoro/kokoro-v1.0.onnx')),voices:await fileHash(resolve(models,'kokoro/voices-v1.0.bin')),preset:await fileHash(resourcePath('presets/audio',settings.preset+'.json')),cpuProfile:await optionalHash(resolve(process.env.BAMBI_DATA_ROOT??'.','runtime/tts-cpu-profile.json')),threads:process.env.BAMBI_TTS_THREADS??null,dynamicBlock:process.env.BAMBI_TTS_DYNAMIC_BLOCK??null};
 }
 const promptHash=calibrationHash(buildFixedReplyPrompt(base,settings.interaction)),plan=resourcePlan(hardware,{weightsBytes:pin.bytes,contextTokens:pin.context,memoryProfile:pin.memoryProfile,resourceProfile:pin.resourceProfile});
 // Cache validity includes OS/driver/build, exact artifact, workload and voice configuration.
 const key=calibrationHash({version:3,hardware:calibrationHardware(hardware),osRelease:os.release(),runtime,model:pin.sha256,context:pin.context,cache:'f16',plan,promptHash,sampling:settings.sampling,interaction:settings.interaction,conversationTopic:settings.conversationTopic,speech,...(speech?{voice:settings.voice,speed:settings.speed,preset:settings.preset,voiceRuntime}:{}),accelerationOverride:desktopAlpha?process.env.BAMBI_DESKTOP_ACCELERATOR??'auto':process.env.BAMBI_ACCELERATOR??'auto'});
 return {input:{model,context:pin.context,base,sampling:settings.sampling,interaction:settings.interaction,conversationTopic:settings.conversationTopic,key,cpuThreads:hardware.cpuThreads,batchSize:plan.batchSize,microBatchSize:plan.microBatchSize,speech,acceleration},settings,hardware};
}
