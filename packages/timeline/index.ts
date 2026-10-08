// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface TimelineEvent { id: string; time: number; type: string; duration?: number; data?: unknown; scope?: string; relativeTo?: 'session' }
/** One monotonic clock, driven by the audio clock once audio has been initialized. */
export class TimelineScheduler {
 private anchor = 0; private offset = 0; running = false; private events: TimelineEvent[] = []; private delivered = new Set<string>();private cursor=0;
 constructor(private now: () => number = () => performance.now()/1000,private maxLateness:(event:TimelineEvent)=>number|undefined=()=>undefined) {}
 get time() { return this.offset + (this.running ? Math.max(0,this.now()-this.anchor) : 0); }
 start() { if (!this.running) {this.anchor=this.now();this.running=true;} }
 pause() { this.offset=this.time;this.running=false; }
 reset() {this.running=false;this.offset=0;this.events=[];this.delivered.clear();this.cursor=0;}
 seek(t:number){if(!Number.isFinite(t))throw Error('Invalid timeline time');this.offset=Math.max(0,t);this.anchor=this.now();this.cursor=this.lowerBound(this.offset);this.delivered=new Set(this.events.slice(0,this.cursor).map(e=>e.id));}
 private lowerBound(time:number){let low=0,high=this.events.length;while(low<high){const middle=(low+high)>>>1;if(this.events[middle].time<time)low=middle+1;else high=middle;}return low;}
 schedule(event:TimelineEvent){
  if(!Number.isFinite(event.time)||event.time<0||event.duration!==undefined&&(!Number.isFinite(event.duration)||event.duration<0))throw Error('Invalid timeline time');
  // Insert after equal-time events so authored ordering stays stable.
  let low=0,high=this.events.length;while(low<high){const middle=(low+high)>>>1;if(this.events[middle].time<=event.time)low=middle+1;else high=middle;}
  this.events.splice(low,0,event);this.cursor=Math.min(this.cursor,low);
 }
 tick(){
  if(!this.running)return [];
  const t=this.time,due:TimelineEvent[]=[];
  // Visit each due event once rather than scan all past and future events every frame.
  while(this.cursor<this.events.length&&this.events[this.cursor].time<=t){
   const event=this.events[this.cursor++];if(this.delivered.has(event.id))continue;this.delivered.add(event.id);
   const lateness=this.maxLateness(event);
   if(lateness!==undefined&&t-event.time>lateness)continue;
   if(event.duration!==undefined&&event.duration>0&&t>=event.time+event.duration)continue;
   due.push(event);
  }
  return due;
 }
 private remove(predicate:(event:TimelineEvent)=>boolean){
  const old=this.events;this.events=old.filter(e=>!predicate(e));
  const retained=new Set(this.events.map(e=>e.id));for(const event of old)if(!retained.has(event.id))this.delivered.delete(event.id);
  this.cursor=0;while(this.cursor<this.events.length&&this.delivered.has(this.events[this.cursor].id))this.cursor++;
 }
 clear(type?:string){if(type===undefined){this.events=[];this.delivered.clear();this.cursor=0;}else this.remove(e=>e.type===type);}
 clearScope(scope:string){this.remove(e=>e.scope===scope);}
}

/** State changes and playback accounting survive stalls; transient cues never catch up in a burst. */
export function presentationEventLateness(event:TimelineEvent){return ['scene','ambient','voice-start','caption','voice-caption','word'].includes(event.type)?undefined:.15;}
