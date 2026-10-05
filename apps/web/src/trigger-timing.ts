// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {categoryTriggers,defaultTriggerTiming,parseTriggerTiming,triggerCategories,triggerStages,
  triggersForCategories,type TriggerCategory,type TriggerStage} from '../../../packages/session-director/trigger-timing';
import type {SessionPhase} from '../../../packages/session-director/phases';

const node=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export function currentTriggerTiming(){return parseTriggerTiming(node<HTMLInputElement>('trigger-timing-config').value);}
const labels:Record<TriggerStage,string>={induction:'Induction · 0–24%',deepening:'Deepening · 24–40%',
  conditioning:'Conditioning · 40–74%',reinforcement:'Reinforcement · 74–80%',anchor:'Anchor · 80–90%',awakening:'Awakening · 90–100%'};
export function initTriggerTiming(preview:(trigger:string,phase:SessionPhase,progress:number)=>Promise<void>,stop:()=>void){
  const store=node<HTMLInputElement>('trigger-timing-config'),phase=node<HTMLSelectElement>('trigger-test-phase');
  const category=node<HTMLSelectElement>('trigger-test-category'),word=node<HTMLSelectElement>('trigger-test-word');
  const enabled=node<HTMLInputElement>('trigger-timing-enabled'),start=node<HTMLInputElement>('trigger-reinforcement-start');
  const groups=node('trigger-stage-groups'),previewButton=node<HTMLButtonElement>('trigger-test-play');
  for(const stage of triggerStages)phase.add(new Option(labels[stage],stage));
  for(const item of triggerCategories)category.add(new Option(item[0].toUpperCase()+item.slice(1),item));
  store.value=JSON.stringify(defaultTriggerTiming());
  const save=()=>store.dispatchEvent(new Event('input'));
  function syncWords(){
    const previous=word.value;
    word.replaceChildren(...categoryTriggers[category.value as TriggerCategory].map(name=>new Option(name,name)));
    if([...word.options].some(option=>option.value===previous))word.value=previous;
  }
  function syncSummary(){
    const config=currentTriggerTiming(),stage=phase.value as TriggerStage;
    const triggers=triggersForCategories(config.stages[stage]);
    node('trigger-stage-summary').textContent=`Assigned to this stage: ${triggers.join(', ')||'no triggers'}. The category below can be auditioned independently.`;
    phase.options[2].textContent=`Conditioning · 40–${(40+.4*config.reinforcementStart).toFixed(1)}%`;
    phase.options[3].textContent=`Reinforcement · ${(40+.4*config.reinforcementStart).toFixed(1)}–80%`;
  }
  for(const stage of triggerStages){
    const fieldset=document.createElement('fieldset'),legend=document.createElement('legend');
    legend.textContent=stage[0].toUpperCase()+stage.slice(1);fieldset.append(legend);
    for(const item of triggerCategories){
      const label=document.createElement('label'),checkbox=document.createElement('input');
      label.className='check';checkbox.type='checkbox';checkbox.dataset.stage=stage;checkbox.value=item;
      checkbox.id=`trigger-group-${stage}-${item}`;label.append(checkbox,item[0].toUpperCase()+item.slice(1));fieldset.append(label);
      checkbox.onchange=()=>{const config=currentTriggerTiming();config.stages[stage]=[...fieldset.querySelectorAll<HTMLInputElement>('input:checked')].map(input=>input.value as TriggerCategory);store.value=JSON.stringify(config);save();};
    }
    groups.append(fieldset);
  }
  const sync=()=>{
    const config=currentTriggerTiming();store.value=JSON.stringify(config);enabled.checked=config.enabled;start.value=String(config.reinforcementStart);
    for(const checkbox of groups.querySelectorAll<HTMLInputElement>('input'))checkbox.checked=config.stages[checkbox.dataset.stage as TriggerStage].includes(checkbox.value as TriggerCategory);
    syncSummary();
  };
  enabled.onchange=()=>{const config=currentTriggerTiming();config.enabled=enabled.checked;store.value=JSON.stringify(config);save();};
  start.onchange=()=>{const config=currentTriggerTiming();const value=Number(start.value);config.reinforcementStart=Number.isFinite(value)?Math.min(100,Math.max(0,value)):85;store.value=JSON.stringify(config);save();};
  phase.onchange=()=>{category.value=currentTriggerTiming().stages[phase.value as TriggerStage][0]??'entry';syncWords();syncSummary();};
  category.onchange=syncWords;
  node('trigger-timing-reset').onclick=()=>{store.value=JSON.stringify(defaultTriggerTiming());save();};
  previewButton.onclick=async()=>{
    previewButton.disabled=true;
    const stage=phase.value as TriggerStage;
    try{await preview(word.value,stage==='reinforcement'?'conditioning':stage,
      stage==='reinforcement'?currentTriggerTiming().reinforcementStart/100:0);}finally{previewButton.disabled=false;}
  };
  node('trigger-test-stop').onclick=stop;
  syncWords();sync();return {sync};
}
