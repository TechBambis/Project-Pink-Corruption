// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

export const sceneTransitionSeconds = .65;
/** Session-clock transitions. Blanks, reduced motion, seeks and stops always cut. */
export class SceneTransition {
 private key: string | null = null;
 private previous = 0;
 private started: number | null = null;
 private allowed = false;
 reset(){this.key=null;this.started=null;this.allowed=false;}
 frame(key:string,time:number,allowed:boolean){
  const discontinuity = this.key !== null && (time < this.previous || time-this.previous > 1);
  const capture = this.key !== null && key !== this.key && allowed && this.allowed && !discontinuity;
  if(capture)this.started=time;
  else if(!allowed || discontinuity)this.started=null;
  this.key=key;this.previous=time;this.allowed=allowed;
  const progress=this.started===null?1:Math.min(1,Math.max(0,(time-this.started)/sceneTransitionSeconds));
  if(progress>=1)this.started=null;
  return {capture,opacity:1-progress*progress*(3-2*progress)};
 }
}
