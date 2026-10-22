// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {triggerEffectFor} from '../../../packages/visuals/trigger-effects';

/** One trigger overlay for engine events, aligned speech and recorded media cues. */
export class TriggerPresentation {
 private layer:HTMLDivElement;
 private text:HTMLSpanElement;
 private window:{start:number;end:number}|null=null;
 constructor(private stage:HTMLElement){
  this.layer=document.createElement('div');this.layer.className='session-cue';this.layer.hidden=true;this.layer.setAttribute('aria-hidden','true');
  this.text=document.createElement('span');this.text.className='session-cue-text';this.layer.append(this.text);stage.append(this.layer);
 }
 show(phrase:string,atSeconds:number,durationMs=Math.max(700,triggerEffectFor(phrase).flash)){
  const label=phrase.trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ').toUpperCase();if(!label)return;
  this.text.textContent=label;this.text.dataset.cue=label==='BLINK'?'blink':'trigger';
  this.window={start:atSeconds,end:atSeconds+Math.min(2000,Math.max(300,durationMs))/1000};
 }
 present(atSeconds:number,enabled:boolean){
  if(this.window&&atSeconds>=this.window.end)this.clear();
  const visible=enabled&&!!this.window&&atSeconds>=this.window.start;
  this.layer.hidden=!visible;this.stage.toggleAttribute('data-trigger-text',visible);
 }
 clear(){this.window=null;this.text.textContent='';this.layer.hidden=true;this.stage.removeAttribute('data-trigger-text');}
}

/** A complete inner answer, previewed and held on the existing output clock. */
export class ResponsePresentation {
 private layer:HTMLDivElement;
 private text:HTMLSpanElement;
 private window:{start:number;end:number}|null=null;
 constructor(stage:HTMLElement){
  this.layer=document.createElement('div');this.layer.className='response-prompt';this.layer.hidden=true;this.layer.setAttribute('aria-hidden','true');
  this.text=document.createElement('span');this.layer.append(this.text);stage.append(this.layer);
 }
 show(phrase:string,start:number,end:number){
  const text=phrase.trim().replace(/\s+/g,' ');if(!text||text.length>600||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>30)return;
  this.text.textContent=text.toUpperCase();this.text.style.setProperty('--response-size',text.length>60?'6':text.length>30?'9':'12');this.window={start,end};
 }
 active(time:number){return !!this.window&&time>=this.window.start&&time<this.window.end;}
 present(time:number,enabled:boolean){if(this.window&&time>=this.window.end)this.clear();this.layer.hidden=!enabled||!this.active(time);}
 clear(){this.window=null;this.layer.hidden=true;this.text.textContent='';}
}
