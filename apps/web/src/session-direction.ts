// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

import { directionMechanisms, directionPreset, normalizeDirection, sessionDirections, type SessionDirection } from '../../../packages/session-director/direction';
import { spiralStyles } from '../../../packages/session-director/regie/registry';
import { sceneNames } from '../../../packages/safety/actions';
import {sessionJourneys,journeyPreset,type JourneyId} from '../../../packages/session-director/journeys';

const poolIds=[...spiralStyles.map(s=>'direction-style-'+s),...sceneNames.map((_,i)=>'direction-scene-'+i)];
export const directionPreferenceIds = ['session-direction','session-journey', 'direction-contrast', 'direction-repetition', 'direction-rhythm', 'direction-motifs', 'direction-theme','direction-ai-regie','direction-inner-response','direction-intent','direction-withdrawal','direction-playful-requests','direction-breathing', ...poolIds,...directionMechanisms.map(key => 'direction-' + key)];
export const directionBooleanIds = ['direction-ai-regie','direction-inner-response','direction-withdrawal','direction-playful-requests','direction-breathing',...poolIds,...directionMechanisms.map(key => 'direction-' + key)];
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
export function initDirectionControls() {
  const select = document.getElementById('session-direction') as HTMLSelectElement;
  select.replaceChildren(...[...sessionDirections.map(style => new Option(style.name, style.id)), new Option('Custom', 'custom')]);
  document.getElementById('session-journey')!.replaceChildren(new Option('Custom journey','custom'),...sessionJourneys.map(j=>new Option(j.name,j.id)));
  const choices=(container:string,items:{id:string;label:string}[])=>document.getElementById(container)!.replaceChildren(...items.map(item=>{const label=document.createElement('label'),input=document.createElement('input');label.className='check';input.type='checkbox';input.id=item.id;input.checked=true;label.append(input,document.createTextNode(item.label));return label;}));
  choices('direction-style-pool',spiralStyles.map(s=>({id:'direction-style-'+s,label:s[0].toUpperCase()+s.slice(1)})));
  choices('direction-scene-pool',sceneNames.map((s,i)=>({id:'direction-scene-'+i,label:s})));
}
export function currentDirection(): SessionDirection {
  return normalizeDirection({ contrast: Number(field('direction-contrast').value) / 100, repetition: Number(field('direction-repetition').value) / 100,
    rhythm: field('direction-rhythm').value, motifs: field('direction-motifs').value, theme: field('direction-theme').value,
    mechanisms: directionMechanisms.filter(key => field('direction-' + key).checked),regie:{enabled:field('direction-ai-regie').checked||field('session-interaction').value==='uninterrupted',innerResponses:field('direction-inner-response').checked,intent:field('direction-intent').value,withdrawal:field('direction-withdrawal').checked,playfulRequests:field('direction-playful-requests').checked,breathing:field('direction-breathing').checked,journey:field('session-journey').value as JourneyId|'custom',interactive:field('session-interaction').value!=='uninterrupted',
      scenes:sceneNames.filter((_,i)=>field('direction-scene-'+i).checked),styles:spiralStyles.filter(s=>field('direction-style-'+s).checked)} });
}
export function syncDirectionSummary(authored = false) {
  for (const key of ['contrast', 'repetition']) document.getElementById('direction-' + key + '-label')!.textContent = field('direction-' + key).value + '%';
  const style = sessionDirections.find(item => item.id === field('session-direction').value);
  const journey=sessionJourneys.find(j=>j.id===field('session-journey').value);
  document.getElementById('journey-description')!.textContent=authored?'Your imported program owns its story and timing.':journey?.description??'Choose a creative starting point, then adjust the moments you want.';
  document.getElementById('journey-signature')!.textContent=authored?'':journey?.signature??'';
  document.getElementById('direction-feedback-hint')!.textContent=field('session-interaction').value==='uninterrupted'?'Choose your starting idea and allowed moments before starting. Bambi leads without chat or microphone input.':'Build connected scenes from the moments you allow. Your feedback can change what comes next.';
  field('direction-playful-requests').disabled=authored||field('session-interaction').value==='uninterrupted';
  document.getElementById('direction-description')!.textContent = authored ? 'Your imported program owns its scenes and timing. Choose “Use adaptive direction” to edit a style.' : style?.description ?? 'Your own combination of voice rhythm, motifs and session mechanisms.';
  const influence = document.getElementById('direction-influence')!;
  influence.textContent = style?.influence ?? ''; influence.hidden = authored || !style?.influence;
  (document.getElementById('direction-controls') as HTMLFieldSetElement).disabled = authored;
}
export function applyDirectionPreset(id: string) {
  const settings = directionPreset(id);
  for (const key of ['contrast', 'repetition'] as const) field('direction-' + key).value = String(Math.round(settings[key] * 100));
  for (const key of ['rhythm', 'motifs', 'theme'] as const) field('direction-' + key).value = settings[key];
  for (const key of directionMechanisms) field('direction-' + key).checked = settings.mechanisms.includes(key);
}
export function directionInput(id: string) {
  if(id==='session-journey'&&field(id).value!=='custom'){
    const preset=journeyPreset(field(id).value as JourneyId,currentDirection());
    for(const key of ['contrast','repetition'] as const)field('direction-'+key).value=String(Math.round(preset[key]*100));
    for(const key of ['rhythm','motifs','theme'] as const)field('direction-'+key).value=preset[key];
    for(const key of directionMechanisms)field('direction-'+key).checked=preset.mechanisms.includes(key);
    for(const [key,value] of Object.entries({'direction-ai-regie':true,'direction-inner-response':preset.regie!.innerResponses,'direction-breathing':!!preset.regie!.breathing,'direction-withdrawal':!!preset.regie!.withdrawal}))field(key).checked=value;
    for(const style of spiralStyles)field('direction-style-'+style).checked=!!preset.regie!.styles?.includes(style);
    if(preset.regie!.breathing)field('breath-visuals').checked=true;
    field('session-direction').value='custom';
  }else if(id==='session-direction'&&field(id).value!=='custom'){applyDirectionPreset(field(id).value);field('session-journey').value='custom';}
  else if(id!=='session-journey'&&id!=='session-direction'&&directionPreferenceIds.includes(id))field('session-direction').value='custom';
}
