// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Local energy gate with noise adaptation, hysteresis and time-based confirmation. */
export class VoiceActivity {
 silenceMs=750;minRms=.035;noiseRms=.008;active=false;voicedMs=0;
 private onsetMs=0;private quietMs=0;private calibrationMs=0;private calibration:number[]=[];
 get threshold(){return Math.max(this.minRms,this.noiseRms*3);}
 reset(){this.active=false;this.voicedMs=0;this.onsetMs=0;this.quietMs=0;}
 restart(){this.reset();this.noiseRms=.008;this.calibrationMs=0;this.calibration=[];}
 process(rms:number,ms:number):{start:boolean;end:boolean;voiced:boolean;valid:boolean}{
  if(this.calibrationMs<350){this.calibration.push(rms);this.calibrationMs+=ms;
   if(this.calibrationMs>=350){const sorted=[...this.calibration].sort((a,b)=>a-b);this.noiseRms=Math.max(.0001,sorted[Math.floor(sorted.length*.2)]);this.calibration=[];}
   return {start:false,end:false,voiced:false,valid:false};
  }
  const voiced=rms> (this.active?Math.max(this.minRms*.6,this.noiseRms*1.8):this.threshold);
  let start=false,end=false,valid=false;
  if(!this.active){
   if(voiced){this.onsetMs+=ms;this.quietMs=0;}
   else{this.quietMs+=ms;if(this.quietMs>40)this.onsetMs=0;this.noiseRms+= (rms-this.noiseRms)*(1-Math.exp(-ms/2000));}
   if(this.onsetMs>=180){this.active=true;this.voicedMs=this.onsetMs;this.quietMs=0;start=true;}
  }else{
   if(voiced){this.voicedMs+=ms;this.quietMs=0;}else this.quietMs+=ms;
   if(this.quietMs>=this.silenceMs){end=true;valid=this.voicedMs>=240;this.reset();}
  }
  return {start,end,voiced,valid};
 }
}

/** Discards playback and its acoustic tail before they can enter the pre-roll. */
export class PlaybackInputGuard {
 private until=0;
 blocked(output:boolean,now:number,protectedMode=true){
  if(!protectedMode){this.until=0;return false;}
  if(output)this.until=now+400;
  return output||now<this.until;
 }
 reset(){this.until=0;}
}
