// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { clamp, type AIAction } from '../safety/actions';
import { TimelineScheduler } from '../timeline';
import {phasePosition} from './phases';
export const stages = ['IDLE','READY','PREPARE','FOCUS','DEEPEN','MAIN','INTERACTIVE','COOLDOWN','FINISHED','ABORTED'] as const;
export type Stage = typeof stages[number];
export type Curve = 'linear'|'slow-build'|'wave'|'peak-and-cool';
export class SessionDirector {
 state: Stage='IDLE'; duration=1200; unlimited=false; intensity=45; curve:Curve='slow-build'; paused=false;interactive=false;held=false;
 get phaseTime(){return phasePosition(this.clock.time,this.duration,this.unlimited);}
 get active(){return !['IDLE','READY','FINISHED','ABORTED'].includes(this.state);}
 constructor(public clock:TimelineScheduler){}
 ready() {if (['IDLE','FINISHED','ABORTED'].includes(this.state))this.state='READY';}
 start() {if(this.state!=='READY')throw Error('Warm up first');this.clock.reset();this.clock.start();this.paused=false;this.interactive=false;this.held=false;this.state='PREPARE';}
 update() {if(this.paused||this.held||!this.active)return;const p=this.phaseTime/this.duration;this.state=p>=1?'FINISHED':p>=.9?'COOLDOWN':this.interactive?'INTERACTIVE':p>=.4?'MAIN':p>=.24?'DEEPEN':p>.08?'FOCUS':'PREPARE';if(p>=1)this.clock.pause();}
 togglePause(){if(!this.active)return;this.paused=!this.paused;this.paused||this.held?this.clock.pause():this.clock.start();}
 abort(){this.clock.reset();this.paused=false;this.interactive=false;this.held=false;this.state='ABORTED';}
 get level(){const p=clamp(this.phaseTime/this.duration);const shape=this.curve==='linear'?.3+.7*p:this.curve==='wave'?.65+.25*Math.sin(p*Math.PI*6):this.curve==='peak-and-cool'?Math.sin(p*Math.PI):.3+.7*Math.sin(Math.min(1,p/.8)*Math.PI/2);return clamp(this.intensity/100*shape*(p>.9?(1-p)*10:1));}
 approve(action:AIAction){if(!this.clock.running||this.state==='COOLDOWN')return false;if(action.type==='visual')action={...action,intensity:Math.min(action.intensity,this.level+.1)};this.clock.schedule({id:crypto.randomUUID(),time:this.clock.time,type:action.type,data:action});return true;}
 enterInteractive(freeze=true){if(!this.active||this.paused||!freeze&&this.state==='COOLDOWN')return false;this.interactive=true;if(freeze){this.held=true;this.clock.pause();}this.state='INTERACTIVE';return true;}
 endInteractive(){const held=this.held;this.interactive=false;this.held=false;if(held&&this.active&&!this.paused)this.clock.start();this.update();}
 get aiWindow(){return !this.paused&&!this.held&&!['PREPARE','COOLDOWN','ABORTED','FINISHED'].includes(this.state);}
}
