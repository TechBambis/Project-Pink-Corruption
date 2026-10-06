// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

/** File/playlist lengths are transport state, never a saved AI-session choice. */
export function savedSessionDuration(value:unknown){
 const seconds=Number(value);
 return Number.isFinite(seconds)&&seconds>=60&&seconds<=7200?seconds:1200;
}
export function durationTime(seconds:number){
 const total=Math.max(0,Math.floor(seconds)),minutes=Math.floor(total/60);
 return (total>=3600?Math.floor(total/3600)+':'+String(minutes%60).padStart(2,'0'):String(minutes).padStart(2,'0'))+':'+String(total%60).padStart(2,'0');
}
export class SessionDuration {
 private seconds=1200;
 constructor(private input:HTMLSelectElement){}
 get preference(){return String(this.seconds);}
 restore(value:unknown){this.seconds=savedSessionDuration(value);this.showSession();}
 select(){if(!this.input.selectedOptions[0]?.dataset.playlistDuration)this.seconds=savedSessionDuration(this.input.value);}
 showSession(){
  this.input.querySelector('[data-playlist-duration]')?.remove();
  let option=[...this.input.options].find(option=>option.value===this.preference);
  if(!option){option=document.createElement('option');option.value=this.preference;option.textContent='Custom session · '+durationTime(this.seconds);this.input.append(option);}
  this.input.value=this.preference;this.input.disabled=false;
  return this.seconds;
 }
 showMedia(total:number,elapsed:number,playlist:boolean){
  const known=Number.isFinite(total)&&total>0,seconds=known?Math.max(1,elapsed+total+1):this.seconds;
  let option=this.input.querySelector<HTMLOptionElement>('[data-playlist-duration]');
  if(!option){option=document.createElement('option');option.dataset.playlistDuration='true';this.input.append(option);}
  option.value=String(seconds);option.textContent=(playlist?'Full playlist':'Full track')+(known?' · '+durationTime(total):'');
  this.input.value=option.value;this.input.disabled=true;
  return seconds;
 }
}
