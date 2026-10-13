// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import './comparison.css';
import './session-events.css';
import type { AudioPreset } from '../../../packages/audio/preset';
import { AudioEngine } from '../../../packages/audio';
import { TimelineScheduler } from '../../../packages/timeline';
import { RuntimeLoop } from '../../../packages/timeline/runtime-loop';
import { ProgramSchema, type BambiProgram } from '../../../packages/session-director/events/contract';
import { SessionEvents } from './session-events';
import {compileEvent} from '../../../packages/session-director/events/runtime';
import {pinkSettings as referenceSettings} from '../../../packages/session-director/pink-scene';
import {VisualEngine} from '../../../packages/visuals';
import {sceneSounds} from '../../../packages/audio/scene-sounds';
import {TriggerPresentation} from './trigger-presentation';
import {triggerEffectFor} from '../../../packages/visuals/trigger-effects';
import './trigger-presentation.css';
import type { RenderedEventSpeech } from '../../../packages/session-director/events/speech';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
const input=(id:string)=>$<HTMLInputElement>(id);
const status=(text:string)=>{$('status').textContent=text;};
type Variant='current'|'reference'|'adaptive';
interface Performance {soundPreferences?:Record<string,unknown>;backgroundPreset:AudioPreset;version:1;variant:Variant;program:BambiProgram;payloads:RenderedEventSpeech[];importantPayloads:string[];liveWindows:{payloadId:string;readyAfterMs:number}[];adjustmentAtMs:number}
let engine:AudioEngine|undefined, events:SessionEvents|undefined, visuals:VisualEngine|undefined;
let cues:TriggerPresentation|undefined;
const outputSeconds=()=>Math.max(0,(clock?.time??0)-(engine?engine.context.currentTime-engine.outputTime:0));
let initialization:Promise<void>|undefined;
let clock:TimelineScheduler|undefined, generation=0, preparing:AbortController|undefined, active:Performance|undefined, adjusted=false;
const variant=()=>($<HTMLSelectElement>('variant').value as Variant);
function links(){for(const id of ['pack','wav'])$<HTMLAnchorElement>(id).href=`/api/next-gen-comparison/${variant()}${id==='pack'?'.bambi.json':'.wav'}`;input('fresh').disabled=variant()!=='adaptive';}
function quiet(automatic=false){
  const start=performance.now(),level=Math.min(Number(input('background').value),.025);input('background').value=String(level);engine?.set('drone',level);engine?.set('noise',0);
  adjusted=true;status(automatic?'The background is quieter. The story leaves room for it.':'Background reduced.');
  measurements.push({type:'adjustment',sessionMs:(clock?.time??0)*1000,dispatchMs:performance.now()-start});if(measurements.length>128)measurements.shift();
}
const measurements:{type:string;sessionMs:number;dispatchMs?:number}[]=[];
function initialize(){return initialization??=initializeOwners();}
async function initializeOwners(){
  engine=new AudioEngine();await engine.init();
  engine.set('MASTER',.8);engine.set('AI_VOICE',.9);engine.set('main_voice',1);engine.set('EFFECTS',.07);
  for(const bus of ['left_voice','right_voice','echo_voice','noise'] as const)engine.set(bus,0);
  visuals=new VisualEngine($<HTMLCanvasElement>('canvas'),$('stage'));
  cues=new TriggerPresentation($('stage'));
  visuals.stableSettings={speed:.45,complexity:.65,alpha:.85,colorA:'#dc79c9',colorB:'#4d1953',mode:'classic',style:'tunnel',depth:.8};visuals.sceneTransitions=false;
  syncVisuals();
  clock=new TimelineScheduler(()=>engine!.context.currentTime);
  events=new SessionEvents($('stage'),visuals.canvas,{
    audio:()=>engine!,visuals:()=>visuals??null,settings:()=>referenceSettings,notice:status,
    narration:()=>{},displayNarration:()=>{},clearSpeech:()=>cues?.clear(),clearDevices:()=>{},cue:phrase=>{const t=outputSeconds();cues?.show(phrase,t);visuals?.triggerPulse(t,triggerEffectFor(phrase));},pink:()=>visuals?.pinkPulse(outputSeconds()),allowVisuals:()=>!input('audio-only').checked,
    paused:()=>!clock!.running,triggers:()=>({}),haptics:()=>false,restore:()=>{},allowSpeech:()=>true,allowTriggers:()=>true,allowTriggerSound:()=>sceneSounds(active?.soundPreferences).enabled,
  });
}
async function play(){
  stop();measurements.length=0;const epoch=generation;preparing=new AbortController();const controller=preparing;
  $<HTMLButtonElement>('play').disabled=true;status('Preparing the selected performance…');
  try {
    await initialize();if(epoch!==generation)return;
    const response=await fetch(`/api/next-gen-comparison/${variant()}.json`,{signal:controller.signal});
    if(!response.ok)throw Error('Comparison unavailable. Enable BAMBI_NEXT_GEN_COMPARISON=1 and build the local artifacts.');
    const data=await response.json() as Performance;
    if(data.version!==1||data.variant!==variant()||data.payloads.length>64)throw Error('Invalid local comparison');
    data.program=ProgramSchema.parse(data.program);
    const sounds=sceneSounds(data.soundPreferences);engine!.setScriptSoundsEnabled(sounds.enabled);engine!.configureTriggerSequence(sounds.sequence,sounds.variants);engine!.set('EFFECTS',sounds.effectsLevel);for(const [kind,db]of Object.entries(sounds.gains))engine!.setSoundGain(kind as 'snap'|'moan'|'wiper'|'pop'|'bell',db);
    if(epoch!==generation)return;
    const fresh=variant()==='adaptive'&&input('fresh').checked;
    const payloads=fresh?data.payloads.filter(p=>!data.liveWindows.some(w=>w.payloadId===p.payloadId)):data.payloads;
    if (fresh) {
      // Prepare the same bounded writer prefix before the session starts. This
      // response is discarded: rehearsal never creates output/history evidence.
      const window=data.liveWindows[0], event=data.program.events.find(e=>compileEvent(e).speech.some(slot=>slot.payloadId===window.payloadId))!;
      const previous=data.program.events.filter(e=>e.atMs<window.readyAfterMs).flatMap(e=>compileEvent(e).speech).map(slot=>data.payloads.find(p=>p.payloadId===slot.payloadId)).filter(Boolean).at(-1);
      status('Preparing the local writer before playback…');
      const started=performance.now(),warmId=crypto.randomUUID(),motif=data.program.motifs.find(m=>m.id===(event.motifId??event.baseline.motifId));
      const warm=await fetch('/api/events/render',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]),body:JSON.stringify({...referenceSettings,event,payloadId:window.payloadId,requestId:warmId,...(motif?{motif}:{}),precedingNarration:previous?.text??'',presentationPreferences:{visualsEnabled:true,reducedMotion:false,effectsEnabled:true}})});
      if(!warm.ok)throw Error('The local writer could not prepare. Use captured replay or check the local runtime.');
      const warmed=await warm.json() as RenderedEventSpeech;
      if(warmed.requestId!==warmId||warmed.payloadId!==window.payloadId)throw Error('Invalid writer preparation response');
      if(epoch!==generation)return;
      measurements.push({type:'writer-preparation',sessionMs:0,dispatchMs:performance.now()-started});
    }
    await events!.prepare(240000,.2,controller.signal,data.program,false,undefined,{payloads,importantPayloads:data.importantPayloads,liveWindows:fresh?data.liveWindows:[]});
    if(epoch!==generation)return;
    active=data;adjusted=false;syncVisuals();
    engine!.configurePreset({...data.backgroundPreset,drone:{...data.backgroundPreset.drone,enabled:true},noise:{...data.backgroundPreset.noise,enabled:false}},true);
    engine!.set('drone',Number(input('background').value));
    // Reuse the existing background owner, never a parallel oscillator controller.

    await engine!.context.resume();if(epoch!==generation)return;
    clock!.reset();clock!.start();events!.start();loop.start();
    $<HTMLButtonElement>('pause').disabled=false;$<HTMLButtonElement>('interrupt').disabled=false;
    status(fresh?'Playing. A fresh local bridge will connect the prepared parts.':'Playing the captured performance.');
  }catch(error){if(epoch===generation&&!controller.signal.aborted){stop();status(error instanceof Error?error.message:String(error));}}
  finally{if(epoch===generation){preparing=undefined;$<HTMLButtonElement>('play').disabled=false;}}
}
function stop(){generation++;preparing?.abort();preparing=undefined;events?.stop();engine?.stop();clock?.reset();loop?.stop();active=undefined;cues?.clear();input('seek').value='0';$('clock').textContent='0:00 / 4:00';$('word').textContent='';$('evidence').textContent='';visuals?.stop();$('stage').dataset.scene='Spiral Focus';$<HTMLButtonElement>('pause').textContent='Pause';$<HTMLButtonElement>('interrupt').disabled=true;$<HTMLButtonElement>('pause').disabled=true;$<HTMLButtonElement>('play').disabled=false;}
async function pause(){
  if(!clock||!engine||!events||!active)return;
  if(clock.running){clock.pause();events.pause();engine.pauseSession();await engine.context.suspend();$<HTMLButtonElement>('pause').textContent='Resume';status('Paused.');}
  else{await engine.context.resume();engine.resumeSession();events.resume();clock.start();$<HTMLButtonElement>('pause').textContent='Pause';status('Resumed.');}
}
function showTime(t:number){$('clock').textContent=`${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')} / 4:00`;}
function seek(){if(!clock||!events||!active)return;const t=Number(input('seek').value);clock.seek(t);events.seek(t*1000);engine!.stopEventCues();showTime(t);status('Moved to '+Math.floor(t)+' seconds. Unheard speech has been cleared.');}
const loop=new RuntimeLoop(()=>{
  if(!clock?.running||!events||!engine||!active)return;
  const t=clock.time;
  if(t>=240){const evidence=events.outputEvidence;stop();$('evidence').textContent=JSON.stringify(evidence,null,2);status('Performance complete.');return;}
  // These are the two existing clocks. Session control never reads output time.
  if(t*1000>=active.adjustmentAtMs&&!adjusted)quiet(true);
  events.tick(t*1000);events.present(t*1000,true);
  input('seek').value=String(t);showTime(t);
  $('evidence').textContent=JSON.stringify(events.outputEvidence,null,2);
},wall=>{
  if(!visuals||!clock||!engine||!active)return;
  events?.present(clock.time*1000,true);visuals.busy=!!active;
  const heardSeconds=outputSeconds();cues?.present(heardSeconds,!input('audio-only').checked);
  const density=events?.snapshot?.state.density.visualDensity??.14;
  visuals.stableSettings={...visuals.stableSettings,speed:visuals.motion===0?0:.15+density*.65,complexity:.3+density,depth:.2+density*.8,colorB:density>.7?'#e187d0':'#4d1953'};
  visuals.render(clock.time,events?.snapshot?.state.density.intensity??.5,engine.level(),wall,heardSeconds,engine.outputTime,engine.visualSignal());
},{now:()=>performance.now(),hidden:()=>document.hidden,requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:id=>cancelAnimationFrame(id),setTimer:(callback,ms)=>setInterval(callback,ms),clearTimer:id=>clearInterval(id as number)});
$('play').onclick=()=>void play();$('stop').onclick=()=>{stop();status('Stopped.');};$('pause').onclick=()=>void pause();$('interrupt').onclick=()=>{events?.userTurn();status('Current speech interrupted. Background and session time continue.');};$('quiet').onclick=()=>quiet();input('background').oninput=()=>engine?.set('drone',Number(input('background').value));input('seek').onchange=seek;$('variant').onchange=()=>{stop();links();status('Selected '+variant()+'. Press Play to compare.');};
function syncVisuals(){const enabled=!input('audio-only').checked;$('stage').dataset.visuals=enabled?'on':'off';if(visuals){visuals.clearTrigger();visuals.enabled=enabled;visuals.reduced=input('reduced').checked;}}
input('reduced').checked=matchMedia('(prefers-reduced-motion: reduce)').matches;
input('audio-only').onchange=syncVisuals;input('reduced').onchange=syncVisuals;
$('fullscreen').onclick=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void $('stage').requestFullscreen().catch(()=>status('Fullscreen is unavailable in this browser.'));};
window.addEventListener('pagehide',stop);
// Local diagnostics for the same browser checks used by the main app.
Object.assign(window,{bambiComparison:{get events(){return events;},get clock(){return clock;},get engine(){return engine;},get measurements(){return measurements;},get visuals(){return visuals;}}});
const requestedVariant=new URL(location.href).searchParams.get('variant');if(requestedVariant&&['current','reference','adaptive'].includes(requestedVariant))$<HTMLSelectElement>('variant').value=requestedVariant;
links();void fetch('/api/next-gen-comparison/manifest.json').then(r=>{if(!r.ok)throw Error();status('Ready. Use the same output level for each version.');}).catch(()=>status('Enable the local comparison and build its audio first. See docs/NEXT_GEN_COMPARISON.md.'));
