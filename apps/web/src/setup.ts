// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {initModelSetup} from './model-setup';
import {initPrivacy} from './privacy';

const $=(id:string)=>document.getElementById(id)!;
const gib=(bytes:number|null|undefined)=>typeof bytes==='number'&&Number.isFinite(bytes)?`${(bytes/2**30).toFixed(1)} GiB`:'unknown';
function renderRecommendation(data:any){
 const recommendation=data.modelRecommendation;
 const row=document.createElement('p');row.setAttribute('data-model-recommendation','true');
 if(!recommendation){row.textContent='Local model recommendation: unavailable.';}
 else if(!recommendation.recommended){row.textContent=`Local model recommendation: no reviewed model fits the conservative memory estimate. ${recommendation.warnings?.[0]||''}`;}
 else {const selected=recommendation.recommended,hardware=recommendation.hardware;const status=selected.runtime==='available'?'ready to test':selected.runtime==='platform-pending'?'platform setup still needed':'setup needed';row.textContent=`Recommended local AI: ${selected.label} (${status}). ${hardware.platform} ${hardware.architecture}, ${gib(hardware.ramTotal)} RAM. Estimated working memory: ${gib(selected.estimatedWorkingBytes)}; ${selected.execution==='unified-memory'?'Apple unified memory':selected.execution==='gpu'?'GPU candidate':'CPU or partial GPU'}. This is an estimate; actual speed still needs a test.`;}
 $('readiness').append(row);
}
async function refresh(){
 try{const response=await fetch('/api/health');if(!response.ok)throw Error('Server unavailable');const data=await response.json();$('readiness').replaceChildren();
  const items=[['Local AI',data.ollama||data.llamaModels?.length],['Cloud AI',data.cloud?.ready],['Voice',data.kokoro],['Microphone transcription',data.whisper||data.streamingSpeech],['Saved conversations',data.database]];
  for(const [label,ready] of items){const row=document.createElement('p');row.textContent=`${label}: ${ready?'ready':'not available'}`;$('readiness').append(row);}
  if(data.modelRecommendation)renderRecommendation(data);
  $('cloud-note').textContent=data.cloud?.configured?(data.cloud.ready?`Remote model found. Select ${data.cloud.model || 'Remote AI'} in the main app.`:'Remote AI is configured but unavailable. Check the inference server, API URL and served model ID.'):'Cloud is optional. No cloud endpoint has been configured.';
  const report=await(await fetch('/api/diagnostics/replies')).json();const complete=report.replies.filter((reply:any)=>reply.stages['playback-start']!==undefined);const sorted=complete.map((reply:any)=>reply.stages['playback-start']).sort((a:number,b:number)=>a-b);
  $('diagnostics').textContent=sorted.length?`${sorted.length} playback samples. Server request to browser playback: p50 ${Math.round(sorted[Math.floor((sorted.length-1)*.5)])} ms; p95 ${Math.round(sorted[Math.ceil((sorted.length-1)*.95)])} ms.`:'No playback timing samples yet. Start a spoken conversation to record one.';
 }catch{$('readiness').textContent='The local server is unavailable. Start the app and check again.';}
}
$('refresh').onclick=()=>void refresh();
$('download-diagnostics').onclick=()=>{void fetch('/api/diagnostics/replies').then(r=>r.json()).then(report=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='bambi-timing-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
void refresh();

void (async()=>{
 await initPrivacy();
 const capabilities=await fetch('/api/desktop/capabilities').then(r=>r.ok?r.json():null);
 if(capabilities){$('development-options').hidden=true;$('development-setup').hidden=true;}
 const cleanup=await initModelSetup($('local-model-setup'),{finish:()=>location.assign('/'),prepared:()=>void refresh()});
 window.addEventListener('pagehide',cleanup,{once:true});
})().catch(error=>{$('local-model-setup').textContent='Model setup could not load. '+String(error);});
