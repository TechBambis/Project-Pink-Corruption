// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { ProgramSchema, EventSchema, eventDurationMs, type BambiProgram, type BambiEvent, type PresentationState, type SpeechSpec } from '../events/contract';
import { compileEvent } from '../events/runtime';
import { wavDurationMs, validateEventText, type RenderedEventSpeech } from '../events/speech';
import { validateScenePlan, sceneCuePhrases, type ScenePlan, type PlanningContext, type SceneLook, type SceneAction } from './plan';
import type {ChallengeWindow} from './interaction';

export interface SynthesisArc { id:string; text:string; delivery:SceneAction['delivery']; inner:boolean; cue?:string }
export interface MeasuredSceneArc { id:string; bytes:Uint8Array; words:{word:string;atMs:number;endMs?:number}[] }
const normalizeAnchor=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function measuredPhraseOffsets(phrase:string,words:MeasuredSceneArc['words']){
  const target=normalizeAnchor(phrase),matches:number[]=[];if(!target)return matches;
  for(let i=0;i<words.length;i++){
    let span='';for(let j=i;j<words.length&&span.length<target.length;j++){
      span+=normalizeAnchor(words[j].word);if(span===target){matches.push(words[i].atMs);break;}
    }
  }
  return matches;
}
/** A repair can choose only a unique measured subphrase of the original anchor.
 * No text, PCM or timing is invented, and no other scene field is editable. */
export class RevealAlignmentError extends Error {
  readonly candidates:string[];
  constructor(readonly actionId:string,readonly anchor:string,words:MeasuredSceneArc['words']){
    super('Reveal requires one unambiguous measured phrase');this.name='RevealAlignmentError';
    const tokens=anchor.trim().split(/\s+/),candidates:string[]=[];
    for(let length=Math.min(4,tokens.length);length>=1;length--)for(let start=0;start+length<=tokens.length;start++){
      const phrase=tokens.slice(start,start+length).join(' ');
      if(measuredPhraseOffsets(phrase,words).length===1)candidates.push(phrase);
    }
    this.candidates=[...new Set(candidates)].slice(0,24);
  }
}
export interface CompiledScene {
  plan:ScenePlan; events:BambiEvent[]; motifs:BambiProgram['motifs'];
  responseWindows:NonNullable<BambiProgram['responseWindows']>; responsePrompts:NonNullable<BambiProgram['responsePrompts']>;
  payloads:RenderedEventSpeech[]; atMs:number; endMs:number;
  sections:{id:string;purpose:string;fromMs:number;toMs:number;speechIds:string[]}[];
  challenges:ChallengeWindow[];
}
export function synthesisArcs(raw:ScenePlan):SynthesisArc[] {
  return raw.sections.flatMap(s=>s.actions.flatMap(a=>{
    const make=(suffix:string,text:string,inner=false,cue?:SynthesisArc['cue']):SynthesisArc=>({id:a.id+suffix,text,delivery:suffix==='-return'?'return':inner?'hold':a.delivery,inner,...(cue?{cue}:{})});
    switch(a.kind){
      case 'hold':return [];
      case 'reply':case 'repeat':return [make('-invite',a.invitation),make('-answer',a.text,true)];
      case 'challenge':return [make('-invite',a.invitation)];
      case 'breath':return [make('-prep',a.preparation),make('-in',a.inText),make('-out',a.outText)];
      case 'sleep_return':return [make('-prep',a.preparation),make('-cue','Bambi Sleep.',false,'Bambi Sleep'),make('-return',a.returnText)];
      case 'trigger':return [make('-prep',a.preparation),make('-cue',a.phrase+'.',false,a.phrase)];
      case 'blink':return [make('-prep',a.preparation),make('-cue','Blink',false,'Blink'),make('-return',a.returnText)];
      case 'contrast':return [make('-a',a.textA),make('-b',a.textB)];
      case 'reset':return [make('-main',a.text),make('-return',a.returnText)];
      default:return [make('-main',a.text)];
    }
  }));
}

/** Actual PCM lengths and measured word anchors, never LLM timing estimates,
 * determine transport events. All sections are compiled before any can commit. */
export function compileScene(raw:ScenePlan,context:PlanningContext,measured:MeasuredSceneArc[],options:{atMs:number;durationMs:number;baseline:PresentationState;continuous?:boolean;reservedTriggers?:string[];instanceId?:string}):CompiledScene {
  const plan=validateScenePlan(raw,context), arcs=synthesisArcs(plan);
  if(arcs.length>64||measured.length!==arcs.length||new Set(measured.map(m=>m.id)).size!==arcs.length||measured.reduce((n,m)=>n+m.bytes.length,0)>24000000)throw Error('Incomplete or oversized scene audio');
  const audio=new Map(arcs.map(arc=>{
    const m=measured.find(m=>m.id===arc.id);if(!m)throw Error('Missing scene synthesis arc');
    const duration=wavDurationMs(m.bytes);if(duration>20000)throw Error('Scene thought exceeds bounded speech duration');
    let previous=0;
    for(const w of m.words){if(!Number.isFinite(w.atMs)||!Number.isFinite(w.endMs)||w.atMs<previous-.001||w.endMs!<w.atMs||w.endMs!>duration+.001)throw Error('Invalid scene word alignment');previous=w.endMs!;}
    return [arc.id,{...m,arc,duration}] as const;
  }));
  const events:BambiEvent[]=[],payloads:RenderedEventSpeech[]=[],motifs:BambiProgram['motifs']=[],responseWindows:CompiledScene['responseWindows']=[],responsePrompts:CompiledScene['responsePrompts']=[],sections:CompiledScene['sections']=[];
  const instant={kind:'hard_cut' as const,durationMs:0,subtitle:'clear' as const};
  const challenges:ChallengeWindow[]=[];
  const reservedMotifs=[...context.knownMotifs,...context.committedMotifs??[]];
  let cursor=options.atMs, serial=0;
  const motionByMotif=new Map<string,NonNullable<PresentationState['motifMotion']>>();
  if(context.currentLook?.motifId&&context.currentMotifMotion)motionByMotif.set(context.currentLook.motifId,context.currentMotifMotion);
  const motion=(look:SceneLook)=>{
    if(!look.motifId||!look.motif||look.motion===0&&look.motif!=='heart')return {};
    if(look.motion===0&&motionByMotif.has(look.motifId))return {motifMotion:motionByMotif.get(look.motifId)!};
    const kind=look.motif==='heart'?'heart_turn' as const:'coin_scan' as const,periodMs=6000/Math.max(.2,look.motion),previous=motionByMotif.get(look.motifId);
    // Preserve phase even when the next composition changes the rotation rate.
    const startMs=previous?.kind===kind?(previous.periodMs===periodMs?previous.startMs:cursor-((cursor-previous.startMs)/previous.periodMs%1)*periodMs):cursor;
    // At the very beginning a slower period may need a negative origin, which
    // the presentation contract forbids. Retain the existing motion in that case.
    const next=startMs<0&&previous?previous:{kind,startMs,periodMs,strength:1};motionByMotif.set(look.motifId,next);
    return {motifMotion:next};
  };
  const state=(look:SceneLook,voice:boolean,inner=false,black=false):PresentationState=>({
    activeLayers:[...(voice?[inner?'left_voice' as const:'main_voice' as const]:[]),...(look.ambient>0?['drone' as const]:[]),...(look.effects>0?['transition_sfx' as const]:[]),...(!black&&context.pool.visuals?['base_visual' as const,...(look.motif?['motif_visual' as const]:[]),...(look.style?['spiral' as const]:[])]:[])],
    foreground:voice?(inner?'left_voice':'main_voice'):null,
    density:{intensity:context.intensity,effectDensity:look.effects,speechDensity:voice?1:0,audioDensity:look.ambient,visualDensity:black?0:look.visualDensity},
    visualState:black?'black':look.motif?'motif':look.visualDensity<.15?'sparse':'normal',narrationState:voice?'speaking':'paused',ambientState:look.ambient>0?'reduced':'silent',scene:look.scene,
    ...(look.style?{spiralStyle:look.style}:{}),...(look.motif?{motifId:look.motifId!,motifForm:look.motif}:{}),
    ...motion(look),
  });
  const silent:SpeechSpec={mode:'silent',targetMs:0,instruction:''};
  const make=(_action:SceneAction,look:SceneLook,ms:number,arcId?:string,extra:Partial<BambiEvent>={},inner=false,black=false)=>{
    const m=arcId?audio.get(arcId)!:undefined;
    const speech:SpeechSpec=m?{mode:'narrate',targetMs:m.duration+150,instruction:'Prepared complete thought from the validated scene plan.',delivery:m.arc.delivery,...(inner?{voiceTrack:{speaker:'bambi' as const,gainDb:-8,pan:-.2,reverbMs:70,reverbDb:-24}}:{})}:silent;
    const e=EventSchema.parse({id:(options.instanceId??plan.id)+'-'+(++serial),type:m?'layer_shift':'silence',phase:context.phase,atMs:cursor,timing:{prepMs:0,activeMs:ms,returnMs:0},state:state(look,!!m,inner,black),baseline:options.baseline,speech,audio:[{offsetMs:0,bus:'drone',gain:look.ambient*(m?(inner?.45:.65):1),durationMs:m?Math.min(250,m.duration/3):0},...(m&&ms>m.duration?[{offsetMs:m.duration,bus:'drone',gain:look.ambient,durationMs:Math.min(400,ms-m.duration)}]:[]),{offsetMs:0,bus:'EFFECTS',gain:look.effects,durationMs:0}],visual:[{offsetMs:0,motion:look.motion,durationMs:0}],haptics:[],entry:instant,exit:instant,...extra});
    const slots=compileEvent(e).speech;
    if(m){
      const reserved=sceneCuePhrases(options.reservedTriggers??context.pool.triggers);
      if(!m.arc.cue)validateEventText(m.arc.text,e,undefined,[...reserved,'Blink']);
      for(const slot of slots){if(payloads.some(p=>p.payloadId===slot.payloadId))continue;
        payloads.push({payloadId:slot.payloadId,text:m.arc.text,audio:Buffer.from(m.bytes).toString('base64'),durationMs:m.duration,targetMs:slot.speech.targetMs,textAttempts:0,words:m.words});
      }
    }
    events.push(e);cursor+=eventDurationMs(e);return e;
  };
  const spoken=(a:SceneAction,suffix:string,look=a.look,extra:Partial<BambiEvent>={})=>make(a,look,audio.get(a.id+suffix)!.duration+150+a.pauseAfterMs,a.id+suffix,extra);
  const cueOffset=(id:string,phrase:string)=>{
    const m=audio.get(id)!,tokens=phrase.toLowerCase().split(' '),matches:number[]=[];
    for(let i=0;i<m.words.length;i++)if(tokens.every((t,j)=>m.words[i+j]?.word.replace(/[^a-z]/gi,'').toLowerCase()===t))matches.push(m.words[i].atMs);
    if(matches.length!==1)throw Error('Cue requires an unambiguous measured phrase');return matches[0];
  };
  const revealOffset=(id:string,phrase:string)=>{
    // Alignment may split a written hyphenated word into multiple measured
    // words. Match complete word spans, preserving their measured first onset.
    const words=audio.get(id)!.words,matches=measuredPhraseOffsets(phrase,words);
    if(matches.length!==1)throw new RevealAlignmentError(id.slice(0,-5),phrase,words);
    return matches[0];
  };
  for(const s of plan.sections) {
    const fromMs=cursor;
    for(const a of s.actions) {
      if(a.look.motifId&&!reservedMotifs.some(m=>m.id===a.look.motifId)&&!motifs.some(m=>m.id===a.look.motifId))motifs.push({id:a.look.motifId,visualPreset:a.look.scene,textAnchor:s.purpose.slice(0,200),firstIntroducedAtMs:cursor+(a.kind==='reveal'&&!a.before.motifId?revealOffset(a.id+'-main',a.anchor):0)});
      switch(a.kind){
        case 'hold':make(a,a.look,a.durationMs+a.pauseAfterMs);break;
        case 'reveal':{
          const id=a.id+'-main',m=audio.get(id)!,offsetMs=revealOffset(id,a.anchor),endMs=m.duration+150;
          make(a,a.before,endMs+a.holdMs+a.pauseAfterMs,id,{type:'soft_return',softReturn:{final:false,steps:[...(offsetMs>0?[{offsetMs:0,state:state(a.before,true)}]:[]),{offsetMs,state:state(a.look,true)},{offsetMs:endMs,state:state(a.look,false)}]},audio:[{offsetMs:0,bus:'drone',gain:a.before.ambient*.65,durationMs:0},{offsetMs,bus:'drone',gain:a.look.ambient*.65,durationMs:Math.min(250,m.duration-offsetMs)},{offsetMs:endMs,bus:'drone',gain:a.look.ambient,durationMs:Math.min(400,a.holdMs)},{offsetMs:0,bus:'EFFECTS',gain:a.before.effects,durationMs:0},{offsetMs,bus:'EFFECTS',gain:a.look.effects,durationMs:0}],visual:[{offsetMs:0,motion:a.before.motion,durationMs:0},{offsetMs,motion:a.look.motion,durationMs:0}]});
          break;
        }
        case 'challenge':{
          const invitation=spoken(a,'-invite'),fromMs=cursor;
          const listening=make(a,a.look,a.responseMs);
          responsePrompts.push({fromMs,toMs:cursor,text:a.phrase});
          const previous=context.interaction;
          challenges.push({fromMs,toMs:cursor,invitationEventId:invitation.id,responseEventId:listening.id,invitation:a.invitation,context:{challengeId:a.challengeId,request:a.request,phrase:a.phrase,criterion:a.criterion,reward:a.reward,maxAttempts:a.maxAttempts,attempt:previous?previous.attempt+1:1,response:null,timedOut:false,resumeStrategy:previous?.resumeStrategy??context.previousStrategy,resumeOutlook:previous?.resumeOutlook??context.interruptedOutlook??context.plannedOutlook??''}});
          break;
        }
        case 'breath':{
          spoken(a,'-prep');
          for(let i=0;i<a.cycles;i++)for(const direction of ['in','out'] as const){
            const id=a.id+'-'+direction,m=audio.get(id)!,offsetMs=m.words[0]?.atMs;
            if(offsetMs===undefined||!Number.isFinite(offsetMs))throw Error('Breathing needs a measured spoken onset');
            const durationMs=direction==='in'?a.inMs:a.outMs,look={...a.look,effects:Math.max(.1,a.look.effects)};
            make(a,look,Math.max(m.duration,offsetMs+durationMs)+150,id,{breath:{direction,durationMs,offsetMs}});
          }
          break;
        }
        case 'reply':case 'repeat':{
          spoken(a,'-invite');const m=audio.get(a.id+'-answer')!;
          const count=a.kind==='repeat'?a.count:1;
          // One rendered answer is reused; a fresh preview precedes every occurrence.
          for(let i=0;i<count;i++){
            const fromMs=cursor;make(a,a.look,a.previewMs);
            make(a,a.look,m.duration+150+a.responseMs+a.pauseAfterMs,a.id+'-answer',{},true);
            responseWindows.push({fromMs,toMs:cursor});responsePrompts.push({fromMs,toMs:cursor,text:a.text});
          }
          break;
        }
        case 'wipe':{
          const m=audio.get(a.id+'-main')!;
          const look={...a.look,effects:Math.max(.1,a.look.effects)};
          make(a,look,Math.max(m.duration+150,a.wipeMs+100)+a.pauseAfterMs,a.id+'-main',{baseline:state(look,false),wipe:{offsetMs:100,durationMs:a.wipeMs,text:a.target.label}});break;
        }
        case 'sleep_return':{
          spoken(a,'-prep');const id=a.id+'-cue',m=audio.get(id)!,offset=cueOffset(id,'Bambi Sleep');
          // A fixed audio cue is scheduled ahead of its heard word. A late UI
          // frame may consume the slot within 150 ms without moving that word.
          const leadMs=250,cueAtMs=leadMs+offset,spokenEndMs=leadMs+m.duration+150;
          const look={...a.look,effects:Math.max(.1,a.look.effects)},duration=spokenEndMs+a.holdMs;
          const phrase=context.pool.triggers.find(t=>t.toUpperCase()==='BAMBI SLEEP')!;
          const speech:SpeechSpec={mode:'fragment',targetMs:spokenEndMs,instruction:'Measured engine sleep cue.',delivery:a.delivery,requiredTrigger:phrase,triggerAtMs:cueAtMs,triggerCooldownMs:12000};
          const steps=[{offsetMs:0,state:state(look,true)},{offsetMs:cueAtMs,state:state(look,true,false,true)},{offsetMs:spokenEndMs,state:state({...look,effects:0},false,false,true)}];
          make(a,look,duration,id,{type:'soft_return',speech,softReturn:{final:false,steps}});
          payloads.at(-1)!.triggerOffsetMs=offset;spoken(a,'-return');break;
        }
        case 'trigger':{
          spoken(a,'-prep');const id=a.id+'-cue',m=audio.get(id)!,offset=cueOffset(id,a.phrase),leadMs=250,cueAtMs=leadMs+offset;
          const phrase=context.pool.triggers.find(t=>t.toUpperCase()===a.phrase.toUpperCase())!;
          const look={...a.look,effects:Math.max(.1,a.look.effects)},spokenMs=leadMs+m.duration+150;
          const speech:SpeechSpec={mode:'fragment',targetMs:spokenMs,instruction:'Measured selected engine cue.',delivery:a.delivery,requiredTrigger:phrase,triggerAtMs:cueAtMs,triggerCooldownMs:12000,triggerEffects:'snap_only'};
          make(a,look,Math.max(spokenMs+a.holdMs,a.target?cueAtMs+a.wipeMs:0),id,{speech,baseline:state(look,false),...(a.target?{wipe:{offsetMs:cueAtMs,durationMs:a.wipeMs,text:a.target.label}}:{})});
          payloads.at(-1)!.triggerOffsetMs=offset;break;
        }
        case 'blink':{
          spoken(a,'-prep');const id=a.id+'-cue',m=audio.get(id)!,offset=cueOffset(id,'Blink');
          if(offset>250)throw Error('Measured eye cue cannot fit the engine lead');
          const closedMs=m.duration+250+a.restMs,openMs=500,duration=closedMs+openMs;
          make(a,a.look,duration,id,{type:'blink_trigger',speech:silent,blink:{spoken:true,sound:context.pool.sounds.snap,openState:state(a.look,true),closedState:state(a.look,false,false,true),steps:[{kind:'blink',count:1,closedMs,openMs},{kind:'reopen',durationMs:500}]},timing:{prepMs:0,activeMs:duration+500,returnMs:0}});
          payloads.at(-1)!.cueOffsetMs=offset;spoken(a,'-return');break;
        }
        case 'contrast':for(let i=0;i<a.cycles;i++){spoken(a,'-a',a.narrow);make(a,a.narrow,a.gapMs);spoken(a,'-b');make(a,a.look,a.gapMs);}break;
        case 'peak':{
          const m=audio.get(a.id+'-main')!;
          const look={...a.look,effects:a.rhythm?Math.max(.1,a.look.effects):a.look.effects};
          spoken(a,'-main',look,{type:'peak',...(a.rhythm?{rhythm:{offsetMs:150,untilMs:m.duration+150,stepMs:900,sound:'selected_tick' as const}}:{})});break;
        }
        case 'reset':spoken(a,'-main');make(a,{...a.look,ambient:0,effects:0,visualDensity:Math.min(.1,a.look.visualDensity),motion:0},700);spoken(a,'-return');break;
        case 'self':spoken(a,'-main',a.look,{type:'original_self',motifId:a.look.motifId!,originalSelf:a.perspective});break;
        case 'recall':spoken(a,'-main',a.look,{type:'motif_recall',motifId:a.look.motifId!});break;
        default:spoken(a,'-main');
      }
    }
    sections.push({id:s.id,purpose:s.purpose,fromMs,toMs:cursor,speechIds:events.filter(e=>e.atMs>=fromMs&&e.atMs<cursor).flatMap(e=>compileEvent(e).speech.map(slot=>slot.id))});
  }
  if(cursor-options.atMs>context.windowMs)throw Error('Measured scene audio overflow; regenerate or use the owned fallback, never clip');
  const known=[...new Map(reservedMotifs.map(m=>[m.id,m])).values()].map(m=>({id:m.id,visualPreset:options.baseline.scene,textAnchor:m.meaning,firstIntroducedAtMs:0}));
  ProgramSchema.parse({version:1,durationMs:options.durationMs,baseline:options.baseline,continuous:options.continuous,motifs:[...known,...motifs],events,responseWindows,responsePrompts});
  return {plan,events,motifs,responseWindows,responsePrompts,payloads,atMs:options.atMs,endMs:cursor,sections,challenges};
}
