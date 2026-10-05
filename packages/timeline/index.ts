// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface TimelineEvent { id: string; time: number; type: string; duration?: number; data?: unknown; scope?: string; relativeTo?: 'session' }
/** One monotonic clock, driven by the audio clock once audio has been initialized. */
export class TimelineScheduler {
 private anchor = 0; private offset = 0; running = false; private events: TimelineEvent[] = []; private delivered = new Set<string>();
 constructor(private now: () => number = () => performance.now()/1000) {}
 get time() { return this.offset + (this.running ? Math.max(0,this.now()-this.anchor) : 0); }
 start() { if (!this.running) {this.anchor=this.now();this.running=true;} }
 pause() { this.offset=this.time;this.running=false; }
 reset() {this.running=false;this.offset=0;this.events=[];this.delivered.clear();}
 seek(t: number) {this.offset=Math.max(0,t);this.anchor=this.now();this.delivered=new Set(this.events.filter(e=>e.time<this.offset).map(e=>e.id));}
 schedule(event: TimelineEvent) { if (!Number.isFinite(event.time)||event.time<0) throw Error('Invalid timeline time'); this.events.push(event);this.events.sort((a,b)=>a.time-b.time); }
 tick() { if (!this.running) return []; const t=this.time; const due=this.events.filter(e=>e.time<=t&&!this.delivered.has(e.id));due.forEach(e=>this.delivered.add(e.id));return due; }
 clear(type?: string) {this.events=type?this.events.filter(e=>e.type!==type):[];}
 clearScope(scope: string) {this.events=this.events.filter(e=>e.scope!==scope);}
}
