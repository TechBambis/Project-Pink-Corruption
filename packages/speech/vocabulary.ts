// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {readFileSync,readdirSync} from 'node:fs';
import {triggerAliases} from '../../config/trigger-sequence';
import {triggerSoundSettings} from '../../config/trigger-sounds';
import {BAMBISLEEP_SAMPLING} from '../../config/sampling';
import {devicePhaseDefaults,deviceTiming} from '../../config/device-control';
import {nativeSamplingModels,communityGemma,modelLabel} from '../ai/models';
import {sceneNames} from '../safety/actions';
import {devicePatterns} from '../devices/commands';
import {soundNames} from '../audio/sound-design';
import {triggerData,prompts,brainwavePresets} from '../content';

const essentials=['Breathing','breathe in','breathe out','Atemübungen','Einatmen','Ausatmen','Atemkreis','breathing circle','Bambi','Mikrofon','microphone'];
const normalize=(value:string)=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
const plain=(value:string)=>value.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&[^;]+;/g,' ').replace(/\s+/g,' ').trim();
function termsFromJSON(value:unknown):string[]{
 if(!value||typeof value!=='object')return [];
 return Object.entries(value).flatMap(([key,item])=>{
  if(typeof item==='string'&&/^(?:id|name|label|voice|mode|pattern|category|type|operation|vibrationPattern|rotationPattern)$/.test(key))return [key,item];
  return [key,...termsFromJSON(item)];
 });
}
/** Read names/options, never feed persona instructions or arbitrary config text into ASR. */
export function buildSpeechVocabulary(){
 const terms=[...essentials,...triggerAliases,...triggerData.triggers.map(t=>t.name),...sceneNames,...devicePatterns,...soundNames,
  ...Object.keys(BAMBISLEEP_SAMPLING),...Object.entries(triggerSoundSettings.sounds).flatMap(([id,sound])=>[id,sound.label]),
  ...prompts.flatMap(p=>[p.id,p.name]),...brainwavePresets.map(p=>p.name),
  ...termsFromJSON(devicePhaseDefaults),...termsFromJSON(deviceTiming),...termsFromJSON(triggerSoundSettings),
  ...[...nativeSamplingModels,communityGemma].flatMap(model=>[model,modelLabel(model)]),
  'JoyHub','Lovense','vibration','rotation','headphones','speakers','Induction','Deepening','Conditioning','Anchor','Awakening','Strobe Pulse','Color Cycle'];
 for(const dir of ['../../presets/audio/','../../config/']){
  const root=new URL(dir,import.meta.url);
  for(const entry of readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.json'))terms.push(...termsFromJSON(JSON.parse(readFileSync(new URL(entry.name,root),'utf8'))));
 }
 const html=readFileSync(new URL('../../apps/web/index.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/<option\b[^>]*>([^<]*)<\/option>|<label\b[^>]*>([^<]+)/gi))terms.push(plain(match[1]??match[2]));
 const unique=new Map<string,string>();
 for(const value of terms)for(const term of [value.replace(/\s+/g,' ').trim(),normalize(value)]){
  if(term.length>=2&&term.length<=85&&/[\p{L}]/u.test(term)&&!/[\[\]{}<>]/.test(term))unique.set(term.toLowerCase(),term);
 }
 return [...unique.values()];
}
export function speechVocabularyPrompt(vocabulary:string[],profile:Record<string,unknown>={},context=''){
 const priority:string[]=[];
 for(const key of ['scene','audio-preset','voice','model','spiral-mode','mic-playback-mode','prompt-template','bambi-name','collar-name'])if(typeof profile[key]==='string')priority.push(normalize(profile[key]));
 try{const selected=JSON.parse(String(profile['trigger-selection']??'[]'));if(Array.isArray(selected))priority.push(...selected.filter(x=>typeof x==='string').slice(0,12));}catch{}
 const tokens=new Set(normalize(context).toLowerCase().match(/[\p{L}]{3,}/gu)??[]);
 const ranked=vocabulary.map((term,index)=>({term,index,score:(term.toLowerCase().match(/[\p{L}]{3,}/gu)??[]).filter(word=>tokens.has(word)).length})).sort((a,b)=>b.score-a.score||a.index-b.index);
 const seen=new Set<string>();let prompt='';
 // Keep a short vocabulary hint; the complete dictionary remains available for ranking.
 for(const term of [...essentials,...priority,...ranked.filter(x=>x.score>0).map(x=>x.term),...ranked.map(x=>x.term)]){
  if(!term||term.length>85||/[\[\]{}<>\r\n]/.test(term)||seen.has(term.toLowerCase()))continue;
  const next=(prompt?prompt+', ':'')+term;
  if(new TextEncoder().encode(next).length>600)continue;
  prompt=next;seen.add(term.toLowerCase());
 }
 return prompt;
}
