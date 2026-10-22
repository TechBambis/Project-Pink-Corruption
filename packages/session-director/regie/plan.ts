// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { sceneNames } from '../../safety/actions';
import { deliveryModes } from '../delivery';
import { sessionPhases } from '../phases';
import { availableModules, PoolSchema, spiralStyles } from './registry';
import {effectForTrigger,implicitTriggerNames} from '../../../config/trigger-sequence';
import {breathInstruction,pacedBreathCycle,hasPacedBreathInstruction,requestedBreathCycles} from '../../speech/breath';
import {journeyIds} from '../journeys';
import {validateSpokenText,SpokenContractError} from '../../speech/contract';
import {StoryMomentSchema,StoryProgressSchema,nextStoryMoment} from './story-contract';

// Keep character and length constraints together: llama.cpp's pattern branch
// takes precedence over maxLength. Exclude JSON delimiters and controls because
// that branch emits the pattern directly inside its quoted grammar rule.
const plain = (max:number,complete=false) => z.string().trim().min(1).max(max)
  .regex(new RegExp(String.raw`^[^"\\\x00-\x1F\[\]<>\x60]{${complete?0:1},${complete?max-1:max}}${complete?'[.!?]':''}$`),'Plain text required')
  .refine(t=>!t.includes('```'),'Plain text required');
const thought = plain(240,true).refine(t=>/[.!?]$/.test(t),'Use a complete spoken thought');
const answer = plain(200,true).refine(t=>/[.!?]$/.test(t),'Use a complete inner response');
const unit = z.number().finite().min(0).max(1);
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/);
export const LookSchema = z.object({
  scene:z.enum(sceneNames), motif:z.enum(['ring','heart','gears']).nullable(), motifId:identifier.nullable(),
  style:z.enum(spiralStyles).nullable(), visualDensity:unit, motion:unit, ambient:unit, effects:unit,
}).strict();
const common = {id:identifier, look:LookSchema, delivery:z.enum(deliveryModes), pauseAfterMs:z.number().int().min(0).max(8000)};
const target = z.object({label:plain(48),source:z.enum(['user','heard','planned']),quote:plain(240)}).strict();
export const RewardSchema=z.object({kind:z.enum(['scene','breath']),look:LookSchema}).strict();
const challengeFields={challengeId:identifier,request:plain(240),phrase:answer,criterion:plain(240),reward:RewardSchema,maxAttempts:z.number().int().min(1).max(3)};
export const InteractionContextSchema=z.object({...challengeFields,attempt:z.number().int().min(1).max(3),response:z.string().trim().min(1).max(2000).nullable(),timedOut:z.boolean(),resumeStrategy:z.string().max(600),resumeOutlook:z.string().max(2000)}).strict();
export type InteractionContext=z.infer<typeof InteractionContextSchema>;
export const ActionSchema = z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('guide'),text:thought}).strict(),
  z.object({...common,kind:z.literal('reveal'),text:thought,anchor:plain(80),before:LookSchema,holdMs:z.number().int().min(500).max(8000)}).strict(),
  z.object({...common,kind:z.literal('hold'),durationMs:z.number().int().min(500).max(12000)}).strict(),
  z.object({...common,kind:z.literal('reply'),invitation:thought,text:answer,previewMs:z.number().int().min(700).max(4000),responseMs:z.number().int().min(1000).max(8000)}).strict(),
  z.object({...common,...challengeFields,kind:z.literal('challenge'),invitation:thought,responseMs:z.number().int().min(4000).max(20000)}).strict(),
  z.object({...common,kind:z.literal('breath'),preparation:thought,inText:plain(48),outText:plain(48),inMs:z.number().int().min(1000).max(8000),outMs:z.number().int().min(1000).max(8000),cycles:z.number().int().min(1).max(3)}).strict(),
  z.object({...common,kind:z.literal('wipe'),text:thought,target,wipeMs:z.number().int().min(1000).max(12000)}).strict(),
  z.object({...common,kind:z.literal('sleep_return'),preparation:thought,holdMs:z.number().int().min(500).max(8000),returnText:thought}).strict(),
  z.object({...common,kind:z.literal('trigger'),preparation:thought,phrase:plain(100),target:target.nullable(),wipeMs:z.number().int().min(0).max(12000),holdMs:z.number().int().min(500).max(8000)}).strict(),
  z.object({...common,kind:z.literal('contrast'),narrow:LookSchema,textA:thought,textB:thought,cycles:z.number().int().min(1).max(3),gapMs:z.number().int().min(500).max(4000)}).strict(),
  z.object({...common,kind:z.literal('repeat'),invitation:thought,text:answer,count:z.number().int().min(2).max(4),previewMs:z.number().int().min(700).max(4000),responseMs:z.number().int().min(1000).max(8000)}).strict(),
  z.object({...common,kind:z.literal('peak'),text:thought,rhythm:z.boolean()}).strict(),
  z.object({...common,kind:z.literal('recall'),text:thought}).strict(),
  z.object({...common,kind:z.literal('reset'),text:thought,returnText:thought}).strict(),
  z.object({...common,kind:z.literal('self'),text:thought,perspective:z.enum(['original','old'])}).strict(),
  z.object({...common,kind:z.literal('blink'),preparation:thought,returnText:thought,restMs:z.number().int().min(500).max(4000)}).strict(),
]);
export const ScenePlanSchema = z.object({
  version:z.literal(1),id:identifier, strategy:plain(600), rationale:plain(600),
  continuity:plain(600), openThreads:z.array(plain(120)).max(6),
  moment:StoryMomentSchema.optional(),
  resolution:z.object({challengeId:identifier,outcome:z.enum(['grant','retry','continue']),reason:plain(300)}).strict().nullable().default(null),
  sections:z.array(z.object({id:identifier,purpose:plain(300),actions:z.array(ActionSchema).min(1).max(8)}).strict()).min(1).max(3),
}).strict();
export type ScenePlan = z.input<typeof ScenePlanSchema>;
export type SceneAction = z.infer<typeof ActionSchema>;
export type SceneLook = z.infer<typeof LookSchema>;
export const PlanningContextSchema = z.object({
  participation:z.enum(['interactive','uninterrupted']).default('interactive'),journey:z.enum([...journeyIds,'custom']).default('custom'),
  phase:z.enum(sessionPhases),windowMs:z.number().finite().min(1500).max(90000),intensity:unit,
  pool:PoolSchema, userContext:z.string().max(2000), heardText:z.string().max(4000), feedback:z.string().max(2000),
  previousStrategy:z.string().max(600),openThreads:z.array(z.string().max(120)).max(6),
  plannedOutlook:z.string().max(2000).default(''),
  interruptedOutlook:z.string().max(2000).default(''),
  interaction:InteractionContextSchema.nullable().default(null),
  resolvedRequests:z.array(z.object({request:plain(240),outcome:z.enum(['grant','continue']),reason:plain(300)}).strict()).max(8).default([]),
  knownMotifs:z.array(z.object({id:identifier,meaning:plain(200),form:z.enum(['ring','heart','gears']).nullable().default(null)}).strict()).max(32),
  committedMotifs:z.array(z.object({id:identifier,meaning:plain(200),form:z.enum(['ring','heart','gears']).nullable().default(null)}).strict()).max(32).default([]),
  currentLook:LookSchema.optional(),
  currentMotifMotion:z.object({kind:z.enum(['heart_turn','coin_scan']),startMs:z.number().finite().min(0),periodMs:z.number().finite().min(1000).max(30000),strength:unit}).strict().optional(),
  breathCyclesAlreadyCommitted:z.number().int().min(0).max(99).default(0),
  story:StoryProgressSchema.optional(),
}).strict();
export type PlanningContext = z.input<typeof PlanningContextSchema>;
const contains = (text:string,part:string) => text.toLocaleLowerCase().includes(part.toLocaleLowerCase());
const namedPhrase = (text:string,phrase:string) => new RegExp('\\b'+phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','i').test(text);
/** In engine-authored scenes a name is ordinary speech, not an implicit cue.
 * The catalog also contains the standalone name Bambi. Its explicit trigger
 * action remains available; compound cues such as Bambi Sleep stay reserved. */
export function sceneCuePhrases(phrases:readonly string[]){return implicitTriggerNames(phrases);}
export function actionTexts(action:SceneAction):string[] {
  switch(action.kind) {
    case 'hold':return [];
    case 'reply':case 'repeat':return [action.invitation,action.text];
    case 'challenge':return [action.invitation,action.phrase];
    case 'breath':return [action.preparation,action.inText,action.outText];
    case 'sleep_return':case 'blink':return [action.preparation,action.returnText];
    case 'trigger':return [action.preparation]; // The engine owns its exact cue text.
    case 'contrast':return [action.textA,action.textB];
    case 'reset':return [action.text,action.returnText];
    default:return [action.text];
  }
}

export interface SceneFieldIssue {actionId:string;field:'text'|'anchor'|'preparation';reason:string}
export class SceneFieldError extends Error {
  constructor(readonly issue:SceneFieldIssue){super(issue.reason);this.name='SceneFieldError';}
}
/** Punctuation is a word boundary too; removing spaces after commas cannot
 * evade the synthesis budget. Contractions retain their natural word count. */
export function sceneWordCount(text:string){return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length??0;}
/** Coarse pre-synthesis resource ceiling, not a duration estimate. Natural
 * 26-word thoughts can measure only 11 seconds; actual PCM still must fit 20 s. */
export const sceneSpeechWordCeiling=40;
/** Corrections may change these spoken fields only. Module selection, looks,
 * timings, requests, rewards and transport remain the original plan's data. */
export function sceneFieldIssues(plan:ScenePlan,maxWords?:number,heard?:{heardText:string;feedback:string}):SceneFieldIssue[]{
  return plan.sections.flatMap(section=>section.actions.flatMap(action=>{
    if(action.kind!=='guide'&&action.kind!=='reveal'&&action.kind!=='breath')return [];
    const field=action.kind==='breath'?'preparation':'text',text=action.kind==='breath'?action.preparation:action.text;
    const issues:SceneFieldIssue[]=[];
    if(heard&&action.kind!=='breath')try{validateSpokenText(text,{narration:true,heardText:heard.heardText,request:heard.feedback});}catch(error){if(error instanceof SpokenContractError&&error.code==='repetition')issues.push({actionId:action.id,field,reason:error.message});}
    if(pacedBreathCycle(text)||hasPacedBreathInstruction(text))issues.push({actionId:action.id,field,reason:'Paced In/Out instructions belong in an enabled breath action. Rewrite this complete thought without inhale/exhale instructions; retain the current scene meaning.'});
    if(maxWords&&sceneWordCount(text)>maxWords)issues.push({actionId:action.id,field,reason:'Use at most '+maxWords+' spoken words per field. Rewrite a shorter complete thought; never truncate its ending or join words to fit.'});
    if(action.kind==='reveal'&&(!contains(action.text,action.anchor)||action.text.toLocaleLowerCase().split(action.anchor.toLocaleLowerCase()).length!==2))issues.push({actionId:action.id,field:'anchor',reason:'Reveal anchor must quote one contiguous, unambiguous phrase from its spoken thought.'});
    return issues;
  }));
}

/** Text-only choices, not timestamps. Prefer short phrases near the requested
 * meaning; every offered choice is copied from the unchanged spoken text. */
export function sceneAnchorChoices(text:string,preferred:string):string[]{
  const words=[...text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)],wanted=new Set(preferred.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
  const articles=new Set(['a','an','the','i','you','it','and','with','in','of','my','your','is','to','that','this','for','as','at']);
  const candidates:{text:string;score:number}[]=[];
  for(let start=0;start<words.length;start++)for(let size=1;size<=3&&start+size<=words.length;size++){
    if(articles.has(words[start][0].toLocaleLowerCase()))continue;
    const end=words[start+size-1],phrase=text.slice(words[start].index!,end.index!+end[0].length);
    if(phrase.length>48||text.toLocaleLowerCase().split(phrase.toLocaleLowerCase()).length!==2)continue;
    const overlap=words.slice(start,start+size).filter(w=>wanted.has(w[0].toLocaleLowerCase())).length;
    candidates.push({text:phrase,score:overlap*10-size});
  }
  return [...new Set(candidates.sort((a,b)=>b.score-a.score).map(c=>c.text))].slice(0,24);
}

/** Some local models put an explicit In/Out cycle in a guide text despite the
 * JSON contract. Route that unambiguous choice through the admitted engine
 * capability before measuring speech. Never infer timing from generic prose. */
export function normalizeSceneBreathing(raw:unknown,rawContext:PlanningContext):ScenePlan {
 const plan=ScenePlanSchema.parse(raw),context=PlanningContextSchema.parse(rawContext);
 if(!availableModules(context.pool,context.phase).some(module=>module.id==='breath'))return plan;
 const ids=new Set([plan.id,...plan.sections.flatMap(section=>[section.id,...section.actions.map(action=>action.id)])]);
 const nextId=(base:string)=>{let index=1,id:string;do{id=base.slice(0,34)+'-after-'+index++;}while(ids.has(id));ids.add(id);return id;};
 const expand=(action:SceneAction):SceneAction[]=>{
  if(action.kind!=='guide')return [action];
  const cycle=pacedBreathCycle(action.text);if(!cycle)return [action];
  const {kind,text,...common}=action;
  let preparation=cycle.before||'Breathe with me.';
  if(!/[.!?]$/.test(preparation))preparation=preparation.replace(/[,;:]+$/,'')+'.';
  const after=cycle.after.replace(/^[,;:\s]+/,'');
  return [{...common,kind:'breath',preparation,inText:'In.',outText:'And out.',inMs:4000,outMs:4000,cycles:1},
   ...(after?expand({...action,id:nextId(action.id),text:after}):[])];
 };
 return ScenePlanSchema.parse({...plan,sections:plan.sections.map(section=>({...section,actions:section.actions.flatMap(expand)}))});
}

/** Semantic validation follows structural decoding. Generated data has no authority
 * to enable a module, sound, trigger, visual or input channel. */
export function validateScenePlan(raw:unknown, rawContext:PlanningContext,reservedTriggers:readonly string[]=[]):ScenePlan {
  const plan=ScenePlanSchema.parse(raw),context=PlanningContextSchema.parse(rawContext),pool=context.pool;
  if(plan.moment&&(JSON.stringify(plan.moment)!==JSON.stringify(nextStoryMoment(context))||plan.sections.length!==1))throw Error('Story moment does not match the next engine-selected step.');
  const legal=new Set(availableModules(pool,context.phase).map(c=>c.id));
  if(context.participation==='uninterrupted')legal.delete('challenge');
  const totalCycles=requestedBreathCycles(context.feedback||context.userContext);
  const requestedCycles=totalCycles===undefined?undefined:Math.max(0,totalCycles-context.breathCyclesAlreadyCommitted);
  if(requestedCycles!==undefined&&legal.has('breath')&&plan.sections.flatMap(section=>section.actions).reduce((n,a)=>n+(a.kind==='breath'?a.cycles:0),0)!==requestedCycles)throw Error('Use exactly '+requestedCycles+' remaining breath cycle(s). Previously committed cycles already fulfil the earlier request.');
  const actions=plan.sections.flatMap(s=>s.actions),challenges=actions.filter(a=>a.kind==='challenge'),interaction=context.interaction;
  if(context.participation==='uninterrupted'&&(interaction||plan.resolution))throw Error('An uninterrupted journey has no real listener response to judge');
  if(challenges.length>1||challenges.length&&actions.at(-1)?.kind!=='challenge')throw Error('A listening challenge must be the final action; never preplan its outcome');
  if(interaction){
    if(!interaction.response&&!interaction.timedOut)throw Error('Await the real listener response before planning an outcome');
    if(!plan.resolution||plan.resolution.challengeId!==interaction.challengeId)throw Error('Resolve the pending listener challenge explicitly');
    if(interaction.timedOut&&plan.resolution.outcome!=='continue')throw Error('Silence cannot grant a reward or demand another attempt');
    if(plan.resolution.outcome==='retry'){
      if(interaction.attempt>=interaction.maxAttempts||challenges.length!==1)throw Error('Retry requires a bounded remaining attempt');
      const c=challenges[0];if(c.challengeId!==interaction.challengeId||c.request!==interaction.request||JSON.stringify(c.reward)!==JSON.stringify(interaction.reward)||c.maxAttempts!==interaction.maxAttempts)throw Error('Retry must retain the same request and reward');
    }else if(challenges.length)throw Error('Grant/continue closes this challenge');
    if(plan.resolution.outcome==='grant'&&!actions.some(a=>JSON.stringify(a.look)===JSON.stringify(interaction.reward.look)&&(interaction.reward.kind==='breath'?a.kind==='breath':a.kind!=='hold')))throw Error('Grant must actually perform the promised allowed scene');
  }else if(plan.resolution)throw Error('Cannot judge an absent listener response');
  const ids=new Set<string>([plan.id]),known=new Map(context.knownMotifs.map(m=>[m.id,m.meaning]));
  const forms=new Map([...context.committedMotifs,...context.knownMotifs].filter(m=>m.form).map(m=>[m.id,m.form]));
  let planned='',previous:SceneAction|undefined;
  const look=(l:SceneLook)=>{
    if(!pool.scenes.includes(l.scene)||l.motif&&!pool.motifs.includes(l.motif)||l.style&&!pool.styles.includes(l.style))throw Error('Plan uses a visual outside the allowed pool');
    if(!!l.motif!==!!l.motifId)throw Error('A motif needs one persistent identity');
    if(l.motifId&&l.motif){
      if(forms.has(l.motifId)&&forms.get(l.motifId)!==l.motif)throw Error('A persistent motif identity cannot change its visual form');
      forms.set(l.motifId,l.motif);
    }
    if(!pool.visuals&&(l.motif||l.style||l.visualDensity!==0||l.motion!==0))throw Error('Visuals are disabled');
    if(pool.reducedMotion&&l.motion!==0)throw Error('Reduced motion forbids planned motion');
    if(l.visualDensity>Math.min(1,.3+context.intensity)||l.effects>Math.min(1,.3+context.intensity))throw Error('Composition exceeds selected intensity');
  };
  for(const section of plan.sections) {
    if(ids.has(section.id))throw Error('Duplicate plan identity');ids.add(section.id);
    for(const a of section.actions) {
      if(ids.has(a.id))throw Error('Duplicate plan identity');ids.add(a.id);
      if(!legal.has(a.kind))throw Error('Plan uses a disabled or unavailable module: '+a.kind);
      look(a.look);if(a.kind==='contrast')look(a.narrow);
      if(a.kind==='reveal'){
        look(a.before);
        if(!contains(a.text,a.anchor))throw new SceneFieldError({actionId:a.id,field:'anchor',reason:'Reveal anchor must quote one contiguous phrase from its connected spoken thought. Text: '+JSON.stringify(a.text)+'; rejected anchor: '+JSON.stringify(a.anchor)});
        if(a.text.toLocaleLowerCase().split(a.anchor.toLocaleLowerCase()).length!==2)throw new SceneFieldError({actionId:a.id,field:'anchor',reason:'Reveal anchor must select one unambiguous phrase in the spoken thought'});
        if(a.before.motifId&&a.before.motifId!==a.look.motifId)throw Error('Reveal must retain its motif identity or introduce it from an empty image');
      }
      actionTexts(a).forEach((text,index)=>validateSpokenText(text,{narration:true,speaker:(a.kind==='reply'||a.kind==='repeat')&&index===1?'bambi':'owner',heardText:a.kind==='guide'||a.kind==='reveal'?context.heardText:undefined,request:context.feedback}));
      if(a.kind==='challenge'){
        look(a.reward.look);
        if(!interaction&&context.resolvedRequests.some(r=>r.request.toLowerCase()===a.request.toLowerCase())&&!contains(context.feedback,a.request))throw Error('A settled request needs a fresh user request before another challenge');
        if(!contains(context.userContext+'\n'+context.feedback,a.request)&&!interaction)throw Error('Challenge request must quote actual user context');
        if(a.reward.kind==='breath'&&!legal.has('breath'))throw Error('The promised breathing scene is unavailable');
        if(a.reward.kind==='scene'&&!pool.visuals)throw Error('The promised visual scene is unavailable');
      }
      if(a.kind==='breath'&&(breathInstruction(a.inText)?.direction!=='in'||breathInstruction(a.outText)?.direction!=='out'))throw Error('Breathing uses short direct in/out instructions');
      if(a.kind==='breath'?hasPacedBreathInstruction(a.preparation):actionTexts(a).some(text=>pacedBreathCycle(text)||hasPacedBreathInstruction(text))){
        const reason='Paced In/Out instructions require an enabled breath action and belong only to short inText/outText fields. Keep preparation and ordinary narration free of inhale/exhale instructions.';
        if(a.kind==='guide'||a.kind==='reveal')throw new SceneFieldError({actionId:a.id,field:'text',reason});
        if(a.kind==='breath')throw new SceneFieldError({actionId:a.id,field:'preparation',reason});
        throw Error(reason);
      }
      if(previous?.kind==='peak' && (a.kind!=='hold'||a.look.visualDensity>=previous.look.visualDensity||a.look.ambient>previous.look.ambient))throw Error('A peak requires a quieter recovery hold');
      if(a.kind==='recall' || a.kind==='self') {if(!a.look.motifId||!known.has(a.look.motifId))throw Error('Recall/viewpoint needs an actually established or preceding motif');}
      if(a.kind==='self'&&/operating system|reboot|bootloader|loading module/i.test(a.text))throw Error('Self means a narrative perspective');
      if(a.kind==='trigger'){
        if(!pool.triggers.some(t=>t.toUpperCase()===a.phrase.toUpperCase())||['BAMBI SLEEP','BLINK'].includes(a.phrase.toUpperCase()))throw Error('Trigger must be an eligible selected phrase; sleep and eye cues have their own actions');
        const wiper=effectForTrigger(a.phrase)==='wiper';
        if(wiper&&(!a.target||!pool.sounds.wiper||a.wipeMs<1000)||!wiper&&(a.target||a.wipeMs!==0))throw Error('A wiper-associated trigger requires one available contextual wipe');
      }
      if(a.kind==='wipe'||a.kind==='trigger'&&a.target) {
        const t=a.target!,source=t.source==='user'?context.userContext+'\n'+context.feedback:t.source==='heard'?context.heardText:planned;
        const lead=a.kind==='wipe'?a.text:a.preparation;
        if(!contains(source,t.quote)||!contains(t.quote,t.label)||!contains(lead,t.label))throw Error('Wipe target must be grounded in its cited context and spoken lead-in');
      }
      if(a.kind==='sleep_return'||a.kind==='blink')if(!/\bopen (?:your|the) eyes\b|\beyes (?:are )?open\b/i.test(a.returnText))throw Error('Scene return requires explicit eye reopening');
      if(a.kind==='peak'&&a.rhythm&&!pool.sounds.rhythm)throw Error('Selected rhythm sound unavailable');
      if((a.kind==='reply'||a.kind==='repeat')&&/^(?:say|repeat|open|close|look|listen|relax|sleep)\b/i.test(a.text))throw Error('An inner response cannot be another guiding command');
      for(const text of actionTexts(a)) {
        if(/\bBlink\b/i.test(text))throw Error('Eye commands belong to measured cue actions');
        for(const phrase of sceneCuePhrases([...pool.triggers,...reservedTriggers]))if(namedPhrase(text,phrase))throw Error('Named triggers belong to dedicated engine cue actions: '+JSON.stringify(phrase));
      }
      if(a.look.motifId&&!known.has(a.look.motifId))known.set(a.look.motifId,section.purpose);
      planned+='\n'+actionTexts(a).join('\n');previous=a;
    }
  }
  if(previous?.kind==='peak')throw Error('A peak cannot end without recovery');
  return plan;
}

/** Convert only the small schema vocabulary used here; refinement checks remain
 * authoritative above. Fail closed when the plan contract adds an unsupported type. */
export function planJsonSchema(schema:z.ZodTypeAny=ScenePlanSchema):Record<string,unknown> {
  const d=schema._def;
  if(schema instanceof z.ZodOptional)return planJsonSchema(schema.unwrap());
  if(schema instanceof z.ZodDefault)return planJsonSchema(schema.removeDefault());
  if(schema instanceof z.ZodEffects)return planJsonSchema(schema.innerType());
  if(schema instanceof z.ZodObject){const shape=schema.shape;return {type:'object',additionalProperties:false,properties:Object.fromEntries(Object.entries(shape).map(([k,v])=>[k,planJsonSchema(v as z.ZodTypeAny)])),required:Object.keys(shape).filter(k=>!(shape[k] instanceof z.ZodOptional))};}
  if(schema instanceof z.ZodDiscriminatedUnion)return {anyOf:[...schema.options].map(s=>planJsonSchema(s))};
  if(schema instanceof z.ZodNullable)return {anyOf:[planJsonSchema(schema.unwrap()),{type:'null'}]};
  if(schema instanceof z.ZodArray)return {type:'array',items:planJsonSchema(schema.element),...(d.minLength?{minItems:d.minLength.value}:{}),...(d.maxLength?{maxItems:d.maxLength.value}:{})};
  if(schema instanceof z.ZodEnum)return {type:'string',enum:schema.options};
  if(schema instanceof z.ZodLiteral)return {const:schema.value,type:typeof schema.value};
  if(schema instanceof z.ZodBoolean)return {type:'boolean'};
  if(schema instanceof z.ZodString){const out:Record<string,unknown>={type:'string'};for(const c of d.checks){if(c.kind==='min')out.minLength=c.value;if(c.kind==='max')out.maxLength=c.value;if(c.kind==='regex')out.pattern=c.regex.source;}return out;}
  if(schema instanceof z.ZodNumber){const out:Record<string,unknown>={type:d.checks.some((c:{kind:string})=>c.kind==='int')?'integer':'number'};for(const c of d.checks){if(c.kind==='min')out.minimum=c.value;if(c.kind==='max')out.maximum=c.value;}return out;}
  throw Error('Unsupported planner schema '+d.typeName);
}
