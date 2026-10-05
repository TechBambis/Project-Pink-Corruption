// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Active 20 ms RMS, excluding pauses and quiet tails. Not an integrated LUFS claim. */
export function activeSoundRms(channels:readonly Float32Array[],rate:number){
 const size=Math.max(1,Math.round(rate*.02)),powers:number[]=[];let max=0;
 for(let offset=0;offset<channels[0].length;offset+=size){const end=Math.min(offset+size,channels[0].length);let sum=0;
  for(const channel of channels)for(let i=offset;i<end;i++)sum+=channel[i]*channel[i];
  const power=sum/((end-offset)*channels.length);powers.push(power);max=Math.max(max,power);
 }
 const active=powers.filter(power=>power>=Math.max(1e-10,max*.15**2));
 return active.length?Math.sqrt(active.reduce((sum,power)=>sum+power,0)/active.length):0;
}
export function matchSoundLevel(channels:readonly Float32Array[],rate:number,targetDb=-24){
 const rms=activeSoundRms(channels,rate);let peak=0;for(const channel of channels)for(const value of channel)peak=Math.max(peak,Math.abs(value));
 const factor=rms>1e-8&&peak>0?Math.min(10**(targetDb/20)/rms,.8/peak,10**(24/20)):1;
 for(const channel of channels)for(let i=0;i<channel.length;i++)channel[i]*=factor;
}
