// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';
import {preferenceRules} from './preference-rules';
import {directionMechanisms,sessionDirections} from '../session-director/direction';
import {journeyIds} from '../session-director/journeys';
import {spiralStyles} from '../session-director/regie/registry';
import {sceneNames} from '../safety/actions';
import {TriggerTimingSchema} from '../session-director/trigger-timing';
import {narrationPauses} from '../session-director/narration';

export type Preferences=Record<string,string|number|boolean>;
const choices=(values:readonly string[])=>z.string().refine(v=>values.includes(v),'Unknown setting choice');
const numeric=(min:number,max:number,empty=false)=>z.union([z.string().max(40),z.number().finite()]).refine(v=>empty&&v===''||(typeof v==='number'||/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v))&&Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max,'Setting is outside its supported range');
const shape:Record<string,z.ZodTypeAny>={};
for(const [id,rule] of Object.entries(preferenceRules)){
 let schema:z.ZodTypeAny;
 switch(rule.type){
  case 'boolean':schema=z.boolean();break;
  case 'color':schema=z.string().regex(/^#[a-f0-9]{6}$/i);break;
  case 'enum':schema=choices(rule.values);break;
  case 'number':schema=numeric(rule.min,rule.max,'empty' in rule&&rule.empty);break;
  default:schema=z.string().max(rule.max);
 }
 shape[id]=schema.optional();
}
for(const id of [...directionMechanisms.map(k=>'direction-'+k),...spiralStyles.map(k=>'direction-style-'+k),...sceneNames.map((_,i)=>'direction-scene-'+i)])shape[id]=z.boolean().optional();
for(const phase of Object.keys(narrationPauses))shape['narration-pause-'+phase]=numeric(0,30,true).optional();
shape['session-direction']=choices(['custom',...sessionDirections.map(s=>s.id)]).optional();
shape['session-journey']=choices(['custom',...journeyIds]).optional();
shape['spiral-style']=choices(spiralStyles).optional();
shape.scene=choices(sceneNames).optional();
shape.duration=z.union([z.literal('unlimited'),numeric(60,7200)]).optional();
for(const key of ['duration-version','dialogue-version','visuals-version','sampling-version'])shape[key]=z.number().int().min(0).max(2).optional();
shape['trigger-selection']=z.string().max(8000).refine(v=>{try{return z.array(z.string().max(160)).max(200).safeParse(JSON.parse(v)).success;}catch{return false;}},'Invalid trigger selection').optional();
shape['trigger-timing-config']=z.string().max(8000).refine(v=>{try{return TriggerTimingSchema.safeParse(JSON.parse(v)).success;}catch{return false;}},'Invalid trigger timing').optional();
export const PreferencesSchema=z.object(shape).strict();
export const preferenceKeys=Object.keys(shape);
export const personalKeys=new Set(['bambi-name','collar-name','persona','guided-style','direction-intent']);
/** Local resources and motor calibration are never transplanted by a preset. */
export function machinePreference(key:string){return key.startsWith('device-')||key.startsWith('mic-')||['model','q8-kv-cache','dflash-4b','performance','event-haptics'].includes(key);}
export function portablePreferences(raw:Record<string,unknown>,personal=false):Preferences{
 const result:Preferences={};
 for(const [key,value] of Object.entries(raw)){
  if(machinePreference(key)||!personal&&personalKeys.has(key)||!shape[key])continue;
  const checked=shape[key].safeParse(value);if(checked.success&&checked.data!==undefined)result[key]=checked.data;
 }
 return result;
}
export function exportPreferences(raw:Record<string,unknown>):Preferences{
 const result:Preferences={};
 for(const [key,value] of Object.entries(raw)){const checked=shape[key]?.safeParse(value);if(checked?.success&&checked.data!==undefined)result[key]=checked.data;}
 return result;
}
export function mergePreferences(current:Record<string,unknown>,incoming:Preferences):Preferences{
 const retained=Object.fromEntries(Object.entries(current).filter(([,value])=>typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))) as Preferences;
 return {...retained,...portablePreferences(incoming,true)};
}
export function preferenceGroup(key:string){
 if(personalKeys.has(key))return 'Personal text';
 if(machinePreference(key))return 'This computer';
 if(key.startsWith('visual')||key.startsWith('spiral')||['scene','phase-visuals','motion','density','reduced','subtitles'].includes(key))return 'Visuals';
 if(key.startsWith('trigger'))return 'Triggers';
 if(key.startsWith('voice')||key.startsWith('bus-')||key.startsWith('background')||key.startsWith('brainwave')||key.startsWith('sound')||key.startsWith('tick')||['master','speed','audio-preset','dual-voice','original-sounds','breath-sound'].includes(key))return 'Voice & sound';
 return 'Session & conversation';
}
