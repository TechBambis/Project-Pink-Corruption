// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {cueTimelinePoints,nearestCue,type CuePoint} from '../../../packages/media/cue-timeline';
import type {BambiCloudCue} from '../../../packages/media/bambicloud';

/** Paint on data/size/option changes, never on the playback animation loop. */
export class CueTimeline {
 private cues:readonly BambiCloudCue[]=[];
 private points:CuePoint[]=[];
 private current='';
 constructor(private host:HTMLElement,private range:HTMLInputElement,private canvas:HTMLCanvasElement,
  private tip:HTMLElement,private enabled:HTMLInputElement,private duration:()=>number){
  new ResizeObserver(()=>this.refresh()).observe(host);
  enabled.addEventListener('change',()=>this.refresh());
  enabled.closest('.cue-marker-option')?.querySelector<HTMLButtonElement>('button')?.addEventListener('click',()=>enabled.click());
  host.addEventListener('pointermove',event=>{
   if(!this.enabled.checked||!this.points.length)return this.hide();
   const bounds=host.getBoundingClientRect(),width=Math.max(1,bounds.width-16);
   const position=Math.max(0,Math.min(1,(event.clientX-bounds.left-8)/width));
   this.preview(position*this.duration(),8/width*this.duration());
  });
  host.addEventListener('pointerleave',()=>this.hide());
  range.addEventListener('focus',()=>this.preview(Number(range.value)));
  range.addEventListener('input',()=>this.preview(Number(range.value)));
  range.addEventListener('blur',()=>this.hide());
 }
 load(cues:readonly BambiCloudCue[]){this.cues=cues;this.hide();this.refresh();}
 refresh(){
  this.points=cueTimelinePoints(this.cues,this.duration());
  const option=this.enabled.closest<HTMLElement>('.cue-marker-option');
  if(option)option.hidden=!this.points.length;
  const button=option?.querySelector<HTMLButtonElement>('button');if(button){button.setAttribute('aria-pressed',String(this.enabled.checked));button.title=this.enabled.checked?'Hide trigger markers':'Show trigger markers';}
  this.enabled.title='Show trigger timestamps on the timeline';
  this.canvas.hidden=!this.enabled.checked||!this.points.length;this.hide();
  if(this.canvas.hidden)return;
  const width=Math.max(1,this.host.clientWidth-16),scale=Math.min(2,devicePixelRatio||1);
  this.canvas.width=Math.round(width*scale);this.canvas.height=20*scale;
  const ctx=this.canvas.getContext('2d');if(!ctx)return;
  ctx.scale(scale,scale);ctx.fillStyle='#ed9bc8';
  for(const x of new Set(this.points.map(point=>Math.round(point.position*(width-1)))))ctx.fillRect(x,3,1,14);
 }
 private preview(seconds:number,tolerance=Infinity){
  if(!this.enabled.checked)return this.hide();
  const point=nearestCue(this.points,seconds);if(!point||Math.abs(point.seconds-seconds)>tolerance)return this.hide();
  const label=`${Math.floor(point.seconds/60)}:${String(Math.floor(point.seconds%60)).padStart(2,'0')} · ${point.name}`;
  if(this.current!==label){this.tip.textContent=label;this.current=label;}
  this.tip.hidden=false;
  const half=this.tip.offsetWidth/2,width=this.host.clientWidth;
  this.tip.style.left=`${Math.max(half,Math.min(width-half,8+point.position*Math.max(1,width-16)))}px`;
 }
 private hide(){this.tip.hidden=true;this.current='';}
}
