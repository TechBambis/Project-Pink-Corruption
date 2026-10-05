// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {BreathCue} from '../speech/breath';
import {validBreathCue} from '../speech/breath';
export const emptyBreathFrame={active:false,direction:'in' as 'in'|'out',scale:1,opacity:0,progress:0};
/** Scheduled narration and graphics read the same audio output clock. */
export class BreathVisualState {
 private queue:{cue:BreathCue;time:number}[]=[];
 schedule(cue:BreathCue,time:number){if(validBreathCue(cue)&&Number.isFinite(time)){this.queue.push({cue,time});this.queue.sort((a,b)=>a.time-b.time);this.queue=this.queue.slice(-32);}}
 clear(){this.queue=[];}
 frame(time:number,reduced=false){
  while(this.queue.length>1&&this.queue[1].time<=time)this.queue.shift();
  const current=this.queue[0];
  if(!current||time<current.time)return {...emptyBreathFrame};
  const duration=current.cue.durationMs/1000,p=Math.min(1,Math.max(0,(time-current.time)/duration));
  if(time>=current.time+duration+.3){this.queue.shift();return {...emptyBreathFrame};}
  const eased=p*p*(3-2*p),inhale=current.cue.direction==='in';
  return {active:true,direction:current.cue.direction,scale:reduced?1.075:1+.15*(inhale?eased:1-eased),
   opacity:(reduced?.6:inhale?.5+.2*eased:.7-.3*eased)*Math.min(1,Math.max(0,1-(time-current.time-duration)/.3)),progress:p};
 }
}
export class BreathOverlay {
 private layer=document.createElement('div');private ring:SVGSVGElement;private label:HTMLElement;
 constructor(canvas:HTMLCanvasElement){
  this.layer.className='breath-overlay';this.layer.dataset.breathLayer='';this.layer.hidden=true;
  // Keep the breathing display self-contained, including in the extension's shadow root.
  this.layer.style.cssText='position:absolute;inset:0;z-index:6;display:none;place-items:center;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at center,#26152e,#140c1d 72%);';
  this.layer.setAttribute('aria-hidden','true');
  this.layer.innerHTML='<svg class="breath-ring" viewBox="0 0 400 400" aria-hidden="true"><defs><radialGradient id="breath-glow"><stop stop-color="#62cec7" stop-opacity=".03"/><stop offset=".8" stop-color="#dc79c9" stop-opacity=".12"/><stop offset="1" stop-color="#dc79c9" stop-opacity="0"/></radialGradient><linearGradient id="breath-edge" x2="1" y2="1"><stop stop-color="#62cec7"/><stop offset="1" stop-color="#dc79c9"/></linearGradient></defs><circle cx="200" cy="200" r="175" fill="url(#breath-glow)"/><circle cx="200" cy="200" r="140" fill="none" stroke="url(#breath-edge)" stroke-width="2"/><circle cx="200" cy="200" r="133" fill="none" stroke="#f7d5ee" stroke-opacity=".2" stroke-width=".7"/><circle cx="200" cy="200" r="149" fill="none" stroke="#62cec7" stroke-opacity=".15" stroke-width=".7"/></svg><span class="breath-label"></span>';
  this.ring=this.layer.querySelector('svg')!;this.label=this.layer.querySelector('span')!;canvas.parentNode?.append(this.layer);
  this.ring.style.cssText='width:min(68%,58vh,480px);height:auto;overflow:visible;transform-origin:center;';
  this.label.style.cssText='position:absolute;inset:0;z-index:1;display:grid;place-items:center;font-family:Georgia,serif;font-size:clamp(20px,3vw,32px);color:#f5e3f0;text-shadow:0 2px 18px #140c1d;';
 }
 update(frame:ReturnType<BreathVisualState['frame']>){
  this.layer.hidden=!frame.active;this.layer.style.display=frame.active?'grid':'none';this.layer.parentElement?.classList.toggle('breathing',frame.active);
  if(!frame.active)return;
  this.layer.dataset.direction=frame.direction;this.layer.dataset.progress=frame.progress.toFixed(3);
  this.ring.style.transform=`scale(${frame.scale})`;this.ring.style.opacity=String(frame.opacity);
  this.label.textContent=frame.direction==='in'?'Breathe in':'Breathe out';
 }
}
