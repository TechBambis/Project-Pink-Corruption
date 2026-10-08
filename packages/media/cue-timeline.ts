// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import type {BambiCloudCue} from './bambicloud';

export interface CuePoint {seconds:number;name:string;position:number}
export function cueTimelinePoints(cues:readonly BambiCloudCue[],duration:number):CuePoint[]{
 if(!Number.isFinite(duration)||duration<=0)return [];
 return cues.filter(c=>Number.isFinite(c.start)&&c.start>=0&&c.start/1000<=duration)
  .map(c=>({seconds:c.start/1000,name:c.trigger,position:c.start/1000/duration})).sort((a,b)=>a.seconds-b.seconds);
}
/** Binary search keeps hover independent of cue count and never executes a cue. */
export function nearestCue(points:readonly CuePoint[],seconds:number){
 if(!points.length||!Number.isFinite(seconds))return undefined;
 let low=0,high=points.length;
 while(low<high){const mid=(low+high)>>>1;if(points[mid].seconds<seconds)low=mid+1;else high=mid;}
 const after=points[low],before=points[low-1];
 return !before?after:!after?before:seconds-before.seconds<=after.seconds-seconds?before:after;
}
