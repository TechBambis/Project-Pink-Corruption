// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {EventSchema, ProgramSchema, eventDurationMs, type BambiEvent, type PresentationState, type SpeechSpec} from './events/contract';
import {compileEvent} from './events/runtime';
import {sessionPhaseAt} from './phases';
import {referenceSettings} from './reference-scene';
import type {VoiceTrack} from '../speech/dual-voice';
export const pinkSettings={...referenceSettings,allowedTriggers:['BAMBI SLEEP','BAMBI RESET','SNAP'],selectedTriggers:['BAMBI SLEEP','BAMBI RESET','SNAP'],persona:'You are the self-assured, playful guiding voice in an original Bambi pink-heart performance. Prepared first-person responses represent the listener\'s subconscious within this chosen imagined scene. Address the listener and those inner answers as one person. Keep your guiding role; do not introduce a separate Bambi character or describe the responses as a smaller or second voice. The inner responses occur only in authored response windows. Speak directly and warmly, with connected thoughts and a little anticipation. Preserve the established heart and the return signal Back to pink. Fiction is a temporary chosen scene; never claim access to the listener\'s actual subconscious or actual identity, memory or bodily changes. Keep ordinary orientation and listener freedom.',username:'Bambi'};
const instant={kind:'hard_cut' as const,durationMs:0,subtitle:'clear' as const};
const quietSpeech:SpeechSpec={mode:'silent',targetMs:0,instruction:''};
export interface PinkVoice {id:string;atMs:number;durationMs:number;windowMs:number;text?:string;pinkAtMs?:number;voiceTrack?:VoiceTrack;trigger?:{phrase:string;offsetMs:number}}
export interface PinkBinding {sourceId:string;payloadId:string;atMs:number;targetMs:number}
const cuts=[0,8000,32000,52000,57600,96000,110000,112000,115100,120000,132000,148000,165000,176000,186000,192000,210000,216000,229000,240000];
/** A single authored state grammar, evaluated by the existing event owner. */
export function pinkState(atMs:number,spoken:boolean,context?:'whole'|'heart'|'voice'|'blank'|'peak'):PresentationState {
  const kind=context??(atMs<8000?'heart':atMs>=52000&&atMs<57600?'voice':atMs<96000?'whole':atMs<110000?'whole':atMs<115100?'voice':atMs<132000?'heart':atMs<176000?'whole':atMs<186000?'peak':'heart');
  const blank=kind==='blank',dark=kind==='voice'||blank,world=kind==='whole'||kind==='peak';
  const density=kind==='peak'?.86:world?(atMs<32000?.34:atMs>=165000?.7:atMs>=148000?.58:atMs>=132000?.44:.55):.14;
  const clockwork=world&&atMs>=132000&&atMs<186000;
  const scene=world&&atMs>=132000&&atMs<176000?'Deep Tunnel':world&&atMs<32000?'Soft Pink':'Spiral Focus';
  const layers:PresentationState['activeLayers']=[];
  if(spoken&&!blank)layers.push('main_voice');
  if(!blank&&kind!=='voice')layers.push('drone');
  if(world||atMs>=96000&&atMs<104000)layers.push('transition_sfx');
  if(world)layers.push('base_visual','spiral');
  if(!dark)layers.push('motif_visual');
  if(kind==='peak')layers.push('center_text');
  return {activeLayers:layers,foreground:kind==='peak'?'center_text':spoken&&!blank?'main_voice':!dark?'motif_visual':null,
    density:{intensity:density,effectDensity:world?.3:0,speechDensity:spoken?.6:0,audioDensity:world?.4:.1,visualDensity:density},
    visualState:dark?'black':world?'layered':'sparse',narrationState:spoken&&!blank?'speaking':'paused',ambientState:dark||atMs>=229000?'silent':atMs>=120000?'reduced':'active',scene,motifId:'pink-heart',motifForm:'heart',motifMotion:{kind:'heart_turn',startMs:0,periodMs:5660,strength:atMs<8000?.45:kind==='peak'?1:world?(atMs>=165000?.85:.65):atMs>=229000?.4:1,...(clockwork?{surround:'gears' as const}:{})}};
}
function event(id:string,atMs:number,durationMs:number,spoken=true):BambiEvent {
  const points=[atMs,...cuts.filter(t=>t>atMs&&t<atMs+durationMs)];
  const base={id,type:spoken?'layer_shift':'silence',phase:sessionPhaseAt(atMs/1000,240).phase,atMs,timing:{prepMs:0,activeMs:durationMs,returnMs:0},state:pinkState(atMs,spoken),baseline:pinkState(atMs,spoken),speech:spoken?{mode:'narrate',targetMs:durationMs,instruction:'Prepared original complete thought; no model generation.',delivery:'guide'}:quietSpeech,audio:[],visual:[],haptics:[],entry:instant,exit:instant};
  // Explicit stages keep presentation changes independent of voice segmentation.
  if(points.length>1)return EventSchema.parse({...base,type:'soft_return',softReturn:{final:false,steps:points.map(t=>({offsetMs:t-atMs,state:pinkState(t,spoken)}))}});
  if(atMs>=176000&&atMs<186000)return EventSchema.parse({...base,type:'peak',visual:[{offsetMs:0,durationMs:0,text:'BACK TO PINK'}],...(durationMs>900?{rhythm:{offsetMs:400,untilMs:durationMs,stepMs:2000}}:{})});
  return EventSchema.parse(base);
}
export function pinkLive(instruction:string):BambiEvent {
  return EventSchema.parse({...event('live-bridge',148000,17000),speech:{mode:'narrate',targetMs:17000,wordTarget:26,instruction,delivery:'guide'}});
}
/** Fractionation, wipe/blank/reanchor and cached mantra retain their existing contracts. */
export function pinkProgram(voices:PinkVoice[],live?:BambiEvent,wipeTarget='DISTRACTIONS') {
  const byId=new Map(voices.map(v=>[v.id,v])),bindings:PinkBinding[]=[],events:BambiEvent[]=[];
  const bind=(sourceId:string,payloadId:string,atMs:number,targetMs:number)=>{
    const v=byId.get(sourceId);if(!v||v.durationMs>targetMs+.001)throw Error(`Pink voice does not fit ${sourceId}`);
    bindings.push({sourceId,payloadId,atMs,targetMs});
  };
  const speechFor=(id:string,speech:SpeechSpec):SpeechSpec=>{const v=byId.get(id)??byId.get(id+'-0');return {...speech,...(v?.voiceTrack?{voiceTrack:v.voiceTrack}:{}),...(v?.trigger?{requiredTrigger:v.trigger.phrase,triggerAtMs:v.trigger.offsetMs,triggerCooldownMs:700}:{} )};};
  const effects=(s:PresentationState):PresentationState=>({...s,activeLayers:[...new Set([...s.activeLayers,'transition_sfx' as const])]});
  const special=new Set(['whole-one','heart-one','whole-two','voice-only','wipe','reanchor','mantra','sleep-blank']);
  for(const voice of voices){if(special.has(voice.id.replace(/-0$/,'')))continue;
    let e=event(voice.id,voice.atMs,voice.windowMs);
    e=EventSchema.parse({...e,speech:speechFor(voice.id,e.speech),...(voice.trigger?{state:effects(e.state),baseline:effects(e.baseline),...(e.softReturn?{softReturn:{...e.softReturn,steps:e.softReturn.steps.map(s=>({...s,state:effects(s.state)}))}}:{})}:{})});
    if(voice.id==='peak'||voice.id==='peak-0')e=EventSchema.parse({...e,visual:[{offsetMs:0,durationMs:0,text:''},{offsetMs:voice.pinkAtMs??0,durationMs:0,text:'BACK TO PINK'}]});
    events.push(e);bind(voice.id,compileEvent(e).speech[0].payloadId,voice.atMs,voice.windowMs);
  }
  for(const [index,atMs] of [57600,76800].entries()) {
    const stateA=pinkState(atMs,true,'whole'),stateB=pinkState(atMs+9600,true,index===0?'heart':'voice');
    // The completed heart-only thought leaves room for the next picture before
    // its voice entry. Keep that readiness lead inside this finite episode.
    if(index===0)stateB.activeLayers.push('base_visual','spiral');else stateB.activeLayers.push('transition_sfx');
    const e=EventSchema.parse({...event(`contrast-${index}`,atMs,19200),type:'fractionation',state:stateA,baseline:stateA,speech:quietSpeech,
      visual:index===0?[{offsetMs:9600,durationMs:0,opacity:0},{offsetMs:17400,durationMs:1200,opacity:1,motion:.55}]:[],
      fractionation:{stateA,stateB,pattern:'constant',cycles:[{aMs:9600,bMs:9600}],transitionMs:1200,
        speechA:speechFor(index===0?'whole-one':'whole-two',{mode:'narrate',targetMs:8400,instruction:'Prepared whole-picture thought with the reopening instruction.',delivery:'guide'}),speechB:speechFor(index===0?'heart-one':'voice-only',{mode:'narrate',targetMs:8400,instruction:'Prepared withdrawal thought and authored sleep cue.',delivery:'guide'})}});
    events.push(e);
    for(const [i,id] of (index===0?['whole-one','heart-one']:['whole-two','voice-only']).entries()){
      const slot=compileEvent(e).speech[i],source=byId.has(id)?id:id+'-0';bind(source,slot.payloadId,slot.atMs,slot.speech.targetMs);
    }
  }
  const wipeState={...pinkState(96000,true,'whole'),activeLayers:['main_voice','transition_sfx','base_visual','motif_visual','center_text'] as PresentationState['activeLayers'],ambientState:'silent' as const};
  const wipe=EventSchema.parse({...event('word-wipe',96000,14000),state:wipeState,baseline:wipeState,
    speech:{mode:'fragment',targetMs:14000,instruction:`Prepared reopening and the contextual content being erased: ${wipeTarget}.`,delivery:'guide'},wipe:{offsetMs:4000,durationMs:10000,text:wipeTarget},visual:[{offsetMs:0,durationMs:0,text:wipeTarget},{offsetMs:4000,durationMs:0,text:''}]});
  events.push(wipe);
  {const slot=compileEvent(wipe).speech[0];bind(byId.has('wipe')?'wipe':'wipe-0',slot.payloadId,slot.atMs,slot.speech.targetMs);}
  const blank=EventSchema.parse({...event('reserved-blank',110000,10000),softReturn:undefined,type:'mindwipe',timing:{prepMs:2000,activeMs:3100,returnMs:4900},preparationState:effects(pinkState(110000,true,'voice')),state:pinkState(112000,false,'blank'),baseline:pinkState(115100,true,'whole'),speech:speechFor('sleep-blank',{mode:'fragment',targetMs:2000,instruction:'Prepared sleep cue and selected snap at the black transition.',delivery:'guide'}),visual:[{offsetMs:5100,durationMs:0,text:'Back to pink.'}]});
  events.push(blank);for(const [i,id]of ['sleep-blank','reanchor'].entries()){const slot=compileEvent(blank).speech[i];bind(byId.has(id)?id:id+'-0',slot.payloadId,slot.atMs,slot.speech.targetMs);}
  const mantra=EventSchema.parse({...event('pink-mantra',192000,18000),type:'mantra',speech:speechFor('mantra',{mode:'mantra',targetMs:6000,instruction:'One prepared first-person inner response representing the listener\'s subconscious; cached PCM, exactly three finite repetitions.',delivery:'guide'}),
    mantra:{count:3,periodMs:6000,perLoop:[pinkState(192000,true,'heart'),pinkState(198000,true,'heart'),pinkState(204000,true,'heart')]}});
  events.push(mantra);const m=compileEvent(mantra).speech[0];bind(byId.has('mantra')?'mantra':'mantra-0',m.payloadId,m.atMs,6000);
  if(live)events.push(live);
  events.sort((a,b)=>a.atMs-b.atMs);
  let end=0,serial=0;const filled:BambiEvent[]=[];
  const gap=(from:number,to:number)=>{const points=[from,...cuts.filter(t=>t>from&&t<to),to];for(let i=0;i<points.length-1;i++)if(points[i+1]>points[i])filled.push(event(`quiet-${serial++}`,points[i],points[i+1]-points[i],false));};
  for(const e of events){if(e.atMs<end-.001)throw Error(`Pink scene overlap: ${e.id}`);gap(end,e.atMs);filled.push(e);end=e.atMs+eventDurationMs(e);}
  gap(end,240000);
  const responsePrompts=[['answer-name',40000,50500],['answer-return',120000,126700],['answer-pink',130000,139500],['answer-build',165000,172700],['answer-peak',176000,185700],['mantra',186000,210000]].flatMap(([id,fromMs,toMs])=>{const voice=byId.get(String(id))??byId.get(id+'-0');return voice?.text?[{fromMs,toMs,text:voice.text}]:[];});
  const program=ProgramSchema.parse({version:1,durationMs:240000,baseline:pinkState(0,false),responsePrompts,responseWindows:[{fromMs:40000,toMs:51000},{fromMs:120000,toMs:140000},{fromMs:165000,toMs:173000},{fromMs:176000,toMs:210000}],motifs:[{id:'pink-heart',visualPreset:'Spiral Focus',textAnchor:'The same glossy pink heart at the center; Back to pink is its established return signal.',firstIntroducedAtMs:0}],events:filled});
  for(const e of program.events)compileEvent(e);
  return {program,bindings};
}
