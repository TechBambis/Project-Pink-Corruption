// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

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
  renderRecommendation(data);
  $('cloud-note').textContent=data.cloud?.configured?(data.cloud.ready?`Remote model found. Select ${data.cloud.model || 'Remote AI'} in the main app.`:'Remote AI is configured but unavailable. Check the inference server, API URL and served model ID.'):'Cloud is optional. No cloud endpoint has been configured.';
  const report=await(await fetch('/api/diagnostics/replies')).json();const complete=report.replies.filter((reply:any)=>reply.stages['playback-start']!==undefined);const sorted=complete.map((reply:any)=>reply.stages['playback-start']).sort((a:number,b:number)=>a-b);
  $('diagnostics').textContent=sorted.length?`${sorted.length} playback samples. Server request to browser playback: p50 ${Math.round(sorted[Math.floor((sorted.length-1)*.5)])} ms; p95 ${Math.round(sorted[Math.ceil((sorted.length-1)*.95)])} ms.`:'No playback timing samples yet. Start a spoken conversation to record one.';
 }catch{$('readiness').textContent='The local server is unavailable. Start the app and check again.';}
}
$('refresh').onclick=()=>void refresh();
$('download-diagnostics').onclick=()=>{void fetch('/api/diagnostics/replies').then(r=>r.json()).then(report=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='bambi-timing-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
void refresh();

async function desktopSetup(){
 const capabilities=await fetch('/api/desktop/capabilities').then(r=>r.ok?r.json():null);if(!capabilities?.alpha)return;
 $('desktop-setup').hidden=false;$('development-options').hidden=true;$('development-setup').hidden=true;
 async function poll(){try{const state=await fetch('/api/desktop/setup').then(r=>r.json());$('setup-progress').textContent=`${state.phase}${state.asset?' · '+state.asset:''} · ${(state.completed/1e9).toFixed(2)} / ${(state.total/1e9).toFixed(2)} GB${state.error?' · '+state.error:''}`;($('setup-bar') as HTMLProgressElement).value=state.completed/state.total;const busy=['downloading','verifying','preparing'].includes(state.phase);for(const id of ['setup-install','setup-copy'])($(id) as HTMLButtonElement).disabled=busy;($('setup-prepare') as HTMLButtonElement).disabled=busy||!state.verified;($('setup-cancel') as HTMLButtonElement).disabled=!busy;}catch{$('setup-progress').textContent='Setup server unavailable. Reopen the app; your verified data is retained.';}}
 async function command(action:string){try{const response=await fetch('/api/desktop/setup/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok)throw Error(result.error);await poll();if(action==='prepare')await refresh();}catch(error){$('setup-progress').textContent=String(error);}}
 $('setup-install').onclick=()=>void command('install');$('setup-cancel').onclick=()=>void command('cancel');$('setup-prepare').onclick=()=>void command('prepare');
 $('setup-copy').onclick=()=>{void (window as any).bambiDesktop?.copyModelData().then((result:any)=>{if(result.error)$('setup-progress').textContent=result.error;else void poll();}).catch((error:any)=>{$('setup-progress').textContent=String(error);});};
 await poll();const timer=setInterval(()=>void poll(),1000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
void desktopSetup().catch(()=>{});
