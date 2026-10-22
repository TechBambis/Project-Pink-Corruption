// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {z} from 'zod';
import type {HardwareProfile} from '../hardware';
import type {LLMBackend,Message} from '../ai';
import {fitContext} from '../ai/context';
import {ActionStream} from '../ai/actions';
import {DialogueDisplayStream} from '../ai/dialogue';
import {SituationalTurnStream} from '../ai/situational';
import {ScriptDisplayStream} from '../speech/script';
import {buildFixedReplyPrompt,buildReplyPrompt} from '../ai/prompt';
import type {LanguageStyle} from '../ai/language-style';
import type {SamplingProfile} from '../../config/sampling';
import type {ConversationTopic} from '../content/conversation';
import {inferenceThreads,cudaVersion,type AcceleratorDevice} from './accelerator-policy';
import {canDownloadModel,localModelCatalog} from '../ai/model-catalog';
import {validateRuntimeTuning,runtimeDeviceId,type RuntimeTuning} from './runtime-tuning.mjs';

export const calibrationModels=localModelCatalog.filter(canDownloadModel).map(model=>model.alias);
const tuningSchema=z.object({accelerator:z.enum(['auto','cpu']),threads:z.number().int().min(1).max(32),batchSize:z.union([z.literal(128),z.literal(512),z.literal(1024)]),microBatchSize:z.union([z.literal(32),z.literal(128),z.literal(256)]),deviceId:z.string().regex(/^[a-f0-9]{64}$/).optional(),cpuMoeLayers:z.union([z.literal(0),z.literal(30)]).optional()}).strict().refine(value=>{try{validateRuntimeTuning(value);return true;}catch{return false;}});
const numeric=z.number().finite().nonnegative(),nullable=numeric.nullable();
const sampleSchema=z.object({cold:z.boolean(),firstTextMs:numeric,totalMs:numeric,inputTokens:numeric,promptTokens:nullable,cacheTokens:nullable,tokensPerSecond:nullable,firstAudioMs:nullable,speechError:z.string().max(1000).optional()}).strict();
const resultSchema=z.object({tuning:tuningSchema,backend:z.string().max(40),cudaVersion:z.union([z.literal(12),z.literal(13)]).optional(),device:z.string().max(240).nullable(),offloadedLayers:nullable,loadMs:numeric,samples:z.array(sampleSchema).max(4),minimumAvailableBytes:nullable,peakHostBytes:nullable,error:z.string().max(1000).optional()}).strict();
const profileSchema=z.object({schema:z.literal(1),key:z.string().regex(/^[a-f0-9]{64}$/),model:z.enum(calibrationModels as [string,...string[]]),createdAt:numeric,context:z.number().int().positive(),promptHash:z.string().regex(/^[a-f0-9]{64}$/),results:z.array(resultSchema).max(40),winner:z.number().int().min(0).max(39).nullable(),quality:z.literal('unreviewed'),speechTested:z.boolean()}).strict().refine(value=>value.winner===null||value.winner<value.results.length,'Invalid winner');
export type CalibrationSample=z.infer<typeof sampleSchema>;
export type CalibrationResult=z.infer<typeof resultSchema>;
export type CalibrationProfile=z.infer<typeof profileSchema>;
export type CalibrationState={phase:'idle'|'running'|'complete'|'cancelled'|'failed';model?:string;configuration:number;configurations:number;turn:number;stage:string;startedAt?:number;error?:string;profile?:CalibrationProfile;modelIndex?:number;modelCount?:number;profiles?:CalibrationProfile[];modelErrors?:{model:string;error:string}[];comparisons?:{model:string;performance:ReturnType<typeof calibrationPerformance>;error?:string}[]};
export const calibrationHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Volatile free-memory/load readings do not identify a machine or invalidate a profile. */
export function calibrationHardware(hardware:HardwareProfile){return {platform:hardware.platform,architecture:hardware.architecture,cpu:hardware.cpu,cpuThreads:hardware.cpuThreads,ramTotal:hardware.ramTotal,unifiedMemory:hardware.unifiedMemory,gpus:hardware.gpus.map(g=>({name:g.name,memoryTotal:g.memoryTotal,driverVersion:g.driverVersion??null})).sort((a,b)=>a.name.localeCompare(b.name))};}
export function calibrationConfigurations(threads:number,batchSize:number,microBatchSize:number,acceleration:'auto'|'cpu'='auto',devices:AcceleratorDevice[]=[],model=''):RuntimeTuning[]{
 const count=inferenceThreads(threads),baseline={threads:count,batchSize:batchSize===128?128:512,microBatchSize:microBatchSize===32?32:128};
 const configurations:RuntimeTuning[]=[validateRuntimeTuning({accelerator:'auto',...baseline}),validateRuntimeTuning({accelerator:'cpu',...baseline}),validateRuntimeTuning({accelerator:'cpu',threads:Math.max(1,Math.floor(count/2)),batchSize:128,microBatchSize:32})];
 if(threads>12)configurations.push(validateRuntimeTuning({accelerator:'cpu',threads:Math.min(32,threads-4),batchSize:512,microBatchSize:128}));
 if(acceleration!=='cpu')for(const device of devices.slice(0,16)){
  const target={accelerator:'auto',...baseline,deviceId:runtimeDeviceId(device),...(model.includes('35b')?{cpuMoeLayers:0}:{})};
  configurations.push(validateRuntimeTuning(target));
  if(device.freeMiB!==null&&device.freeMiB>=8192)configurations.push(validateRuntimeTuning({...target,batchSize:1024,microBatchSize:256}));
 }
 return configurations.filter((value,index,all)=>(acceleration!=='cpu'||value.accelerator==='cpu')&&all.findIndex(other=>calibrationHash(other)===calibrationHash(value))===index);
}
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const responseScore=(result:CalibrationResult,speech:boolean)=>median(result.samples.filter(sample=>!sample.cold).map(sample=>Math.max(sample.firstTextMs+48000/sample.tokensPerSecond!,speech?sample.firstAudioMs!:0)));
export function calibrationPerformance(profile:CalibrationProfile){
 const result=profile.winner===null?null:profile.results[profile.winner],warm=result?.samples.filter(sample=>!sample.cold)??[];
 if(!result||result.error||warm.length!==3)return null;
 const firstTextMs=median(warm.map(sample=>sample.firstTextMs)),rates=warm.flatMap(sample=>sample.tokensPerSecond===null?[]:[sample.tokensPerSecond]);
 const firstAudioMs=warm.every(sample=>sample.firstAudioMs!==null)?median(warm.map(sample=>sample.firstAudioMs!)):null;
 const rate=rates.length?median(rates):null;
 const responsive=firstTextMs<=3000&&rate!==null&&rate>=12&&(firstAudioMs===null||firstAudioMs<=5000),usable=firstTextMs<=12000&&rate!==null&&rate>=4&&(firstAudioMs===null||firstAudioMs<=15000);
 return {firstTextMs,firstAudioMs,coldFirstTextMs:result.samples.find(sample=>sample.cold)?.firstTextMs??null,loadMs:result.loadMs,minimumAvailableBytes:result.minimumAvailableBytes,peakHostBytes:result.peakHostBytes,tokensPerSecond:rate,backend:result.backend,...(result.cudaVersion?{cudaVersion:result.cudaVersion}:{}),device:result.device,tuning:result.tuning,verdict:rate===null?'unknown':responsive?'responsive':usable?'usable':'slow',scope:firstAudioMs===null?'text-measured':'text-and-synthesis-measured',quality:'unreviewed' as const,createdAt:profile.createdAt};
}
function winningResult(results:CalibrationResult[],speech:boolean){
 let best:number|null=null,score=Infinity;
 for(const [index,result] of results.entries()){
  const warm=result.samples.filter(sample=>!sample.cold);
  if(result.error||warm.length!==3||speech&&warm.some(sample=>sample.firstAudioMs===null||sample.speechError))continue;
  if(warm.some(sample=>sample.tokensPerSecond===null||!Number.isFinite(sample.tokensPerSecond)||sample.tokensPerSecond<=0))continue;
  // Observed low headroom rejects automatic tuning; measurements are not a memory-limit override.
  if(result.minimumAvailableBytes!==null&&result.minimumAvailableBytes<256*2**20)continue;
  // Estimate a short reply's delivery time, so a quick first token cannot hide
  // unusably slow decoding. Compare the same bounded workload on each path.
  const value=responseScore(result,speech);
  if(value<score*.9){best=index;score=value;}
 }
 return best;
}
/** Bounded private file, strict schema, atomic replace; no prompts, responses, audio or credentials. */
export class CalibrationProfiles {
 constructor(readonly path:string){}
 async list():Promise<CalibrationProfile[]>{try{const stat=await lstat(this.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)return [];const value=z.array(profileSchema).max(24).safeParse(JSON.parse(await readFile(this.path,'utf8')));return value.success?value.data:[];}catch{return [];}}
 async find(key:string){return (await this.list()).find(profile=>profile.key===key&&profile.createdAt<=Date.now()&&Date.now()-profile.createdAt<7*86400000);}
 async save(profile:CalibrationProfile,signal:AbortSignal){
  profileSchema.parse(profile);signal.throwIfAborted();await mkdir(dirname(this.path),{recursive:true,mode:0o700});
  const profiles=[profile,...(await this.list()).filter(item=>item.key!==profile.key)].slice(0,24),temporary=this.path+'.'+randomUUID()+'.partial';
  try{await writeFile(temporary,JSON.stringify(profiles),{flag:'wx',mode:0o600});signal.throwIfAborted();await rename(temporary,this.path);}finally{await rm(temporary,{force:true});}
 }
}
export interface CalibrationInput extends LanguageStyle {model:string;context:number;base:string;sampling:SamplingProfile;interaction:'reactive'|'situational';conversationTopic:ConversationTopic;key:string;cpuThreads:number;batchSize:number;microBatchSize:number;speech:boolean;acceleration?:'auto'|'cpu'}
export interface CalibrationOperations {
 exclusive<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>;
 prepare(tuning:RuntimeTuning,signal:AbortSignal):Promise<void>;
 devices?(signal:AbortSignal):Promise<AcceleratorDevice[]>;
 stop():Promise<void>;
 backend:LLMBackend;
 capabilities():{backend:string|null;cudaVersion?:12|13;device?:string;offloadedLayers?:number};
 memory():{available:number;hostBytes?:number};
 speech?(signal:AbortSignal,sampleText:string):Promise<void>;
 save(profile:CalibrationProfile,signal:AbortSignal):Promise<void>;
}
/** Uses the app's one local inference slot and runtime owner; no independent runner or history writes. */
export class ModelCalibration {
 private controller:AbortController|null=null;private task:Promise<void>|null=null;
 state:CalibrationState={phase:'idle',configuration:0,configurations:0,turn:0,stage:'idle'};
 get busy(){return this.controller!==null;}
 cancel(){this.controller?.abort(Error('Performance test cancelled.'));}
 start(input:CalibrationInput|CalibrationInput[],operations:CalibrationOperations|((input:CalibrationInput)=>CalibrationOperations),restore?:()=>Promise<void>){
  if(this.busy)throw Error('A performance test is already running.');
  const inputs=Array.isArray(input)?input:[input],operationFor=typeof operations==='function'?operations:()=>operations;
  if(!inputs.length||inputs.length>calibrationModels.length||new Set(inputs.map(item=>item.model)).size!==inputs.length||inputs.some(item=>!calibrationModels.includes(item.model)))throw Error('Choose supported catalog models for the performance comparison.');
  if(inputs.some(item=>!operationFor(item).backend.countTokens))throw Error('Performance testing needs the native tokenizer.');
  const controller=new AbortController();this.controller=controller;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(120*60*1000)]);
  this.state={phase:'running',model:inputs[0].model,configuration:0,configurations:0,turn:0,stage:'waiting-for-local-AI',startedAt:Date.now(),modelIndex:1,modelCount:inputs.length,profiles:[],modelErrors:[]};
  this.task=(async()=>{
   try{for(const [index,item] of inputs.entries()){
    signal.throwIfAborted();this.state={...this.state,phase:'running',model:item.model,modelIndex:index+1,configuration:0,configurations:0,turn:0,stage:'checking-GPU-paths',error:undefined,profile:undefined};
    try{await this.run(item,operationFor(item),AbortSignal.any([signal,AbortSignal.timeout(60*60*1000)]));if(this.state.profile)this.state.profiles!.push(this.state.profile);if(this.state.phase==='failed')this.state.modelErrors!.push({model:item.model,error:this.state.error??'No configuration passed.'});}
    catch(error){signal.throwIfAborted();this.state.modelErrors!.push({model:item.model,error:error instanceof Error?error.message:'Model test failed.'});}
    this.state={...this.state,phase:'running'};
   }}finally{if(restore){this.state={...this.state,phase:'running',stage:'restoring-selected-model'};await restore();}}
   signal.throwIfAborted();this.state={...this.state,phase:this.state.profiles!.some(profile=>profile.winner!==null)?'complete':'failed',stage:'complete',error:this.state.profiles!.some(profile=>profile.winner!==null)?undefined:'No measured configuration passed.'};
  })().catch(error=>{this.state={...this.state,phase:controller.signal.aborted?'cancelled':'failed',stage:'stopped',error:error instanceof Error?error.message:'Performance test failed.'};}).finally(()=>{this.controller=null;});
 }
 async settled(){await this.task;}
 private async run(input:CalibrationInput,operations:CalibrationOperations,signal:AbortSignal){
  await operations.exclusive(async()=>{
   await operations.stop();signal.throwIfAborted();
   const devices=input.acceleration==='cpu'?[]:await operations.devices?.(signal)??[],configs=calibrationConfigurations(input.cpuThreads,input.batchSize,input.microBatchSize,input.acceleration,devices,input.model);
   this.state={...this.state,configurations:configs.length+1};
   const results:CalibrationResult[]=[];let keepReady=false,provisionalWinner:number|null=null;const comparisonCount=configs.length,voiceSeed=parseInt(randomUUID().slice(0,8),16);
   try{
    for(const [index,tuning] of configs.entries()){
     signal.throwIfAborted();this.state={...this.state,configuration:index+1,turn:0,stage:'starting-'+tuning.accelerator};
     const result:CalibrationResult={tuning,backend:'unverified',device:null,offloadedLayers:null,loadMs:0,samples:[],minimumAvailableBytes:null,peakHostBytes:null};results.push(result);
     if(tuning.deviceId){const version=cudaVersion(devices.find(device=>runtimeDeviceId(device)===tuning.deviceId));if(version)result.cudaVersion=version;}
     const configurationSignal=AbortSignal.any([signal,AbortSignal.timeout(7*60*1000)]);
     try{
      const loaded=performance.now();await operations.prepare(tuning,configurationSignal);result.loadMs=performance.now()-loaded;
      const capabilities=operations.capabilities();result.backend=capabilities.backend??'unverified';result.device=capabilities.device??null;result.offloadedLayers=capabilities.offloadedLayers??null;
      if(result.backend==='cuda'&&capabilities.cudaVersion)result.cudaVersion=capabilities.cudaVersion;
      else if(result.backend!=='cuda')delete result.cudaVersion;
      if(result.backend==='unverified')throw Error('Actual CPU/GPU use could not be verified.');
      if(tuning.deviceId&&(result.backend==='cpu'||!result.offloadedLayers))throw Error('The selected GPU path did not provide verified layer offloading.');
      let memoryError:Error|undefined;
      const sampleMemory=()=>{try{const value=operations.memory();if(!Number.isFinite(value.available)||value.available<0)throw Error('Available memory could not be measured.');result.minimumAvailableBytes=Math.min(result.minimumAvailableBytes??Infinity,value.available);if(value.hostBytes!==undefined&&Number.isFinite(value.hostBytes)&&value.hostBytes>=0)result.peakHostBytes=Math.max(result.peakHostBytes??0,value.hostBytes);if(value.available<128*2**20)throw Error('Available memory became too low. Test stopped before continuing.');}catch(error){memoryError=error instanceof Error?error:Error('Memory measurement failed.');turnController?.abort(memoryError);}};
      let turnController:AbortController|undefined,pendingSpeech:Promise<void>|undefined;sampleMemory();const sampler=setInterval(sampleMemory,500);
      try{
       const history:Message[]=[],requests=['This is a performance test. Explain in two short sentences why taking a short break can help concentration.','Now suggest one simple way to take that break. Keep it to two sentences.','Adjust your suggestion for someone sitting at a desk. Use two short sentences.','Finish with two short sentences explaining when to return to the task.'];
       for(const [turn,request] of requests.entries()){
        if(memoryError)throw memoryError;configurationSignal.throwIfAborted();turnController=new AbortController();
        const turnSignal=AbortSignal.any([configurationSignal,turnController.signal,AbortSignal.timeout(240000)]),started=performance.now();
        this.state={...this.state,turn:turn+1,stage:turn===0?'processing-full-prompt':'measuring-follow-up'};
        const system=buildReplyPrompt(input.base,request,false,'Device control is disabled.',undefined,'',true,false,input.interaction,'',false,input.conversationTopic,input);
        const plan=await fitContext(system,history,request,messages=>operations.backend.countTokens!(messages,turnSignal),input.context,96,256,96,'',{fastPlanning:true,checkpointPrefix:buildFixedReplyPrompt(input.base,input.interaction,input)});
        let firstTextMs:number|null=null,firstAudioMs:number|null=null,speechError:string|undefined,text='',stats:any,speech:Promise<void>|undefined;
        const dialogue=new DialogueDisplayStream(),actions=new ActionStream(),display=new ScriptDisplayStream(false,false,false),turnDisplay=input.interaction==='situational'?new SituationalTurnStream():undefined;
        const observeVisible=(visible:string)=>{
         if(visible.trim()&&firstTextMs===null){firstTextMs=performance.now()-started;
          // Each public synthetic phrase is unique, so the normal TTS phrase cache
          // cannot turn an audio-load test into a cached-file lookup.
          if(input.speech&&operations.speech)speech=pendingSpeech=operations.speech(turnSignal,`Sample ${voiceSeed} ${index+1} ${turn+1} checks local voice performance.`).then(()=>{firstAudioMs=performance.now()-started;}).catch(error=>{speechError=error instanceof Error?error.message:'Speech test failed.';});
         }
        };
        for await(const chunk of operations.backend.stream(plan.messages,input.model,turnSignal,input.context,plan.maxTokens,input.sampling)){
         const clean=dialogue.push(chunk.text);observeVisible(display.push(actions.push(turnDisplay?turnDisplay.push(clean):clean).display));
         text+=chunk.text;if(text.length>32000)throw Error('Performance response exceeded its bound.');if(chunk.stats)stats=chunk.stats;
        }
        const tail=dialogue.flush(),turnTail=turnDisplay?turnDisplay.push(tail)+turnDisplay.flush():tail;
        observeVisible(display.push(actions.push(turnTail).display+actions.flush())+display.flush());
        await speech;turnSignal.throwIfAborted();sampleMemory();if(memoryError)throw memoryError;
        if(firstTextMs===null||!text.trim())throw Error('The model returned no visible text.');
        const duration=typeof stats?.eval_duration==='number'?stats.eval_duration:0,count=typeof stats?.eval_count==='number'?stats.eval_count:0;
        result.samples.push({cold:turn===0,firstTextMs,totalMs:performance.now()-started,inputTokens:plan.inputTokens,promptTokens:typeof stats?.prompt_tokens==='number'?stats.prompt_tokens:null,cacheTokens:typeof stats?.cache_tokens==='number'?stats.cache_tokens:null,tokensPerSecond:duration>0&&count>0?count/(duration/1e9):null,firstAudioMs,...(speechError?{speechError:speechError.slice(0,1000)}:{})});
        history.push({role:'user',content:request},{role:'assistant',content:text});turnController.abort();
       }
      }finally{clearInterval(sampler);turnController?.abort();await pendingSpeech;}
     }catch(error){signal.throwIfAborted();result.error=(error instanceof Error?error.message:'Configuration failed.').slice(0,1000);}
     finally{await operations.stop();}
     if(index===comparisonCount-1){provisionalWinner=winningResult(results,input.speech);if(provisionalWinner!==null)configs.push(results[provisionalWinner].tuning);}
    }
    signal.throwIfAborted();let winner:number|null=null;
    // Repeat the selected configuration after a fresh load, rather than trusting a single run.
    if(provisionalWinner!==null&&results.length===comparisonCount+1){
     const repeated=results.at(-1)!;
     if(winningResult([repeated],input.speech)!==null){
      const score=(result:CalibrationResult)=>responseScore(result,input.speech);
      if(score(repeated)<=Math.max(score(results[provisionalWinner])*1.5,score(results[provisionalWinner])+1000))winner=results.length-1;
     }
    }
    const profile:CalibrationProfile={schema:1,key:input.key,model:input.model,createdAt:Date.now(),context:input.context,promptHash:calibrationHash(buildFixedReplyPrompt(input.base,input.interaction,input)),results,winner,quality:'unreviewed',speechTested:input.speech};
    if(winner===null){this.state={...this.state,phase:'failed',stage:'complete',error:'No configuration passed both the comparison and repeat test with sufficient memory. Verified files are kept.',profile};return;}
    this.state={...this.state,stage:'applying-measured-settings'};await operations.prepare(results[winner].tuning,signal);signal.throwIfAborted();await operations.save(profile,signal);signal.throwIfAborted();keepReady=true;
    this.state={...this.state,phase:'complete',stage:'complete',profile};
   }finally{if(!keepReady)await operations.stop();}
  },signal);
 }
}
