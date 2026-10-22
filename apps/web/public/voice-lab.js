// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

const $=id=>document.getElementById(id);
let catalog,config,controller=null;
const slots={a:null,b:null};
const providerDrafts={};
let activeProvider='kokoro';
const attitudes={
 doll:{pitch:1.8,speed:1.03,pause:150,text:"Oh, sweetie, that little attitude is adorable! <laugh> You can keep pretending, but we both know who is running this show. Cute, right?"},
 brat:{pitch:.8,speed:1.08,pause:120,text:"Excuse me, did you really think that would impress me? <sigh> Try again, darling; this time, make it worth my attention!"},
 tease:{pitch:1.2,speed:.98,pause:180,text:"Aww, look at you, trying so hard to play it cool! <laugh> Come on, darling, you can do better than that. There you go!"}
};
function deliveryDraft(){return {quality:$('quality').value,seed:$('take-seed').value,sentences:$('sentence-delivery').checked,attitude:$('attitude').value,expressions:$('native-expressions').checked,qwenInstruct:$('qwen-instruct').value,qwenSeed:$('qwen-seed').value,qwenBackend:$('qwen-backend').value,qwenDelivery:$('qwen-delivery').value,mossSeed:$('moss-seed').value};}
function restoreDelivery(draft){$('quality').value=draft.quality;$('take-seed').value=draft.seed??'41';$('sentence-delivery').checked=draft.sentences??true;$('attitude').value=draft.attitude??'doll';$('native-expressions').checked=draft.expressions??true;$('qwen-instruct').value=draft.qwenInstruct??'';$('qwen-seed').value=draft.qwenSeed??'41';$('qwen-backend').value=draft.qwenBackend??'Vulkan0';$('qwen-delivery').value=draft.qwenDelivery??'passage';$('moss-seed').value=draft.mossSeed??'41';}
const engine=()=>$('provider').value;
function providerInfo(){return catalog.providers?.[engine()]??{label:'Kokoro',available:true,voices:catalog.voices,voiceBlending:true};}
function providerControls(){
 const info=providerInfo(),supertonic=engine()==='supertonic3',qwen=engine()==='qwen3',moss=engine()==='moss',preview=engine()!=='kokoro'&&engine()!=='moss';
 $('expression-controls').hidden=!supertonic;$('quality-control').hidden=!supertonic;$('voice2').disabled=!info.voiceBlending;$('weight').disabled=!info.voiceBlending;
 $('qwen-controls').hidden=!qwen;$('moss-controls').hidden=!moss;$('speed').disabled=qwen||moss;$('soft-bright').disabled=qwen||moss;$('left-layer').disabled=qwen||moss;$('right-layer').disabled=qwen||moss;
 for(const id of ['pitch','pause','processing','echo','drone','noise'])$(id).disabled=moss;
 $('text').maxLength=info.maxTextLength??3000;$('use-preset').disabled=preview;
 $('session-note').textContent=preview?info.label+' is a Lab preview. Your session voice stays on Kokoro.':'Custom processing stays in the Lab; saving changes the session voice, speed and preset.';
 $('provider-note').textContent=moss?'Your installed reference, with its natural pitch and pace. Compare takes in English; word timing and vocal tags are unavailable.':qwen?'Describe how she should sound, then compare takes. Start with pitch 0 to hear the model’s own expression. Tempo comes from your description.':supertonic?'Try the attitude auditions below: sentence delivery, native expression sounds and different takes. More quality steps refine synthesis; they do not select an emotion.':'Your existing Kokoro voices and blends.';
 $('runtime').textContent=info.label+' / '+(qwen?$('qwen-backend').selectedOptions[0].textContent:'CPU')+' / fully local';
}
function voiceOptions(){
 for(const id of ['voice','voice2']){$(id).replaceChildren();if(id==='voice2')$(id).append(new Option('No blend',''));for(const voice of providerInfo().voices)$(id).append(new Option(({doll:'Bimbo doll',brat:'Bratty & bitchy',tease:'Sweet & teasing',custom:'My own description'})[voice]??(voice==='bambi_classic'?'Bambi Classic (custom blend)':voice.replace('af_','')),voice));}
}
function fitProvider(){
 const info=providerInfo();
 if(!info.voiceBlending&&!info.voices.includes(config.voice))config.voice=info.voices[0];
 if(!info.voiceBlending){for(const [key,index] of [['left_voice',1],['right_voice',2]])if(!info.voices.includes(config.layers[key].voice))config.layers[key].voice=info.voices[index]??info.voices[0];}
 if(engine()==='qwen3'||engine()==='moss'){config.speed=1;config.layers.left_voice.enabled=false;config.layers.right_voice.enabled=false;}
 if(engine()==='moss'){config.pitchSemitones=0;config.sampleRate=48000;config.processing.enabled=false;config.drone.enabled=false;config.noise.enabled=false;}
}
const inputs=['voice','voice2','weight','speed','pitch','pause','processing','highpass','ratio','echo','echo-delay','drone','drone-db','noise','noise-type','noise-db','noise-filter','noise-width','left-layer','right-layer'];
const number=id=>Number($(id).value),check=id=>$(id).checked;
function status(text){$('status').textContent=text;}
function mix(){const main=$('voice').value,second=$('voice2').value;return second?`${main}:${1-number('weight')} + ${second}:${number('weight')}`:main;}
function syncEditor(){ $('config').value=JSON.stringify(config,null,2);$('mix-expression').textContent=config.voice;$('weight-label').textContent=`${Math.round(number('weight')*100)} %`; }
function readControls(){config.voice=mix();config.speed=number('speed');config.pitchSemitones=number('pitch');config.timing.normal=number('pause');Object.assign(config.processing,{enabled:check('processing'),highpassHz:number('highpass'),compressionRatio:number('ratio'),echoEnabled:check('echo'),echoMs:number('echo-delay')});config.drone.enabled=check('drone');config.mix.drone=number('drone-db');Object.assign(config.noise,{enabled:check('noise'),type:$('noise-type').value,lowpassHz:number('noise-filter'),width:number('noise-width')});config.mix.noise=number('noise-db');config.layers.left_voice.enabled=check('left-layer');config.layers.right_voice.enabled=check('right-layer');syncEditor();}
function setControls(){
  const parts=config.voice.split('+').map(x=>x.trim()),read=x=>{const m=/^([a-zA-Z0-9_]+)(?::([\d.]+)|\(([\d.]+)\))?$/.exec(x);return m?{name:m[1],weight:Number(m[2]??m[3]??1)}:null;};
  const first=read(parts[0]),second=parts[1]?read(parts[1]):null;if(first)$('voice').value=first.name;$('voice2').value=second?.name||'';if(second)$('weight').value=String(second.weight/(first.weight+second.weight));
  for(const [id,value] of Object.entries({speed:config.speed,pitch:config.pitchSemitones,pause:config.timing.normal,highpass:config.processing.highpassHz,ratio:config.processing.compressionRatio,'echo-delay':config.processing.echoMs,'drone-db':config.mix.drone,'noise-type':config.noise.type,'noise-db':config.mix.noise,'noise-filter':config.noise.lowpassHz,'noise-width':config.noise.width}))$(id).value=String(value);
  for(const [id,value] of Object.entries({processing:config.processing.enabled,echo:config.processing.echoEnabled,drone:config.drone.enabled,noise:config.noise.enabled,'left-layer':config.layers.left_voice.enabled,'right-layer':config.layers.right_voice.enabled}))$(id).checked=value;
  $('description').textContent=config.description;syncEditor();
}
function stop(){controller?.abort();for(const audio of document.querySelectorAll('audio')){audio.pause();audio.currentTime=0;}}
async function waveform(blob,id){const ctx=new AudioContext();try{const buffer=await ctx.decodeAudioData(await blob.arrayBuffer()),samples=buffer.getChannelData(0),canvas=$('wave-'+id),draw=canvas.getContext('2d');draw.clearRect(0,0,canvas.width,canvas.height);draw.fillStyle='#e9a4d6';const stride=Math.max(1,Math.floor(samples.length/canvas.width));for(let x=0;x<canvas.width;x++){let peak=0;for(let i=x*stride;i<Math.min((x+1)*stride,samples.length);i++)peak=Math.max(peak,Math.abs(samples[i]));const height=Math.max(1,peak*canvas.height);draw.fillRect(x,(canvas.height-height)/2,1,height);}}finally{await ctx.close();}}
async function render(slot){
  if(controller)return;let selected;
  try{selected=JSON.parse($('config').value);}catch{status('The detailed settings contain invalid JSON.');return;}
  if(!$('text').value.trim()){status('Give Bambi something to say.');return;}
  const selectedEngine=engine(),selectedQuality=number('quality'),selectedExpressions=check('native-expressions'),selectedSeed=number('take-seed'),selectedMode=check('sentence-delivery')?'sentences':'clauses',engineLabel=providerInfo().label,qwenInstruct=$('qwen-instruct').value,qwenSeed=number('qwen-seed'),qwenBackend=$('qwen-backend').value,qwenDelivery=$('qwen-delivery').value,mossSeed=number('moss-seed');
  if(selectedEngine==='moss'&&(!Number.isInteger(mossSeed)||mossSeed<0||mossSeed>2147483647||$('text').value.length>1000)){status('Choose a valid integer take seed and up to 1000 characters of English text.');return;}
  if(selectedEngine==='supertonic3'&&(!Number.isInteger(selectedSeed)||selectedSeed<0||selectedSeed>2147483647)){status('Choose an integer take seed from 0 to 2147483647.');return;}
  if(selectedEngine==='qwen3'&&(!qwenInstruct.trim()||qwenInstruct.length>1200||!Number.isInteger(qwenSeed)||qwenSeed<0||qwenSeed>2147483647||$('text').value.length>600)){status('Qwen needs a voice description, a valid integer take seed and up to 600 characters of text.');return;}
  const selectedText=selectedEngine!=='supertonic3'||!selectedExpressions?$('text').value.replace(/<(?:laugh|breath|sigh)>/g,''):$('text').value;
  stop();const renderController=new AbortController();controller=renderController;$('cancel').hidden=false;for(const id of ['render-a','render-b'])$(id).disabled=true;status(`Rendering ${slot.toUpperCase()} locally on ${selectedEngine==='qwen3'?qwenBackend:'CPU'} …`);
  try{const response=await fetch('/api/voice-lab/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:selectedText,preset:selected.id,overrides:selected,provider:selectedEngine,...(selectedEngine==='supertonic3'?{steps:selectedQuality,seed:selectedSeed,phraseMode:selectedMode}:selectedEngine==='qwen3'?{instruct:qwenInstruct,seed:qwenSeed,backend:qwenBackend,phraseMode:qwenDelivery}:selectedEngine==='moss'?{seed:mossSeed,phraseMode:'passage'}:{})}),signal:renderController.signal});if(!response.ok){const error=await response.json();throw Error(error.error||`HTTP ${response.status}`);}const blob=await response.blob();renderController.signal.throwIfAborted();const url=URL.createObjectURL(blob);if(slots[slot])URL.revokeObjectURL(slots[slot].url);slots[slot]={url,config:selected,provider:selectedEngine,steps:selectedQuality,seed:selectedSeed,phraseMode:selectedMode,text:selectedText,expressions:selectedExpressions,instruct:qwenInstruct,qwenSeed,qwenBackend,qwenDelivery,mossSeed};const audio=$('audio-'+slot);audio.src=url;$('label-'+slot).textContent=`${engineLabel} / ${selected.voice}${selectedEngine==='supertonic3'?` / ${selectedQuality} steps / take ${selectedSeed} / ${selectedMode} / tags ${selectedExpressions?'on':'off'}`:selectedEngine==='qwen3'?` / take ${qwenSeed} / ${qwenBackend} / ${qwenDelivery}`:selectedEngine==='moss'?` / take ${mossSeed}`:''} / pitch ${selected.pitchSemitones}`;const duration=Number(response.headers.get('x-audio-duration')),seconds=Number(response.headers.get('x-render-seconds')),peak=Number(response.headers.get('x-audio-peak'));$('stats-'+slot).textContent=`${duration.toFixed(2)} s audio · ${seconds.toFixed(2)} s render · peak ${peak.toFixed(3)}`;const download=$('download-'+slot);download.href=url;download.hidden=false;await waveform(blob,slot);renderController.signal.throwIfAborted();try{await audio.play();status(`${slot.toUpperCase()} is ready. Adjust the settings for your next comparison.`);}catch{status(`${slot.toUpperCase()} is ready. Press play on the player.`);}}
  catch(error){status(error.name==='AbortError'?'Rendering canceled.':error.message);}finally{controller=null;$('cancel').hidden=true;for(const id of ['render-a','render-b'])$(id).disabled=false;}
}
$('render-a').onclick=()=>render('a');$('render-b').onclick=()=>render('b');$('cancel').onclick=()=>controller?.abort();$('stop').onclick=stop;
for(const audio of document.querySelectorAll('audio'))audio.addEventListener('play',()=>{for(const other of document.querySelectorAll('audio'))if(other!==audio)other.pause();});
$('calibration').onclick=()=>{$('text').value=catalog.calibrationText;};
for(const button of document.querySelectorAll('[data-pause]'))button.onclick=()=>{const input=$('text'),start=input.selectionStart,end=input.selectionEnd;input.setRangeText(` [pause:${button.dataset.pause}] `,start,end,'end');input.focus();};
for(const id of inputs)$(id).addEventListener('input',readControls);
$('preset').onchange=()=>{const voice=$('voice').value;config=structuredClone(catalog.presets[$('preset').value]);if(engine()!=='kokoro')config.voice=voice;fitProvider();setControls();};
$('provider').onchange=()=>{
 providerDrafts[activeProvider]={config:structuredClone(config),...deliveryDraft()};
 const draft=providerDrafts[engine()];if(draft){config=structuredClone(draft.config);restoreDelivery(draft);}
 else if(engine()==='qwen3'){config=structuredClone(catalog.presets.bambi_local_clean);config.voice='doll';config.pitchSemitones=0;config.processing.enabled=false;config.drone.enabled=false;config.noise.enabled=false;$('qwen-instruct').value=providerInfo().instructions.doll;}
 voiceOptions();fitProvider();$('preset').value=config.id;setControls();providerControls();
 activeProvider=engine();
};
$('voice').addEventListener('change',()=>{if(engine()==='qwen3'&&providerInfo().instructions[$('voice').value])$('qwen-instruct').value=providerInfo().instructions[$('voice').value];});
$('qwen-instruct').addEventListener('input',()=>{if(engine()==='qwen3'){config.voice='custom';$('voice').value='custom';syncEditor();}});
$('qwen-backend').onchange=providerControls;
$('qwen-audition-text').onclick=()=>{$('text').value=(attitudes[$('voice').value]??attitudes.doll).text.replace(/<(?:laugh|breath|sigh)>/g,'');status('Attitude text loaded. Your description controls Qwen’s delivery.');};
$('qwen-new-take').onclick=()=>{const seed=number('qwen-seed');if(!Number.isInteger(seed)||seed<0||seed>2147483647){status('Choose a valid integer take seed first.');return;}$('qwen-seed').value=String(seed===2147483647?0:seed+1);status('New Qwen take selected. Render B to compare it with A.');};
$('soft-bright').onclick=()=>{config.pitchSemitones=1.5;config.speed=.9;Object.assign(config.processing,{enabled:true,compressionRatio:1.3,eqHz:3200,eqDb:1,echoEnabled:false});config.layers.left_voice.enabled=false;config.layers.right_voice.enabled=false;config.drone.enabled=false;config.noise.enabled=false;setControls();status('A brighter starting point. Try pitches from +0.5 to +2 and compare the voices.');};
$('apply-attitude').onclick=()=>{
 const recipe=attitudes[$('attitude').value];
 config.pitchSemitones=recipe.pitch;config.speed=recipe.speed;config.timing.normal=recipe.pause;
 config.processing.enabled=false;config.layers.left_voice.enabled=false;config.layers.right_voice.enabled=false;config.drone.enabled=false;config.noise.enabled=false;
 $('sentence-delivery').checked=true;setControls();status('Sound recipe applied. Load its attitude text separately, then compare A and B.');
};
$('natural-baseline').onclick=()=>{
 config.pitchSemitones=0;config.speed=1.05;config.timing.normal=150;config.sampleRate=44100;
 config.processing.enabled=false;config.layers.left_voice.enabled=false;config.layers.right_voice.enabled=false;config.drone.enabled=false;config.noise.enabled=false;
 $('quality').value='10';$('take-seed').value='41';$('sentence-delivery').checked=true;$('native-expressions').checked=false;
 setControls();status('Natural baseline: pitch 0, tempo 1.05, 10 steps, 44.1 kHz, no effects or expression tags. Your text and voice are preserved.');
};
$('load-expression-test').onclick=()=>{
 const tag=$('expression-test').value;
 $('text').value=tag==='laugh'?'That little attitude is adorable <laugh> <laugh>!':tag==='sigh'?'<sigh> <sigh> Oh, darling, try again.':'<breath> <breath> Well, here we are.';
 $('native-expressions').checked=true;$('sentence-delivery').checked=true;
 status('Two tags in one sentence. Compare with tags unchecked using the same voice and seed; the model may ignore or speak them.');
};
$('audition-text').onclick=()=>{$('text').value=attitudes[$('attitude').value].text;status('Attitude text loaded. Your next render uses these words and native expression tags.');};
$('new-take').onclick=()=>{const seed=number('take-seed');if(!Number.isInteger(seed)||seed<0||seed>2147483647){status('Choose a valid integer take seed first.');return;}$('take-seed').value=String(seed===2147483647?0:seed+1);status('New take selected. Render B to compare it with A.');};
for(const button of document.querySelectorAll('[data-expression]'))button.onclick=()=>{const input=$('text');input.setRangeText(` <${button.dataset.expression}> `,input.selectionStart,input.selectionEnd,'end');input.focus();};
$('session-voice').onclick=async()=>{try{
 const response=await fetch('/api/preferences');if(!response.ok)throw Error('Session settings unavailable');const prefs=await response.json();
 if(engine()!=='kokoro')providerDrafts[engine()]={config:structuredClone(config),...deliveryDraft()};
 $('provider').value=prefs.voice?.startsWith('moss_')&&catalog.providers.moss?.voices.includes(prefs.voice)?'moss':'kokoro';voiceOptions();config=structuredClone(catalog.presets[prefs['audio-preset']]??catalog.presets.bambi_local_clean);
 const main=prefs.voice||config.voice,second=prefs.voice2,weight=Number(prefs['voice-mix']??.4);
 config.voice=second?`${main}:${1-weight} + ${second}:${weight}`:main;config.speed=Number(prefs.speed??config.speed);
 if(prefs['dual-voice']===true){config.pitchSemitones=-2;config.layers.left_voice.enabled=false;config.layers.right_voice.enabled=false;config.processing.echoEnabled=false;config.mix.main_voice=0;}
 config.drone.enabled=prefs['background-drone']===true;config.noise.enabled=prefs['background-noise']===true;
 for(const [preference,bus] of [['background-drone-db','drone'],['background-noise-db','noise']])if(prefs[preference]!==undefined)config.mix[bus]=Number(prefs[preference]);
 if(prefs['background-noise-type'])config.noise.type=prefs['background-noise-type'];
 fitProvider();$('preset').value=config.id;setControls();providerControls();activeProvider=engine();status('Your saved main session voice is loaded. Render A, then switch engine for B.');
 }catch(error){status(error.message);}};
$('apply-config').onclick=()=>{try{const parsed=JSON.parse($('config').value);if(!catalog.presets[parsed.id]||!parsed.processing||!parsed.layers)throw Error('Incomplete preset');config=parsed;setControls();status('Detailed settings applied. Values are checked when rendering.');}catch(error){status(error.message);}};
$('use-preset').onclick=async()=>{
 $('use-preset').disabled=true;
 try{
  if(providerInfo().labOnly||!['kokoro','moss'].includes(engine()))throw Error('This engine is currently a Voice Lab preview.');
  if($('config').value!==JSON.stringify(config,null,2))throw Error('Apply your detailed setting changes first.');
  const r=await fetch('/api/settings',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Profile unavailable');const previous=await r.json();
  const saved={...previous.settings,'audio-preset':config.id,voice:$('voice').value,voice2:$('voice2').value,'voice-mix':$('weight').value,speed:String(engine()==='moss'?1:config.speed)};
  status('Saving voice settings…');
  const write=await fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:previous.revision,settings:saved}),signal:AbortSignal.timeout(5000)});
  if(!write.ok)throw Error(write.status===409?'Settings changed in another window. Review your voice choices and save again.':'Voice settings were not saved. Your Lab choices are retained; try saving again.');
  const acknowledged=await write.json();if(acknowledged.profile!==previous.profile||acknowledged.revision<=previous.revision)throw Error('The settings save was not acknowledged. Review and save again.');
  status('Voice, blend, speed and preset saved. Reload the session page. Custom processing stays in the Lab.');
 }catch(error){status(error.message);}finally{$('use-preset').disabled=false;}
};
window.addEventListener('beforeunload',()=>{controller?.abort();for(const slot of Object.values(slots))if(slot)URL.revokeObjectURL(slot.url);});
async function init(){try{const response=await fetch('/api/voice-lab/catalog');catalog=await response.json();if(!response.ok)throw Error(catalog.error);for(const [id,preset] of Object.entries(catalog.presets)){const option=document.createElement('option');option.value=id;option.textContent=preset.label;$('preset').append(option);}catalog.providers??={kokoro:{label:'Kokoro',available:true,voices:catalog.voices,voiceBlending:true}};
$('provider').querySelector('option[value="supertonic3"]').disabled=!catalog.providers.supertonic3?.available;
if(!catalog.providers.supertonic3?.available)$('provider').querySelector('option[value="supertonic3"]').textContent='Supertonic 3 · not set up on this device';
const qwenOption=$('provider').querySelector('option[value="qwen3"]');qwenOption.disabled=!catalog.providers.qwen3?.available;if(qwenOption.disabled)qwenOption.textContent='Qwen VoiceDesign · not set up on this device';
const mossOption=$('provider').querySelector('option[value="moss"]');mossOption.disabled=!catalog.providers.moss?.available;if(mossOption.disabled)mossOption.textContent='MOSS · no reference installed';
$('provider').disabled=false;
voiceOptions();$('preset').value='bambi_local_clean';config=structuredClone(catalog.presets.bambi_local_clean);setControls();providerControls();$('text').value=catalog.calibrationText;const comparisons=await(await fetch('/api/voice-lab/comparison')).json();$('candidates').replaceChildren();if(!comparisons.candidates?.length)$('candidates').textContent='No comparison files yet. Run tools/voice_lab.py compare.';for(const candidate of comparisons.candidates||[]){const row=document.createElement('div');row.className='candidate';const title=document.createElement('div');title.className='row';const name=document.createElement('strong');name.textContent=candidate.voice;const stats=document.createElement('span');stats.textContent=`${candidate.durationSeconds.toFixed(1)} s / RTF ${candidate.realtimeFactor.toFixed(2)}`;title.append(name,stats);const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src='/api/voice-lab/comparison/'+encodeURIComponent(candidate.voice);audio.addEventListener('play',()=>{for(const other of document.querySelectorAll('audio'))if(other!==audio)other.pause();});row.append(title,audio);$('candidates').append(row);}}
catch(error){$('runtime').textContent='Local voice offline';status(error.message);for(const id of ['render-a','render-b','use-preset'])$(id).disabled=true;}}
async function loadTriggerSamples(){try{const response=await fetch('/sounds/manifest.json');if(!response.ok)throw Error('Sound files unavailable');const manifest=await response.json();$('trigger-samples').replaceChildren();for(const item of manifest.assets){const row=document.createElement('article'),title=document.createElement('strong'),description=document.createElement('p'),audio=document.createElement('audio'),download=document.createElement('a');title.textContent=item.label;description.className='hint';description.textContent=manifest.mappings.filter(mapping=>mapping.sound===item.id).map(mapping=>mapping.trigger).join(' · ')||(item.id==='snap'?'Before each spoken trigger':item.id==='beep'?'Legacy chat beep; unused in the current sequence':'Generated fallback sound');audio.controls=true;audio.preload='none';audio.src='/sounds/'+encodeURIComponent(item.file);audio.addEventListener('play',()=>{for(const other of document.querySelectorAll('audio'))if(other!==audio)other.pause();});download.href=audio.src;download.download=item.file;download.textContent='Download WAV';row.append(title,description,audio,download);$('trigger-samples').append(row);}}catch(error){$('trigger-samples').textContent=error.message;}}
void init();void loadTriggerSamples();

async function loadOriginalSamples(){try{const response=await fetch('/api/local-sounds/catalog');if(!response.ok)throw Error('Local catalog unavailable');const catalog=await response.json();const container=$('original-sounds-list');container.replaceChildren();if(!catalog.assets?.length){container.textContent='No private sound files imported yet.';return;}for(const item of catalog.assets){const row=document.createElement('article'),title=document.createElement('strong'),note=document.createElement('p');title.textContent=item.label;note.className='hint';row.append(title,note);if(item.status==='available'&&item.url){note.textContent=`${item.source} · ${item.start.toFixed(3)} s · ${item.duration.toFixed(2)} s · ${item.channels===2?'Stereo':'Mono'}`;const audio=document.createElement('audio'),download=document.createElement('a');audio.controls=true;audio.preload='none';audio.src=item.url;if(item.id.startsWith('moan'))audio.volume=.3;audio.addEventListener('play',()=>{for(const other of document.querySelectorAll('audio'))if(other!==audio)other.pause();});download.href=item.url;download.download=item.file;download.textContent='Download private WAV';row.append(audio,download);if(item.attribution){const attribution=document.createElement('p');attribution.className='hint';attribution.textContent=item.attribution;const link=document.createElement('a');link.href=item.sourceUrl;link.target='_blank';link.rel='noopener';link.textContent=' Source';attribution.append(link);row.append(attribution);}}else{note.textContent=item.id==='moan'?'No moan file yet. This step stays silent for now.':'File missing or unverified. Using a generated fallback where available.';}container.append(row);}}catch(error){$('original-sounds-list').textContent=error.message;}}
void loadOriginalSamples();
