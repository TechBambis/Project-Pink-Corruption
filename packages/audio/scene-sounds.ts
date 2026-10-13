// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Read-only scene snapshot of the existing sound controls. No preference writes. */
export function sceneSounds(profile:Record<string,unknown>={}){
 const number=(key:string,fallback:number,min:number,max:number)=>{const value=Number(profile[key]??fallback);return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;};
 const bool=(key:string)=>profile[key]!==false;
 const choice=(key:string,values:string[],fallback:string)=>values.includes(String(profile[key]))?String(profile[key]):fallback;
 return {enabled:bool('trigger-sound'),effectsLevel:number('bus-effects',.28,0,1),sequence:{snap:bool('trigger-snap'),moan:bool('trigger-moan'),effects:bool('trigger-extra-effects'),wiperSeconds:number('trigger-wiper-seconds',10,5,20)},variants:{wiper:choice('trigger-wiper-variant',['wiper','wiper_alt','wiper_rain'],'wiper_alt'),pop:choice('trigger-pop-variant',['pop','pop_alt','pop_smack','pop_ccp','pop_ccp_alt','pop_ccp_soft'],'pop_ccp'),moan:choice('trigger-moan-variant',['moan','moan_alt','moan_third','random'],'random')},gains:Object.fromEntries(['snap','moan','wiper','pop','bell'].map(kind=>[kind,number('trigger-'+kind+'-db',0,-24,12)]))};
}
