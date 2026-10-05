// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {newSessionPack,verifySessionPack,assetHash,assetBytes,packTimeline,packTranscript,type SessionPack} from '../../../packages/session-director/pack';
import {sceneNames} from '../../../packages/safety/actions';
import {parseTimelineJSON} from '../../../packages/timeline/import';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
let pack=newSessionPack(),audio:AudioContext|null=null,sources:AudioBufferSourceNode[]=[],previewStart=0,frame=0,epoch=0,renderController:AbortController|null=null;
const status=(text:string)=>{$('status').textContent=text;};
const input=(id:string)=>$<HTMLInputElement>(id).value;
function metadata(){pack.title=input('title').trim();pack.duration=Number(input('duration'));pack.description=input('description');}
function stop(){epoch++;renderController?.abort();renderController=null;for(const source of sources){try{source.stop();}catch{}}sources=[];cancelAnimationFrame(frame);previewStart=0;$('clock').textContent='00:00';$('caption').textContent='Preview stopped.';}
function download(data:string,name:string,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function render(){
 const list=$('cues');list.replaceChildren();
 for(const cue of [...pack.cues].sort((a,b)=>a.time-b.time)){
  const row=document.createElement('li'),time=document.createElement('time'),text=document.createElement('p'),remove=document.createElement('button');time.textContent=cue.time.toFixed(1)+' s';text.textContent=cue.type==='action'?JSON.stringify(cue.action):cue.text;remove.textContent='Remove';remove.onclick=()=>{stop();pack.cues=pack.cues.filter(item=>item.id!==cue.id);pack.assets=pack.assets.filter(asset=>pack.cues.some(item=>item.type==='speech'&&item.assetId===asset.id));render();};row.append(time,text,remove);list.append(row);
 }
 const canvas=$<HTMLCanvasElement>('timeline'),ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#50394f';ctx.fillRect(0,64,canvas.width,1);
 for(const cue of pack.cues){const x=cue.time/pack.duration*canvas.width;ctx.fillStyle=cue.type==='speech'?'#e9a4d6':'#62cec7';ctx.fillRect(x,35,Math.max(3,('duration' in cue?cue.duration:1)/pack.duration*canvas.width),24);}
 $<HTMLTextAreaElement>('timeline-json').value=JSON.stringify(packTimeline(pack).map(event=>event.type==='caption'?{time:event.time,type:'caption',text:(event.data as {text:string}).text,duration:event.duration}:{time:event.time,action:event.data}),null,2);
}
async function add(){
 stop();const current=epoch;metadata();const time=Number(input('time')),kind=input('kind'),text=input('text').trim();let candidate=structuredClone(pack);
 if(kind==='scene')candidate.cues.push({id:crypto.randomUUID(),time,type:'action',action:{type:'scene',scene:input('scene') as typeof sceneNames[number]}});
 else if(kind==='caption')candidate.cues.push({id:crypto.randomUUID(),time,type:'caption',text,duration:8});
 else{
  if(!text)throw Error('Write a passage first.');
  renderController=new AbortController();status('Rendering your voice…');
  const response=await fetch('/api/voice-lab/render',{method:'POST',headers:{'Content-Type':'application/json'},signal:renderController.signal,body:JSON.stringify({text,voice:input('voice'),speed:Number(input('speed')),preset:'bambi_local_clean'})});
  if(!response.ok)throw Error('Voice rendering is unavailable. Check Setup or try again after the active speech finishes.');
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>18000000)throw Error('This passage is too large for a portable package.');
  audio??=new AudioContext();const decoded=await audio.decodeAudioData(bytes.slice().buffer),assetId=crypto.randomUUID();let data='';for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192));
  candidate.assets.push({id:assetId,name:'Rendered passage.wav',mime:'audio/wav',sha256:await assetHash(bytes),data:btoa(data),attribution:input('attribution')});candidate.cues.push({id:crypto.randomUUID(),time,type:'speech',text,duration:decoded.duration,assetId});
 }
 const checked=await verifySessionPack(candidate);if(current!==epoch)return;pack=checked;renderController=null;render();status('Moment added. Preview it or keep writing.');
}
async function preview(){
 stop();const current=epoch;metadata();pack=await verifySessionPack(pack);audio??=new AudioContext();await audio.resume();
 const decoded=new Map<string,AudioBuffer>();for(const asset of pack.assets)decoded.set(asset.id,await audio.decodeAudioData(assetBytes(asset).buffer));
 for(const cue of pack.cues)if(cue.type==='speech'&&Math.abs(decoded.get(cue.assetId)!.duration-cue.duration)>.1)throw Error('A speech duration does not match its audio.');
 if(current!==epoch)return;previewStart=audio.currentTime+.1;
 for(const cue of pack.cues)if(cue.type==='speech'){const source=audio.createBufferSource();source.buffer=decoded.get(cue.assetId)!;source.connect(audio.destination);source.start(previewStart+cue.time);sources.push(source);}
 const cues=[...pack.cues].sort((a,b)=>a.time-b.time);let cursor=0,captionEnd=0;
 const tick=()=>{if(!previewStart||!audio)return;const t=Math.max(0,audio.currentTime-previewStart);$('clock').textContent=`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}`;
  while(cursor<cues.length&&cues[cursor].time<=t){const cue=cues[cursor++];if(cue.type==='action'){if(cue.action.type==='scene'){$('preview-scene').textContent=cue.action.scene;$('caption').parentElement!.style.background=cue.action.scene==='Soft Pink'?'#3b203d':'#20132b';}}else{$('caption').textContent=cue.text;captionEnd=cue.time+cue.duration;}}
  if(t>captionEnd)$('caption').textContent='';if(t>=pack.duration){stop();status('Preview complete.');return;}frame=requestAnimationFrame(tick);};tick();status('Previewing rendered audio. No live model is running for this preview.');
}
function run(task:()=>Promise<unknown>|unknown){void Promise.resolve().then(task).catch(error=>{stop();status(String(error));});}
$('add').onclick=()=>run(add);$('preview').onclick=()=>run(preview);$('stop').onclick=()=>{stop();status('Preview stopped.');};
$('export').onclick=()=>run(async()=>{metadata();pack=await verifySessionPack(pack);download(JSON.stringify(pack,null,2),'session.bambi.json');status('Package exported with audio and attribution.');});
$('transcript').onclick=()=>download(packTranscript(pack),'session-transcript.txt','text/plain');
$('export-timeline').onclick=()=>download($<HTMLTextAreaElement>('timeline-json').value,'session-timeline.json');
$('apply-timeline').onclick=()=>run(async()=>{stop();metadata();const events=parseTimelineJSON($<HTMLTextAreaElement>('timeline-json').value,pack.duration);const candidate=structuredClone(pack);candidate.cues=candidate.cues.filter(cue=>cue.type==='speech');for(const event of events)candidate.cues.push(event.type==='caption'?{id:event.id,time:event.time,type:'caption',text:(event.data as {text:string}).text,duration:event.duration!}:{id:event.id,time:event.time,type:'action',action:event.data as any});pack=await verifySessionPack(candidate);render();status('Presentation timeline updated.');});
$<HTMLInputElement>('import').onchange=event=>run(async()=>{const file=(event.target as HTMLInputElement).files?.[0];if(!file)return;if(file.size>34000000)throw Error('This package exceeds the size limit.');stop();pack=await verifySessionPack(JSON.parse(await file.text()));$<HTMLInputElement>('title').value=pack.title;$<HTMLInputElement>('duration').value=String(pack.duration);$<HTMLTextAreaElement>('description').value=pack.description;render();status('Package opened. Preview when you are ready.');});
$<HTMLSelectElement>('kind').onchange=()=>{$('scene-label').hidden=input('kind')!=='scene';$('text-label').hidden=input('kind')==='scene';};
for(const scene of sceneNames){const option=document.createElement('option');option.value=scene;option.textContent=scene;$('scene').append(option);}
void fetch('/api/health').then(r=>r.json()).then(data=>{if(data.voices?.length){const select=$<HTMLSelectElement>('voice');select.replaceChildren();for(const voice of data.voices){const option=document.createElement('option');option.value=voice;option.textContent=voice;select.append(option);}select.value=data.voices.includes('af_heart')?'af_heart':data.voices[0];}}).catch(()=>status('Local services are offline. Existing packages can still be opened.'));
window.addEventListener('pagehide',stop);render();
