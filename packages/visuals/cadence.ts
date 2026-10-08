// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Follow RAF's display cadence; skip alternate refreshes while AI needs headroom.
 * This estimates the browser's delivered cadence, not the monitor's advertised Hz. */
export class VisualCadence {
 refreshHz=60;
 private previous:number|null=null;
 private intervals:number[]=[];
 private cursor=0;
 private pendingFrames=0;
 reset(){this.previous=null;this.intervals=[];this.cursor=0;this.pendingFrames=0;}
 frame(wall:number,busy:boolean){
  const delta=this.previous===null?0:wall-this.previous;this.previous=wall;
  if(delta>250)this.reset();
  else if(delta>=.5&&delta<=100){
   this.intervals[this.cursor++%24]=delta;
   if(this.intervals.length>=12&&this.cursor%12===0){
    const sorted=[...this.intervals].sort((a,b)=>a-b);
    // Occasional missed refreshes should not halve the estimated display cadence.
    this.refreshHz=1000/sorted[Math.floor(sorted.length/4)];
   }
  }
  if(!busy){this.pendingFrames=0;return true;}
  if(++this.pendingFrames<2)return false;
  this.pendingFrames=0;return true;
 }
 targetFps(busy:boolean){return this.refreshHz/(busy?2:1);}
}
