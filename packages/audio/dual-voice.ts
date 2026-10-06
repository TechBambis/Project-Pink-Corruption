// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {VoiceTrack} from '../speech/dual-voice';

/** Fill the reserved gap; extend it when the complete fragment needs more time. */
export function backgroundVoiceWindow(now:number,queueEnd:number,gapStart:number|undefined,spokenSeconds:number,pauseSeconds:number,tailSeconds=.2){
 const start=Math.max(now+.035,gapStart??queueEnd);
 const duration=Math.max(.001,spokenSeconds+tailSeconds,pauseSeconds);
 return {start,duration,end:start+duration};
}

/** Small feed-forward room taps, with no feedback or tail beyond 200 ms. */
export function connectVoiceTrack(context:AudioContext,source:AudioNode,output:AudioNode,track:VoiceTrack){
 const nodes:AudioNode[]=[];
 const gain=context.createGain();gain.gain.value=10**(track.gainDb/20);source.connect(gain);nodes.push(gain);
 const pan=context.createStereoPanner();pan.pan.value=(context.destination.maxChannelCount===1||context.destination.channelCount===1)?0:track.pan;
 gain.connect(pan);pan.connect(output);nodes.push(pan);
 if(track.reverbMs>0){
  for(const [fraction,weight] of [[1/3,.5],[2/3,.3],[1,.2]]){
   const delay=context.createDelay(.3),wet=context.createGain();
   delay.delayTime.value=track.reverbMs/1000*fraction;wet.gain.value=10**(track.reverbDb/20)*weight;
   pan.connect(delay);delay.connect(wet);wet.connect(output);nodes.push(delay,wet);
  }
 }
 return ()=>{source.disconnect();for(const node of nodes)node.disconnect();};
}
