// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export interface RuntimeLoopHost {
 now():number;hidden():boolean;
 requestFrame(callback:(wall:number)=>void):number;cancelFrame(id:number):void;
 setTimer(callback:()=>void,ms:number):unknown;clearTimer(id:unknown):void;
}
/** Transport keeps advancing when the browser suspends visual frames. Browser timers
 * can still be throttled; control reads the audio clock and skips expired cues. */
export class RuntimeLoop {
 private frame:number|null=null;private timer:unknown;private running=false;private lastFrame=-Infinity;
 constructor(private control:(wall:number)=>void,private render:(wall:number)=>void,private host:RuntimeLoopHost){}
 start(){
  if(this.running)return;this.running=true;
  this.frame=this.host.requestFrame(this.onFrame);
  this.timer=this.host.setTimer(()=>{const wall=this.host.now();if(this.running&&(this.host.hidden()||wall-this.lastFrame>=100))this.control(wall);},50);
 }
 private onFrame=(wall:number)=>{if(!this.running)return;this.lastFrame=wall;this.control(wall);if(!this.host.hidden())this.render(wall);if(this.running)this.frame=this.host.requestFrame(this.onFrame);};
 stop(){this.running=false;if(this.frame!==null)this.host.cancelFrame(this.frame);this.frame=null;this.host.clearTimer(this.timer);}
}
