// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,symlinkSync,writeFileSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {tsImport} from 'tsx/esm/api';
const {unfilteredLanguageDirection}=await tsImport('../packages/ai/language-style.ts',import.meta.url);

const root=fileURLToPath(new URL('../',import.meta.url)),fixture=mkdtempSync(join(tmpdir(),'bambi-regie-player-'));
const realTts=process.env.BAMBI_REGIE_REAL_TTS==='1';
const fullAcceptance=process.env.BAMBI_REGIE_ACCEPTANCE==='1';
const capturedReplay=process.env.BAMBI_REGIE_REPLAY;
if(fullAcceptance&&!realTts)throw Error('Full acceptance explicitly requires BAMBI_REGIE_REAL_TTS=1.');
const nativeBase=process.env.BAMBI_REGIE_NATIVE_URL??'http://127.0.0.1:8080';
if(new URL(nativeBase).protocol!=='http:'||!['127.0.0.1','localhost'].includes(new URL(nativeBase).hostname))throw Error('Native acceptance must remain loopback-only.');
const nativeHeaders=process.env.BAMBI_DESKTOP_ALPHA==='1'?{Authorization:'Bearer '+process.env.BAMBI_LLM_TOKEN}:{};
let actualModel,actualContext,realModelRequests=0;
if(fullAcceptance){
 const models=await(await fetch(nativeBase+'/v1/models',{headers:nativeHeaders})).json(),slots=await(await fetch(nativeBase+'/slots',{headers:nativeHeaders})).json();
 actualModel=models.data[0]?.id;actualContext=slots[0]?.n_ctx;
 if(!actualModel||!actualContext||slots.some(slot=>slot.is_processing))throw Error('An existing idle local model is required; no replacement or competition.');
}
const playful=process.env.BAMBI_REGIE_PLAYFUL==='1';
const experiences=process.env.BAMBI_REGIE_EXPERIENCES==='1';
const storyRegression=process.env.BAMBI_REGIE_STORY==='1';
const rehearsalRegression=process.env.BAMBI_REGIE_REHEARSAL==='1';
const preparationRegression=process.env.BAMBI_REGIE_PREPARATION==='1';
const fieldRegression=process.env.BAMBI_REGIE_FIELDS==='1'||preparationRegression;
const revealRegression=process.env.BAMBI_REGIE_REVEAL==='1'||rehearsalRegression||fieldRegression;
const focusedRegression=process.env.BAMBI_REGIE_FOCUSED==='1';
const breathingRegression=process.env.BAMBI_REGIE_BREATHING==='1'||focusedRegression;
const reportName=capturedReplay?'captured-replay-browser.json':fullAcceptance?'acceptance-browser.json':storyRegression?'story-player.json':preparationRegression?'preparation-correction-player.json':fieldRegression?'field-correction-player.json':rehearsalRegression?'rehearsal-player.json':revealRegression?(realTts?'reveal-real-tts.json':'reveal-player.json'):(focusedRegression?'focused-':'')+(breathingRegression?(realTts?'breathing-real-tts.json':'breathing-player.json'):experiences?'experiences-player.json':playful?(realTts?'playful-real-tts.json':'playful-player.json'):(realTts?'player-check-real-tts.json':'player-check.json'));
const ttsUrl=realTts?(process.env.BAMBI_TTS_URL??'http://127.0.0.1:8882'):null;
if(ttsUrl&&(new URL(ttsUrl).protocol!=='http:'||!['127.0.0.1','localhost'].includes(new URL(ttsUrl).hostname)))throw Error('Real speech qualification must remain loopback-only.');
const wav=Buffer.alloc(44+64000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(64000,40);
let counter=0,anchorRepairs=0,fieldCorrections=0;const plans=[],errors=[],trials=[],speechInputs=[],speechVoices=[],inferenceInputs=[],chatFrames=[];let logs='',browser,app,page,lastSceneRequest;
function proposal(c){
 const number=++counter,target=c.userContext.includes('phone')?'phone notifications':'unfinished work',changed=c.feedback.includes('space');
 if(revealRegression){
  const look={scene:'Soft Pink',motif:'heart',motifId:'home-heart',style:'orb',visualDensity:.4,motion:.2,ambient:.2,effects:0};
  const result={version:1,id:'reveal-'+number,strategy:'Let one connected thought reveal a home image at its measured words.',rationale:'The listener chose a connected image.',continuity:'Keep the heart as the same home image.',openThreads:[],sections:[{id:'reveal-section',purpose:'The heart is a quiet home.',actions:[{id:'show-heart',kind:'reveal',look,delivery:'guide',pauseAfterMs:300,text:'Watch the heart appear here, carrying that quiet space.',anchor:rehearsalRegression?'Watch the heart appear':'heart appear',before:{...look,motif:null,motifId:null,visualDensity:.05,ambient:.1},holdMs:1500}]}]};
  if(fieldRegression){result.sections[0].actions.unshift(preparationRegression?{id:'prepare-heart',kind:'breath',look,delivery:'guide',pauseAfterMs:300,preparation:'Inhale slowly, letting the warmth fill this quiet room.',inText:'In.',outText:'And out.',inMs:4000,outMs:4500,cycles:1}:{id:'prepare-heart',kind:'guide',look,delivery:'guide',pauseAfterMs:300,text:'Inhale slowly, letting the warmth fill this quiet room.'});result.sections[0].actions.at(-1).anchor='heart blooms';}
  plans.push({context:c,plan:result});return result;
 }
 if(storyRegression){
  const look={...(c.currentLook??{scene:c.pool.scenes[0],motif:'heart',motifId:c.story.associations[0]?.motifId??'story-heart',style:c.pool.styles[0]??null,effects:0}),visualDensity:.09,motion:.04,ambient:.05};
  const result={version:1,id:'adapt-'+number,strategy:'Respond to the actual request for more space.',rationale:'The listener changed direction.',continuity:'The same image remains.',openThreads:[],sections:[{id:'adapt',purpose:'Respond to the requested space.',actions:[{id:'space',kind:'guide',look,delivery:'guide',pauseAfterMs:500,text:'The familiar image can stay while the surrounding space becomes quieter.'}]}]};
  plans.push({context:c,plan:result});return result;
 }
 const id=c.knownMotifs[0]?.id??'familiar-heart';
 const look={scene:'Soft Pink',motif:'heart',motifId:id,style:'orb',visualDensity:.3,motion:c.pool.reducedMotion?0:.2,ambient:.2,effects:.2};
 const common={look,delivery:'guide',pauseAfterMs:200};
 if(breathingRegression){
  const scene={version:1,id:'breathing-'+number,strategy:'Follow one comfortable paced cycle, then return to the same ring.',rationale:'The listener chose guided breathing.',continuity:'Retain the quiet ring.',openThreads:[],resolution:null,sections:[{id:'one-cycle',purpose:'One comfortable cycle.',actions:[{...common,look:{...look,motif:'ring',style:'loop'},id:'spoken-pacing',kind:'guide',text:c.breathCyclesAlreadyCommitted?'The familiar ring stays steady.':'Breathe with me. In... and out. The familiar ring stays steady.'}]}]};
  if(focusedRegression)scene.sections[0].actions.push({...common,look:{...look,motif:'ring',style:'loop'},id:'inner-answer',kind:'reply',invitation:'Imagine your own answer.',text:'I feel steady within this familiar light.',previewMs:1000,responseMs:1800});
  plans.push({context:c,plan:scene});return scene;
 }
 if(experiences){
  const ownedLook={...look,motif:c.pool.motifs[0]??null,motifId:c.pool.motifs.length?id:null,style:c.pool.styles[0]??null,motion:c.pool.reducedMotion||!c.pool.visuals?0:.2,visualDensity:c.pool.visuals?.3:0,scene:c.pool.scenes[0]};
  const scene={version:1,id:'journey-'+number,strategy:'Develop the selected journey without waiting for real replies.',rationale:'Follow the owned creative brief and existing phase.',continuity:'Keep the established image.',openThreads:['Return to the established image.'],resolution:null,sections:[{id:'flowing',purpose:'Develop the chosen journey.',actions:[{...common,look:ownedLook,id:'introduce',kind:'guide',text:'A familiar image stays with this unfolding journey.'},{...common,look:ownedLook,id:'rest',kind:'hold',durationMs:1800}]}]};
  plans.push({context:c,plan:scene});return scene;
 }
 if(playful&&(c.interaction||c.feedback.startsWith('May I have'))){
  const pending=c.interaction,request=pending?.request??c.feedback,breathing=request.includes('breathing');
  const reward=pending?.reward??{kind:breathing?'breath':'scene',look:breathing?look:{...look,scene:'Spiral Focus',style:'infinity'}};
  const challengeId=pending?.challengeId??(breathing?'breathing-request':'infinity-request');
  const outcome=pending?(pending.timedOut||pending.response?.includes('continue')?'continue':pending.response?.includes('Please')?'grant':'retry'):null;
  const phrase=breathing?'Please guide my breathing. I am your eager little dreamer.':'Please show me infinity. I am your eager little dreamer.';
  const resolution=outcome?{challengeId,outcome,reason:outcome==='grant'?'The actual answer politely included the invited imaginary role.':outcome==='retry'?'The actual answer did not include the invited phrase.':'Continue the previous home-image journey.'}:null;
  const actions=outcome==='grant'?(breathing?[{...common,id:'earned-breath',kind:'breath',look:reward.look,preparation:'That was a sweet request. Breathe with me.',inText:'In.',outText:'And out.',inMs:4000,outMs:4000,cycles:1}]:[{...common,id:'earned-infinity',kind:'guide',look:reward.look,text:'That was a sweet request. Here is infinity.'},{...common,id:'enjoy-infinity',kind:'hold',look:reward.look,durationMs:6000}]):outcome==='continue'?[{...common,id:'resume-home',kind:'guide',text:'We can leave that game and return to our familiar heart.'}]:[{...common,id:'invite-request',kind:'challenge',challengeId,request,phrase,criterion:'Ask politely using the offered first-person imaginary role.',reward,maxAttempts:2,responseMs:12000,invitation:outcome==='retry'?'You can ask more sweetly. Say the whole sentence.':breathing?'I can guide your breathing. Ask sweetly and say you are my eager little dreamer.':'Infinity is possible. Ask sweetly and say you are my eager little dreamer.'}];
  const result={version:1,id:'playful-'+number,strategy:outcome==='grant'?'Grant the earned '+(breathing?'breathing':'infinity')+' scene.':outcome==='retry'?'Motivate one sweeter real request.':outcome==='continue'?'Resume the original familiar-heart journey.':'Negotiate the requested scene with a real listening moment.',rationale:'Respond to the actual words, not an imagined inner answer.',continuity:'The familiar home image remains the narrative anchor.',openThreads:['Recall the familiar home image.'],resolution,sections:[{id:'request-game',purpose:'A playful exchange about the desired scene.',actions}]};plans.push({context:c,plan:result});return result;
 }
 const guide={...common,id:'introduce',kind:'guide',text:changed?'Imagine room around the heart.':'Bambi, the heart feels like home.'};
 const reply={...common,id:'answer',kind:'reply',invitation:'Say this with me.',text:changed?'I have room to breathe.':target==='phone notifications'?'I can leave the phone here.':'I can leave the work here.',previewMs:1000,responseMs:1800};
 const actions=[guide,...(changed?[]:[{...common,id:'wipe',kind:'wipe',text:`Let the ${target} leave this imagined window.`,target:{label:target,source:'user',quote:target},wipeMs:2800}]),reply];
 const sections=[{id:'establish',purpose:'A heart retains the meaning of a quiet home.',actions}];
 if(!changed&&c.pool.triggers.some(t=>t.toUpperCase()==='BAMBI SLEEP'))sections.push({id:'withdraw',purpose:'Withdraw the picture and return to the same home.',actions:[{...common,id:'sleep',kind:'sleep_return',preparation:'Stay with that heart.',holdMs:800,returnText:'Open your eyes. The heart returns.'}]});
 sections.push({id:'recover',purpose:'Retain continuity while reducing the scene.',actions:[{...common,id:'rest',kind:'hold',look:{...look,visualDensity:.1,motion:0,effects:0,ambient:.1},durationMs:2200}]});
 const plan={version:1,id:'fixture-'+number,strategy:changed?'Change to spacious continuity after the explicit feedback.':`Prepare a home image, release ${target}, and return to the same image.`,rationale:changed?'The listener asked to stop wiping and use more space.':`The starting idea specifically names ${target}.`,continuity:'The same heart remains a familiar home image.',openThreads:['Recall the familiar home image.'],sections};plans.push({context:c,plan});return plan;
}
const stub=createServer(async(req,res)=>{
 try{
 const parts=[];for await(const part of req)parts.push(part);const b=JSON.parse(Buffer.concat(parts).toString()||'{}');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'Cydonia-24B-v4.3'}]}));return;}
 if(req.url==='/v1/audio/voices'){res.end(JSON.stringify({voices:['af_heart']}));return;}
 if(fullAcceptance&&['/v1/chat/completions','/apply-template','/tokenize'].includes(req.url)){
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  if(req.url==='/v1/chat/completions'){
   const slots=await(await fetch(nativeBase+'/slots',{signal:controller.signal,headers:nativeHeaders})).json(),models=await(await fetch(nativeBase+'/v1/models',{signal:controller.signal,headers:nativeHeaders})).json();
   if(slots.some(slot=>slot.is_processing||slot.n_ctx!==actualContext)||models.data[0]?.id!==actualModel)throw Error('Existing local model became busy or changed.');
   b.model=actualModel;realModelRequests++;
  }
  const response=await fetch(nativeBase+req.url,{method:'POST',headers:{'Content-Type':'application/json',...nativeHeaders},body:JSON.stringify(b),signal:controller.signal});
  res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')??'application/json');
  for await(const part of response.body)res.write(part);res.end();return;
 }
 if(req.url==='/apply-template'){res.end(JSON.stringify({prompt:JSON.stringify(b.messages)}));return;}
 if(req.url==='/tokenize'){res.end(JSON.stringify({tokens:Array(Math.ceil(b.content.length/4)).fill(1)}));return;}
 if(req.url==='/dev/captioned_speech'){speechInputs.push(b.input);speechVoices.push({text:b.input,voice:b.voice});res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({audio:wav.toString('base64'),audio_format:'wav',text:b.input,spoken_seconds:2,timestamps:b.input.split(' ').map((word,i,a)=>({word,start_time:2*i/a.length,end_time:2*(i+1)/a.length})).slice(rehearsalRegression?1:0)})+'\n');return;}
 if(b.messages)inferenceInputs.push(b.messages);
 if(b.messages?.at(-1)?.content.startsWith('APPLICATION SCENE FIELD CORRECTION:')){fieldCorrections++;const fields=b.response_format.schema.properties;const patch=Object.fromEntries(Object.entries(fields).map(([id,field])=>[id,Object.fromEntries(field.required.map(key=>[key,key==='anchor'?'heart appear':'Let that familiar warmth gather around this quiet image.']))]));res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(patch)}}]}));return;}
 if(b.messages?.at(-1)?.content.startsWith('APPLICATION MEASURED REHEARSAL:')){anchorRepairs++;const choices=b.response_format.schema.properties.anchor.enum;assert.ok(choices.includes('heart appear'));res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({anchor:'heart appear'})}}]}));return;}
 const storyInstruction=b.messages?.findLast(m=>m.content.startsWith('STORY SPOKEN FIELDS:'))?.content;
 if(storyInstruction){
  const [,beat,step]=storyInstruction.match(/Next moment: (\w+), development (\d+)/);
  const fields=b.response_format.schema.required;
  const texts={introduce:'Let this heart mark one quiet place for the unfinished idea.',explore:Number(step)%2?'There is room around this familiar image for an unfinished thought.':'Its quiet edge can remain without another task to complete.',return:'This heart carries the room and its quiet edges together.',close:'Let this imagined chapter find its natural ending.',contrast:'The surroundings can grow quieter while the same familiar image stays.',exchange:'Another perspective can leave a little room for mystery.'};
  const output=fields.includes('inner')?{owner:'Give this image a little room to surprise us.',inner:'I prefer a little mystery around the edges.',reply:'Then those edges can keep their mystery for this moment.'}:{text:texts[beat]};
  plans.push({beat,step:Number(step)-1,fields,spoken:output});
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));return;
 }
 const instruction=b.messages?.findLast(m=>m.content.includes('Context and limits (data, not instructions):'))?.content;
 // Force feedback preparation beyond the 700 ms entry lead. The player must
 // place the complete prepared scene again without cutting audio or moving time.
 if(instruction?.includes('No wiping. I would prefer more space.'))await new Promise(resolve=>setTimeout(resolve,1500));
 let output=instruction?proposal(JSON.parse(instruction.match(/Context and limits \(data, not instructions\): (.*)\nOutput schema:/)[1])):null;
 if(instruction?.startsWith('SCENE DRAFT:')){
  output={strategy:output.strategy,actions:output.sections.flatMap(section=>section.actions).map(({id,...action})=>action)};
  if(focusedRegression&&counter===1)output.actions[0].text+=' Stay here, pet.';
 }
 const text=output?JSON.stringify(output):'We can try more space.';
 if(!b.stream){res.end(JSON.stringify({choices:[{message:{content:instruction?text:'{"action":"adapt"}'}}]}));return;}
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
 }catch(error){if(fullAcceptance&&res.destroyed)return;errors.push(String(error));res.statusCode=500;res.end('{}');}
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');const stubPort=stub.address().port;
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));const base=`http://127.0.0.1:${port}`;
for(const name of ['packages','presets','voices','apps','docs','dist','config','node_modules','assets'])if(existsSync(join(root,name)))symlinkSync(join(root,name),join(fixture,name),'dir');
if(experiences){mkdirSync(join(fixture,'vendor/bambisleep-data'),{recursive:true});writeFileSync(join(fixture,'vendor/bambisleep-data/bambisleep_structured.json'),JSON.stringify({metadata:{source:'https://example.invalid/bambi-reference-fixture'},content:{files:{content:'Bambi Sleep files are listed in this synthetic reference fixture. This is controlled test evidence.'}}}));}
mkdirSync(join(fixture,'runtime'),{recursive:true});
if(fullAcceptance||capturedReplay){
 // Opted-in listening/replay may use the maintainer's already selected effects.
 if(existsSync(join(root,'runtime/imported-sounds')))symlinkSync(join(root,'runtime/imported-sounds'),join(fixture,'runtime/imported-sounds'),'dir');
}else{
 // Ordinary source checks must work without private recordings in a fresh clone.
 const sounds=join(fixture,'runtime/imported-sounds');mkdirSync(sounds);
 const assets=[['wiper','wipers.wav',5],['wiper_alt','wipers_alt.wav',5],['snap','finger_snap.wav',.1]].map(([id,file,duration])=>{
  const rate=44100,frames=Math.round(rate*duration),audio=Buffer.alloc(44+frames*2);
  audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(rate,24);audio.writeUInt32LE(rate*2,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(frames*2,40);
  for(let frame=0;frame<frames;frame++){
   const time=frame/rate,envelope=id==='snap'?Math.exp(-time*70):Math.sin(Math.PI*(time%.6)/.6)**4;
   audio.writeInt16LE(Math.round(7000*envelope*Math.sin(2*Math.PI*180*time)),44+frame*2);
  }
  writeFileSync(join(sounds,file),audio);
  return {id,file,status:'available',duration,channels:1,sha256:createHash('sha256').update(audio).digest('hex'),source:'Original synthetic regression fixture; no recording.'};
 });
 writeFileSync(join(sounds,'manifest.json'),JSON.stringify({version:1,assets}));
}
mkdirSync(join(fixture,'scripts'));writeFileSync(join(fixture,'scripts/llama-runtime.py'),'print("Isolated simulated native lifecycle")\n');writeFileSync(join(fixture,'package.json'),'{"type":"module"}');
writeFileSync(join(fixture,'bootstrap.mjs'),`import dgram from 'node:dgram';import {EventEmitter} from 'node:events';dgram.createSocket=()=>{const s=new EventEmitter();s.bind=(_p,_h,cb)=>cb?.();s.unref=()=>s;s.send=()=>{};s.close=()=>{};return s;};await import(process.argv[2]);`);
const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^BAMBI_|^OLLAMA_/.test(key)));
try{
 app=spawn(process.execPath,['--import','tsx','bootstrap.mjs',new URL('../apps/server/index.ts',import.meta.url).href],{cwd:fixture,env:{...inherited,BAMBI_PORT:String(port),BAMBI_DATABASE:':memory:',BAMBI_LLM_URL:`http://127.0.0.1:${stubPort}`,BAMBI_TTS_URL:ttsUrl??`http://127.0.0.1:${stubPort}`,...(realTts?{BAMBI_TTS_TOKEN_FILE:process.env.BAMBI_TTS_TOKEN_FILE??join(root,'runtime/tts-access.token'),...(fullAcceptance&&process.env.BAMBI_TTS_TOKEN?{BAMBI_TTS_TOKEN:process.env.BAMBI_TTS_TOKEN}:{})}:{}),BAMBI_CLOUD_URL:`http://127.0.0.1:${stubPort}`,BAMBI_CLOUD_MODEL:'Cydonia-24B-v4.3',BAMBI_CLOUD_CONTEXT:String(actualContext??32768),BAMBI_CLOUD_KIND:'llama.cpp',BAMBI_CLOUD_API_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});app.stdout.on('data',d=>logs+=d);app.stderr.on('data',d=>logs+=d);
 let ready=false;for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 assert.equal((await fetch(base+'/api/access',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({microphone:false,devices:false,modelDownloads:false,onlineMedia:false,cloudAI:true,localClock:false,approximateLocation:false,contextToCloud:false})})).status,200);
 browser=await chromium.launch({headless:true,...(fullAcceptance||capturedReplay?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{}),...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{})});
 page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',request=>{if(request.url()===base+'/api/director/scene'&&request.method()==='POST')lastSceneRequest=request.postDataJSON();});
 page.on('websocket',socket=>socket.on('framesent',frame=>{try{const data=JSON.parse(String(frame.payload));if(data.type==='chat')chatFrames.push(data);}catch{}}));
 mkdirSync(join(root,'runtime/modular-regie'),{recursive:true});
 await page.route('**/api/warm',route=>route.fulfill({json:{ok:true}}));
 await page.goto(base);await page.waitForFunction(()=>!!window.bambi&&document.getElementById('connection').textContent==='Connected locally'&&[...document.getElementById('model').options].some(o=>o.value==='cloud:cydonia-24b-v4.3'));
 if(capturedReplay){
  const output=process.env.BAMBI_REGIE_ACCEPTANCE_OUT??join(root,'runtime/modular-regie/captured-replay');mkdirSync(output,{recursive:true});
  const records=JSON.parse(readFileSync(join(capturedReplay,'scenes.json'),'utf8')),program=JSON.parse(readFileSync(join(capturedReplay,'program.json'),'utf8'));
  const payloads=records.flatMap(record=>JSON.parse(readFileSync(join(capturedReplay,record.sceneFile),'utf8')).payloads);
  const evidence=new Map(),samples=[];let renders=0,screens=0;
  await page.locator('[data-experience="guided"]').click();
  console.log('Preparing archived application replay.');
  page.on('request',request=>{if(request.url().endsWith('/api/director/scene')||request.url().endsWith('/api/events/render'))renders++;});
  await page.evaluate(async data=>{
   const b=window.bambi,engine=b.sessionEvents.hooks.audio();await engine.init();await engine.context.resume();
   engine.set('MASTER',.8);engine.set('AI_VOICE',.9);engine.set('main_voice',1);engine.set('drone',.12);engine.set('EFFECTS',0);
   await b.sessionEvents.prepare(data.program.durationMs,.55,new AbortController().signal,data.program,false,undefined,{payloads:data.payloads});
   const destination=engine.context.createMediaStreamDestination();engine.analyser.connect(destination);
   const recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000}),chunks=[];
   window.replayAudio=new Promise(resolve=>{recorder.onstop=async()=>{const bytes=new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));resolve(btoa(text));};});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};window.replayCapture={recorder,voices:[],audioStart:engine.context.currentTime,wallStart:performance.now()};
   const play=engine.playEventVoice.bind(engine);engine.playEventVoice=(...args)=>{window.replayCapture.voices.push({audioAt:args[1],durationMs:args[0].duration*1000,track:args[4]});return play(...args);};
   window.replayCapture.scheduling=[];
   const speak=b.sessionEvents.speak.bind(b.sessionEvents);b.sessionEvents.speak=(slot,atMs)=>{
    const before=window.replayCapture.voices.length;speak(slot,atMs);
    window.replayCapture.scheduling.push({slotId:slot.id,payloadId:slot.payloadId,scheduledAtMs:slot.atMs,invokedAtMs:atMs,latenessMs:atMs-slot.atMs,played:window.replayCapture.voices.length>before});
   };
   const visuals=b.sessionEvents.hooks.visuals();if(visuals)visuals.enabled=true;
   b.director.duration=data.program.durationMs/1000;b.director.unlimited=false;b.director.ready();
   recorder.start(5000);b.director.start();b.sessionEvents.start();
  },{program,payloads});
  console.log('Archived audio decoded; replay started.');
  let lastLog=0;const replayWallStart=Date.now();
  while(true){
   assert.ok(Date.now()-replayWallStart<program.durationMs+90000,'The replay clock must keep advancing');
   const row=await page.evaluate(()=>({at:window.bambi.clock.time,active:window.bambi.director.active,evidence:window.bambi.sessionEvents.outputEvidence,state:window.bambi.sessionEvents.snapshot?.state,failures:window.bambi.sessionEvents.sceneDiagnostics}));
   for(const item of row.evidence)evidence.set(item.occurrenceId,item);samples.push({...row,evidence:undefined});
   if(process.env.BAMBI_REGIE_CAPTURE_STAGES!=='0'&&row.at>=screens*60+10){await page.locator('#stage').screenshot({path:join(output,'stage-'+Math.floor(row.at)+'.png')});screens++;}
   if(row.at-lastLog>=30){lastLog=row.at;console.log(JSON.stringify({replaySeconds:Math.round(row.at),completed:evidence.size}));}
   if(row.at>=program.durationMs/1000||!row.active)break;
   await page.waitForTimeout(1000);
  }
  const capture=await page.evaluate(()=>{window.replayCapture.recorder.stop();return {voices:window.replayCapture.voices,scheduling:window.replayCapture.scheduling,elapsedAudioMs:(window.bambi.audio.context.currentTime-window.replayCapture.audioStart)*1000,elapsedWallMs:performance.now()-window.replayCapture.wallStart};});
  writeFileSync(join(output,'player-mix.webm'),Buffer.from(await page.evaluate(()=>window.replayAudio),'base64'));
  const complete=[...evidence.values()].filter(row=>row.elapsedMs>=row.durationMs),result={scope:'Continuous application playback of archived actual local-model/Kokoro PCM; no inference or synthesis in this replay. Synthetic feedback already included in source. Browser output estimates and analyser mix, no physical listening verdict.',source:capturedReplay,sourcePayloads:payloads.length,renders,complete:complete.length,evidence:[...evidence.values()],samples,capture,errors};
  writeFileSync(join(output,'report.json'),JSON.stringify(result,null,2));
  assert.equal(renders,0);assert.equal(capture.voices.length,payloads.length,'Every archived speech slot must reach WebAudio');assert.equal(complete.length,payloads.length,'Every archived spoken occurrence must complete');assert.ok(capture.elapsedAudioMs>=program.durationMs-1000);assert.deepEqual(errors,[]);
  trials.push({kind:'captured-full-replay',output,payloads:payloads.length,complete:complete.length,seconds:capture.elapsedAudioMs/1000});await page.evaluate(()=>window.bambi.hardStop());
 }else if(fullAcceptance){
  const output=process.env.BAMBI_REGIE_ACCEPTANCE_OUT??join(root,'runtime/modular-regie/acceptance-live');mkdirSync(output,{recursive:true});
  const responses=[],requests=[],samples=[],evidence=new Map(),screenTimes=[12,60,150,245,280,330,485,550];let nextScreen=0;
  page.on('response',async response=>{if(response.url()===base+'/api/director/scene'){
   try{const scene=await response.json(),index=responses.length;responses.push({index,status:response.status(),atMs:scene.atMs,endMs:scene.endMs,plan:scene.plan,error:scene.error});writeFileSync(join(output,'scene-'+index+'.json'),JSON.stringify(scene));}catch{}
  }});
  page.on('request',request=>{if(request.url()===base+'/api/director/scene')requests.push(request.postDataJSON());});
  await page.locator('[data-experience="guided"]').click();await page.locator('#session-journey').selectOption('pink-cinema');
  await page.evaluate(()=>{
   const values={'duration':'600','model':'cloud:cydonia-24b-v4.3','prompt-template':'bambi-companion','direction-intent':'Imagine leaving unfinished work outside a quiet room. Let the same heart develop its meaning.','master':'0.8','intensity':'55'};
   for(const[id,value]of Object.entries(values)){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
   for(const[id,checked]of Object.entries({'direction-inner-response':true,'triggers-enabled':false,'direction-playful-requests':false})){const input=document.getElementById(id);input.checked=checked;input.dispatchEvent(new Event('input',{bubbles:true}));}
   const original=window.bambi.clock.start.bind(window.bambi.clock);
   window.bambi.clock.start=()=>{
    const engine=window.bambi.audio,destination=engine.context.createMediaStreamDestination();engine.analyser.connect(destination);
    const recorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000}),chunks=[];
    window.acceptanceAudio=new Promise(resolve=>{recorder.onstop=async()=>{const bytes=new Uint8Array(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));resolve(btoa(text));};});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};window.acceptanceCapture={recorder,voices:[],wallStart:performance.now(),audioStart:engine.context.currentTime};
    const play=engine.playEventVoice.bind(engine);engine.playEventVoice=(...args)=>{window.acceptanceCapture.voices.push({audioAt:args[1],durationMs:args[0].duration*1000,track:args[4]});return play(...args);};
    recorder.start(5000);window.bambi.clock.start=original;return original();
   };
  });
  await page.evaluate(()=>window.bambi.startSession());
  assert.ok(await page.evaluate(()=>window.bambi.sessionEvents.active),'The real local preparation must start');
  let feedback=false;
  while(true){
   const sample=await page.evaluate(()=>({at:window.bambi.clock.time,active:window.bambi.director.active,memory:window.bambi.sessionEvents.regieMemory.context(),evidence:window.bambi.sessionEvents.outputEvidence,failures:window.bambi.sessionEvents.sceneDiagnostics,state:window.bambi.sessionEvents.snapshot?.state}));
   for(const row of sample.evidence)evidence.set(row.occurrenceId,row);samples.push({...sample,evidence:undefined});
   if(sample.at>=270&&!feedback){feedback=true;await page.evaluate(()=>window.bambi.ask('Keep the same image, but give the story more open space.'));}
   if(process.env.BAMBI_REGIE_CAPTURE_STAGES!=='0'&&nextScreen<screenTimes.length&&sample.at>=screenTimes[nextScreen]){await page.locator('#stage').screenshot({path:join(output,'stage-'+screenTimes[nextScreen++]+'.png')});}
   if(!sample.active)break;
   if(samples.length%20===0)console.log(JSON.stringify({acceptanceSeconds:Math.round(sample.at),completed:sample.memory.story.completed,failures:sample.failures.length}));
   assert.ok(sample.failures.length<8,'Repeated real-scene failures require repair before continuing qualification');
   await page.waitForTimeout(1000);
  }
  const capture=await page.evaluate(()=>{window.acceptanceCapture.recorder.stop();return {voices:window.acceptanceCapture.voices,elapsedWallMs:performance.now()-window.acceptanceCapture.wallStart,elapsedAudioMs:(window.bambi.audio.context.currentTime-window.acceptanceCapture.audioStart)*1000};});
  writeFileSync(join(output,'player-mix.webm'),Buffer.from(await page.evaluate(()=>window.acceptanceAudio),'base64'));
  const result={scope:'Actual local installed model through loopback compatibility adapter, real Kokoro and uninterrupted application clocks. Programmatic public user input at 270 seconds. Browser output-clock estimates and captured analyser mix; no physical listening verdict.',model:actualModel,feedback,requests,responses,samples,evidence:[...evidence.values()],capture,realModelRequests,errors};
  writeFileSync(join(output,'report.json'),JSON.stringify(result,null,2));
  assert.ok(capture.elapsedAudioMs>=599000,'The entire ten-minute output clock must run');
  assert.ok(samples.some(row=>row.memory.story.completed.close===1),'The closing must actually complete');
  assert.ok(samples.some(row=>row.memory.story.completed.adapt===1),'The actual input must reach a completed adaptation');
  assert.ok(samples.every(row=>row.memory.story.completed.introduce<=1),'No repeated introduction after actual feedback');
  assert.deepEqual(errors,[]);trials.push({kind:'full-local-acceptance',model:actualModel,seconds:capture.elapsedAudioMs/1000,evidenceCount:evidence.size,feedback,output});
 }else if(storyRegression){
  await page.locator('[data-experience="guided"]').click();
  await page.locator('#session-journey').selectOption('pink-cinema');
  await page.evaluate(()=>{
   const values={'duration':'600','model':'cloud:cydonia-24b-v4.3','prompt-template':'bambi-companion','direction-intent':'Leave unfinished work outside a quiet room.','master':'0'};
   for(const [id,value]of Object.entries(values)){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
   const input=document.getElementById('direction-inner-response');input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.evaluate(()=>window.bambi.startSession());
  await page.waitForFunction(()=>window.bambi.sessionEvents.regieMemory.context().story.completed.introduce===1);
  const intro=await page.evaluate(()=>({story:window.bambi.sessionEvents.regieMemory.context().story,evidence:window.bambi.sessionEvents.outputEvidence,program:window.bambi.sessionEvents.program}));
  assert.equal(intro.story.completed.introduce,1);assert.ok(intro.evidence.some(e=>e.history.includes('heart mark')));
  assert.ok(intro.program.events.some(e=>e.softReturn),'The reveal uses the measured staged event');
  await page.waitForFunction(()=>window.bambi.sessionEvents.regieMemory.context().story.completed.explore>=1);
  const future=await page.evaluate(()=>window.bambi.sessionEvents.regieMemory.context());
  assert.equal(future.story.completed.introduce,1);assert.equal(new Set([...future.knownMotifs,...future.committedMotifs].map(m=>m.id)).size,1);
  assert.equal(plans.filter(p=>p.beat==='introduce').length,1,'Prefetch does not repeat the introduction');
  // Move the owned transport into conditioning without claiming skipped output.
  // This fixture preserves memory deliberately; public Seek has its own reset contract.
  await page.evaluate(()=>{const e=window.bambi.sessionEvents;window.bambi.clock.seek(245);e.runtime.discardFuture(245000);e.regieMemory.invalidate();e.regieRetryAtMs=0;});
  await page.waitForFunction(()=>window.bambi.sessionEvents.regieMemory.context().story.completed.exchange>=1,{},{timeout:45000});
  const exchange=await page.evaluate(()=>({context:window.bambi.sessionEvents.regieMemory.context(),evidence:window.bambi.sessionEvents.outputEvidence}));
  assert.ok(exchange.evidence.some(e=>e.history==='I prefer a little mystery around the edges.'));
  const owner=speechVoices.find(v=>v.text==='Give this image a little room to surprise us.'),inner=speechVoices.find(v=>v.text==='I prefer a little mystery around the edges.');
  if(!realTts)assert.notEqual(owner?.voice,inner?.voice,'Imagined thought uses its own existing voice track');
  assert.ok(plans.some(p=>p.fields?.join(',')==='owner,inner,reply'));
  await page.evaluate(()=>window.bambi.ask('Keep the image, but give it more space.'));
  await page.waitForFunction(()=>window.bambi.sessionEvents.regieMemory.context().story.adaptedGeneration===window.bambi.sessionEvents.regieMemory.generation,{},{timeout:45000});
  const adapted=await page.evaluate(()=>window.bambi.sessionEvents.regieMemory.context());
  assert.ok(chatFrames.some(frame=>frame.text==='Keep the image, but give it more space.'),'The actual user input passes through the existing conversation path');
  assert.equal(adapted.feedback,'Keep the image, but give it more space.');
  assert.equal(adapted.story.completed.introduce,1);assert.equal(adapted.story.completed.adapt,1);assert.ok(plans.some(p=>p.plan?.id.startsWith('adapt-')));
  assert.deepEqual(adapted.story.presentation,{visualDensity:.09,motion:.04,ambient:.05});
  await page.evaluate(()=>{const e=window.bambi.sessionEvents;window.bambi.clock.seek(545);e.runtime.discardFuture(545000);e.regieMemory.invalidate();e.regieRetryAtMs=0;});
  await page.waitForFunction(()=>window.bambi.sessionEvents.regieMemory.context().story.completed.close===1,{},{timeout:45000});
  const closing=await page.evaluate(()=>({context:window.bambi.sessionEvents.regieMemory.context(),evidence:window.bambi.sessionEvents.outputEvidence}));
  assert.ok(closing.evidence.some(e=>e.history.includes('Open your eyes and notice the room around you.')));
  assert.equal(plans.filter(p=>p.beat==='close').length,1);assert.equal(closing.context.story.completed.introduce,1);
  assert.deepEqual(closing.context.story.presentation,{visualDensity:.09,motion:.04,ambient:.05});
  trials.push({kind:'connected-story',intro,future,exchange,adapted,closing,scope:'Actual WebAudio output evidence for played moments; explicit fixture transport jumps omit intermediate chapters. No claim of a continuous ten-minute playback.'});
  await page.evaluate(()=>window.bambi.hardStop());
 }else if(revealRegression){
  const preference=await fetch(base+'/api/memory/facts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'session motif',value:'I prefer the heart as a quiet home image.'})});
  assert.equal(preference.status,200);
  await page.evaluate(preparation=>{
   const values={'duration':'600','ai-mode':'voice','mode':'conversation','model':'cloud:cydonia-24b-v4.3','prompt-template':'custom','direction-intent':'Reveal a quiet home image in one connected thought.','direction-motifs':'heart','master':'0'};
   for(const [id,value]of Object.entries(values)){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
   for(const id of ['session-events','narration-enabled','direction-ai-regie','visuals-enabled']){const input=document.getElementById(id);input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));}
   if(preparation){const input=document.getElementById('direction-breathing');input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));}
   window.revealAudit=[];window.revealAuditRunning=true;
   const audit=()=>{if(!window.revealAuditRunning)return;const player=window.bambi.sessionEvents;if(player.active){const evidence=player.outputEvidence.at(-1);window.revealAudit.push({atMs:window.bambi.clock.time*1000,motifHidden:document.querySelector('.event-motif').hidden,evidence});}requestAnimationFrame(audit);};requestAnimationFrame(audit);
  },preparationRegression);
  await page.evaluate(()=>window.bambi.startSession());
  await page.waitForFunction(()=>{const event=window.bambi.sessionEvents.program?.events.find(e=>e.softReturn);return event&&window.bambi.sessionEvents.outputEvidence.some(p=>p.occurrenceId.startsWith(event.id+':speech')&&p.elapsedMs>=p.durationMs);});
  const result=await page.evaluate(()=>{window.revealAuditRunning=false;return {program:window.bambi.sessionEvents.program,audit:window.revealAudit,evidence:window.bambi.sessionEvents.outputEvidence};});
  const event=result.program.events.find(e=>e.softReturn),anchor=event.atMs+event.softReturn.steps[1].offsetMs;
  assert.ok(result.audit.some(row=>row.atMs<anchor-50&&row.motifHidden),'The motif stays absent before its measured anchor');
  assert.ok(result.audit.some(row=>row.atMs>anchor+100&&row.atMs<event.atMs+event.speech.targetMs&&!row.motifHidden),'The motif appears while the connected speech continues');
  assert.ok(inferenceInputs.some(messages=>messages.some(m=>m.content.includes('Confirmed preference for future sessions')&&m.content.includes('quiet home image'))));
  assert.ok(result.program.events.every(e=>!e.haptics.length),'Device-disabled browser receives no accents');
  assert.ok(plans.length>=2,'A second prepared scene exercises the entry boundary');
  assert.equal(plans[1].context.currentMotifMotion.startMs,event.softReturn.steps[1].state.motifMotion.startMs,'Preparation inherits the preceding motif phase at an exclusive event end');
  if(rehearsalRegression){assert.ok(anchorRepairs>0);assert.ok(Math.abs(event.softReturn.steps[1].offsetMs-2000*speechInputs[0].split(' ').indexOf('heart')/speechInputs[0].split(' ').length)<.001,'Repaired reveal retains the measured word onset within fractional-PCM precision');}
  if(fieldRegression){if(preparationRegression){const breaths=result.program.events.filter(e=>e.breath&&e.atMs<event.atMs);assert.equal(breaths.length,2,'Corrected preparation preserves exactly one cycle before the reveal');assert.deepEqual(breaths.map(e=>e.breath.durationMs),[4000,4500]);}assert.ok(fieldCorrections>0);assert.ok(speechInputs.every(text=>!/^inhale/i.test(text)),'Rejected pacing never reaches TTS');assert.ok(speechInputs.some(text=>text==='Let that familiar warmth gather around this quiet image.'));}
  const saved=await preference.json();
  assert.equal((await fetch(base+'/api/memory/facts/'+saved.id,{method:'DELETE'})).status,200);
  await page.waitForFunction(()=>!window.bambi.sessionEvents.active);
  assert.equal((await (await fetch(base+'/api/memory')).json()).facts.length,0);
  trials.push({kind:'word-bound-reveal',anchorRepairs,fieldCorrections,anchorMs:anchor,evidence:result.evidence,frames:result.audit.length});
 }else if(breathingRegression){
  await page.evaluate((focused)=>{
   const values={'duration':'600','ai-mode':'voice','mode':'conversation','model':'cloud:cydonia-24b-v4.3','prompt-template':focused?'bambi-companion':'custom','direction-intent':'One comfortable breathing cycle with a quiet ring.','direction-motifs':'ring','master':'0'};
   for(const [id,value]of Object.entries(values)){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}
   for(const id of ['session-events','narration-enabled','direction-ai-regie','direction-breathing','breath-visuals','breath-sound','visuals-enabled']){const input=document.getElementById(id);input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));}
   window.breathAudit=[];let previous='none';
   const audit=()=>{
    if(window.breathAuditDone)return;
    const layer=document.querySelector('[data-breath-layer]'),phase=layer&&!layer.hidden?layer.dataset.direction:'none';
    if(phase!==previous){window.breathAudit.push({phase,time:window.bambi.audio?.outputTime,breaths:window.bambi.audio?.scheduledBreaths.map(event=>({...event}))});previous=phase;}
    requestAnimationFrame(audit);
   };requestAnimationFrame(audit);
  },focusedRegression);
  await page.evaluate(()=>window.bambi.startSession());
  assert.ok(plans.some(item=>item.plan.sections[0].actions[0].kind==='guide'),'The fixture reproduces the incorrect model action');
  assert.ok(await page.evaluate(()=>window.bambi.sessionEvents.program.events.some(event=>event.breath)),'The admitted result contains measured breathing');
  if(focusedRegression){assert.ok(inferenceInputs.length>=2,'The deliberately bad address triggers the bounded plan retry');assert.ok(inferenceInputs.some(messages=>messages.some(message=>message.content.includes('BAMBI COMPANION'))));assert.ok(!speechInputs.some(text=>/\bpet\b/i.test(text)),'Rejected scene speech never reaches synthesis');}
  if(focusedRegression){const requests=inferenceInputs.filter(messages=>messages.some(message=>message.content.startsWith('SCENE DRAFT:')));assert.ok(requests.length>=2);assert.ok(requests.every(messages=>messages[0].content.includes(unfilteredLanguageDirection)),'Scene generation and its bounded retry always include language freedom without a UI flag');}
  if(focusedRegression&&!realTts){const owner=speechVoices.find(item=>item.text==='Imagine your own answer.'),inner=speechVoices.find(item=>item.text==='I feel steady within this familiar light.');assert.ok(owner&&inner,'Both scene roles reach synthesis');assert.notEqual(inner.voice,owner.voice,'The inner response uses a distinct synthesized voice');assert.equal(inner.voice,owner.voice==='af_bella'?'af_heart':'af_bella');}
  const frame=()=>page.evaluate(()=>({phase:document.querySelector('[data-breath-layer]').dataset.direction,label:document.querySelector('.breath-label').textContent,active:document.getElementById('stage').classList.contains('breathing'),canvas:getComputedStyle(document.getElementById('visual')).visibility,motif:getComputedStyle(document.querySelector('.event-motif')).visibility,time:window.bambi.audio.outputTime,breaths:window.bambi.audio.scheduledBreaths,evidence:window.bambi.sessionEvents.outputEvidence}));
  await page.waitForFunction(()=>!document.querySelector('[data-breath-layer]').hidden&&document.querySelector('[data-breath-layer]').dataset.direction==='in');
  const inhale=await frame();assert.equal(inhale.active,true);assert.equal(inhale.canvas,'hidden');assert.equal(inhale.motif,'hidden');assert.equal(inhale.label,'Breathe in');
  await page.locator('#stage').screenshot({path:join(root,'runtime/modular-regie/breathing-in.png')});
  await page.waitForFunction(()=>!document.querySelector('[data-breath-layer]').hidden&&document.querySelector('[data-breath-layer]').dataset.direction==='out');
  const exhale=await frame();assert.equal(exhale.canvas,'hidden');assert.equal(exhale.motif,'hidden');assert.equal(exhale.label,'Breathe out');
  await page.locator('#stage').screenshot({path:join(root,'runtime/modular-regie/breathing-out.png')});
  await page.waitForFunction(()=>document.querySelector('[data-breath-layer]').hidden&&window.bambi.sessionEvents.outputEvidence.some(event=>event.history==='The familiar ring stays steady.'));
  const returned=await frame();assert.equal(returned.active,false);assert.equal(returned.canvas,'visible');assert.equal(returned.motif,'visible');
  const audit=await page.evaluate(()=>{window.breathAuditDone=true;return window.breathAudit;});
  for(const phase of ['in','out']){
   const first=audit.find(frame=>frame.phase===phase),event=first?.breaths.findLast(event=>event.cue.direction===phase);
   assert.ok(event,'The display follows an actually scheduled breath');assert.ok(first.time>=event.time-.02&&first.time-event.time<.2,'Breath display follows the measured spoken onset on the output clock');
  }
  trials.push({kind:'paired-guide-breathing',inhale,exhale,returned,audit});
  await page.evaluate(()=>window.bambi.hardStop());
  assert.equal(await page.evaluate(()=>document.querySelector('[data-breath-layer]').hidden),true);
  const badRequest={...lastSceneRequest,requestId:crypto.randomUUID(),planningContext:{...lastSceneRequest.planningContext,pool:{...lastSceneRequest.planningContext.pool,triggers:['An unselected cue']}}};
  const rejected=await fetch(base+'/api/director/scene',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(badRequest)});
  assert.equal(rejected.status,422);
  const diagnostics=await(await fetch(base+'/api/diagnostics/scenes')).json(),failure=diagnostics.scenes.find(scene=>scene.id===badRequest.requestId);
  assert.equal(failure.status,'error');assert.match(failure.error,/outside the selected trigger pool/);assert.equal(failure.stages['model-ready'],undefined);
  assert.ok(diagnostics.scenes.some(scene=>scene.status==='done'&&scene.stages['audio-ready']!==undefined&&scene.stages.compiled!==undefined));
  trials.push({kind:'scene-failure-diagnostics',failure});
 }else if(experiences){
  await page.evaluate(()=>{document.getElementById('model').value='cloud:cydonia-24b-v4.3';document.getElementById('model').dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('[data-experience="conversation"]').click();
  await page.locator('#chat-output').selectOption('text');
  await page.locator('#conversation-topic').selectOption('style');
  const before=speechInputs.length;
  await page.evaluate(()=>window.bambi.ask('What should I wear for a casual evening?'));
  await page.waitForFunction(()=>document.getElementById('messages').querySelector('.assistant p')?.textContent.includes('We can try more space.'));
  assert.equal(speechInputs.length,before,'text-only chat never requests synthesis');
  assert.equal(await page.evaluate(()=>window.bambi.director.active),false,'text-only chat does not need a session start');
  assert.equal(chatFrames.at(-1).speak,false);assert.equal(chatFrames.at(-1).conversationTopic,'style');
  assert.ok(inferenceInputs.some(messages=>messages.some(m=>m.content.includes('For outfit and style ideas'))));
  await page.locator('#conversation-topic').selectOption('bambi');
  await page.evaluate(()=>window.bambi.ask('Can you explain the Bambi Sleep files?'));
  await page.waitForFunction(()=>document.querySelectorAll('#messages .assistant').length>=2&&document.querySelector('#messages .assistant:last-child p')?.textContent.includes('We can try more space.'));
  assert.equal(speechInputs.length,before);assert.equal(chatFrames.at(-1).conversationTopic,'bambi');
  assert.ok(inferenceInputs.some(messages=>messages.some(m=>m.content.includes('For Bambi Sleep topics'))));
  assert.ok(inferenceInputs.some(messages=>messages.some(m=>m.content.split(/\s+/).some(word=>word==='https://example.invalid/bambi-reference-fixture'))),'built-in characters receive relevant read-only evidence too');
  trials.push({kind:'text-only-topics',requests:chatFrames.map(({conversationTopic,speak})=>({conversationTopic,speak})),noSynthesis:true,noSessionStart:true});
  await page.locator('[data-experience="solo"]').click();
  assert.equal(await page.locator('#chat-input').isDisabled(),true);assert.equal(await page.locator('#mic').isDisabled(),true);
  assert.equal(await page.locator('#direction-playful-requests').isDisabled(),true);
  assert.equal(await page.locator('#direction-ai-regie').isChecked(),true);
  const choices=await page.locator('#session-journey option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(id=>id!=='custom'));
  assert.equal(choices.length,6);
  for(const journey of choices){
   await page.locator('#session-journey').selectOption(journey);
   await page.evaluate(()=>window.bambi.startSession());
   await page.waitForFunction(()=>window.bambi.sessionEvents.outputEvidence.some(e=>e.history.includes('unfolding journey.')));
   const context=plans.at(-1).context;
   assert.equal(context.journey,journey);assert.equal(context.participation,'uninterrupted');assert.equal(context.pool.playfulRequests,false);
   const requested=chatFrames.length;
   await page.evaluate(()=>window.bambi.ask('May I have the infinity spiral?'));
   assert.equal(chatFrames.length,requested);assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.interactionContext),null);
   assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.feedback('An ignored contribution.')),false);
   trials.push({kind:'uninterrupted-journey',journey,context,played:await page.evaluate(()=>window.bambi.sessionEvents.outputEvidence)});
   if(journey==='pink-cinema')await page.screenshot({path:join(root,'runtime/modular-regie/solo-pink-cinema.png')});
   await page.evaluate(()=>window.bambi.hardStop());
  }
  await page.reload();await page.waitForFunction(()=>window.bambi&&document.getElementById('session-interaction').value==='uninterrupted');
  assert.equal(await page.locator('#session-journey').inputValue(),'breath-and-glow');assert.equal(await page.locator('#mic').isDisabled(),true);
  // Import explicitly changes ownership. A subsequent AI-only choice must
  // clear that program rather than silently playing it as a generated journey.
  const importProgram={version:1,durationMs:1200000,baseline:{activeLayers:['drone'],foreground:null,density:{intensity:.3,effectDensity:0,speechDensity:0,audioDensity:.2,visualDensity:.1},visualState:'sparse',narrationState:'paused',ambientState:'reduced',scene:'Soft Pink'},motifs:[],events:[]};
  await page.locator('#session-flow-settings summary').click();
  await page.locator('#event-program-file').setInputFiles({name:'fixture-authored.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(importProgram))});
  await page.waitForFunction(()=>document.getElementById('direction-controls').disabled);
  assert.equal(await page.locator('#session-interaction').inputValue(),'interactive');
  await page.locator('[data-experience="solo"]').click();
  assert.equal(await page.locator('#direction-controls').isDisabled(),false);assert.equal(await page.locator('#event-program-file').inputValue(),'');
  assert.equal(await page.locator('#session-interaction').inputValue(),'uninterrupted');
  await page.locator('[data-experience="guided"]').click();
  assert.equal(await page.locator('#chat-input').isDisabled(),false);assert.equal(await page.locator('#mic').isDisabled(),false);
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-experience="solo"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(root,'runtime/modular-regie/solo-mobile.png')});
  trials.push({kind:'restored-preferences-and-mobile',inputRestores:true,noOverflow:true,authoredOwnershipCleared:true});
 }else if(playful){
  await page.evaluate(()=>{
   const values={'duration':'900','ai-mode':'voice','mode':'conversation','model':'cloud:cydonia-24b-v4.3','prompt-template':'custom','direction-intent':'I keep thinking about unfinished work.','direction-motifs':'heart'};
   for(const [id,value]of Object.entries(values)){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));}
   for(const id of ['session-events','narration-enabled','direction-ai-regie','direction-playful-requests','direction-breathing','breath-visuals','breath-sound']){const n=document.getElementById(id);n.checked=true;n.dispatchEvent(new Event('input',{bubbles:true}));}
  });
  await page.evaluate(()=>window.bambi.startSession());
  const awaitInvitation=async()=>{
   await page.waitForFunction(()=>!!window.bambi.sessionEvents.interactionContext&&!document.querySelector('.response-prompt').hidden&&!window.bambi.sessionEvents.voiceBusy);
   const state=await page.evaluate(()=>({context:window.bambi.sessionEvents.interactionContext,prompt:document.querySelector('.response-prompt').textContent,protected:window.bambi.sessionEvents.listenerResponseAt(window.bambi.clock.time*1000),time:window.bambi.clock.time}));
   assert.equal(state.protected,false,'the real answer must be heard rather than suppressed');assert.equal(state.prompt,state.context.phrase.toUpperCase());return state;
  };
  await page.evaluate(()=>window.bambi.ask('May I have the infinity spiral?'));
  const first=await awaitInvitation();assert.equal(first.context.attempt,1);
  assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.program.events.some(e=>e.state.spiralStyle==='infinity')),false,'reward cannot appear before the real reply');
  await page.evaluate(()=>window.bambi.ask('Infinity.'));
  await page.waitForFunction(()=>window.bambi.sessionEvents.interactionContext?.attempt===2);
  const retry=await awaitInvitation();assert.equal(retry.context.attempt,2);
  await page.evaluate(phrase=>window.bambi.ask(phrase),retry.context.phrase);
  await page.waitForFunction(()=>window.bambi.sessionEvents.outputEvidence.some(e=>e.history.includes('Here is infinity.'))&&window.bambi.visuals.stableSettings.style==='infinity');
  const grant=await page.evaluate(()=>({plans:window.bambi.sessionEvents.scenePlans,style:window.bambi.visuals.stableSettings.style,evidence:window.bambi.sessionEvents.outputEvidence}));
  trials.push({kind:'retry-and-grant',first,retry,grant});
  await page.screenshot({path:join(root,'runtime/modular-regie',realTts?'playful-real-infinity.png':'playful-infinity.png')});
  await page.evaluate(()=>window.bambi.ask('May I have a breathing scene?'));
  const breathRequest=await awaitInvitation();await page.evaluate(phrase=>window.bambi.ask(phrase),breathRequest.context.phrase);
  await page.waitForFunction(()=>document.querySelector('[data-breath-layer]').dataset.direction==='in'&&!document.querySelector('[data-breath-layer]').hidden);
  const breathIn=await page.evaluate(()=>({breaths:window.bambi.audio.scheduledBreaths,phase:document.querySelector('[data-breath-layer]').dataset.direction}));
  await page.waitForFunction(()=>document.querySelector('[data-breath-layer]').dataset.direction==='out'&&!document.querySelector('[data-breath-layer]').hidden);
  const breathOut=await page.evaluate(()=>({breaths:window.bambi.audio.scheduledBreaths,phase:document.querySelector('[data-breath-layer]').dataset.direction}));
  trials.push({kind:'breathing-reward',breathRequest,breathIn,breathOut});
  await page.evaluate(()=>window.bambi.ask('May I have the infinity spiral?'));
  const declined=await awaitInvitation();await page.evaluate(()=>window.bambi.ask('No, continue the planned journey.'));
  await page.waitForFunction(()=>window.bambi.sessionEvents.outputEvidence.some(e=>e.history.includes('return to our familiar heart.')));
  trials.push({kind:'continue-without-reward',declined,played:await page.evaluate(()=>window.bambi.sessionEvents.outputEvidence)});
  await page.evaluate(()=>window.bambi.ask('May I have the infinity spiral?'));
  const silent=await awaitInvitation();
  await page.waitForFunction(afterMs=>window.bambi.sessionEvents.outputEvidence.some(e=>e.sessionStartMs>afterMs&&e.history.includes('return to our familiar heart.')),silent.time*1000);
  assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.interactionContext),null);
  trials.push({kind:'silence-continues',silent,played:await page.evaluate(()=>window.bambi.sessionEvents.outputEvidence)});
  await page.evaluate(()=>window.bambi.ask('May I have the infinity spiral?'));
  await awaitInvitation();
  await page.evaluate(()=>window.bambi.hardStop());assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.interactionContext),null);
  assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.active),false);trials.push({kind:'stop-during-listening'});
 }else for(const intent of ['I keep thinking about unfinished work.','My phone notifications keep pulling my attention.']){
  await page.evaluate(intent=>{
   window.bambi.hardStop();
   const values={'duration':'300','ai-mode':'voice','mode':'conversation','model':'cloud:cydonia-24b-v4.3','prompt-template':'custom','direction-intent':intent,'direction-motifs':'heart','trigger-wiper-variant':'wiper_alt','trigger-selection':JSON.stringify(['BAMBI','BAMBI SLEEP'])};
   for(const [id,value]of Object.entries(values)){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));}
   for(const [id,checked]of Object.entries({'session-events':true,'narration-enabled':true,'direction-ai-regie':true,'direction-inner-response':true,'triggers-enabled':true,'trigger-sound':true,'trigger-snap':true,'trigger-extra-effects':true,'trigger-timing-enabled':false})){const n=document.getElementById(id);n.checked=checked;n.dispatchEvent(new Event('input',{bubbles:true}));}
  },intent);
  const soundOffset=await page.evaluate(()=>window.bambi.audio?.scheduledSounds.length??0);
  await page.evaluate(()=>window.bambi.startSession());
  if(!await page.evaluate(()=>window.bambi.sessionEvents.active))throw Error('Player did not start: '+JSON.stringify(await page.evaluate(()=>({status:document.getElementById('ai-status').textContent,body:document.body.innerText.slice(-3000),model:document.getElementById('model').value,mode:document.getElementById('mode').value,director:window.bambi.director.active,events:document.getElementById('session-events').checked,regie:document.getElementById('direction-ai-regie').checked}))));
  const first=await page.evaluate(()=>({plan:window.bambi.sessionEvents.scenePlans[0],program:window.bambi.sessionEvents.program}));
  assert.equal(plans.find(item=>item.plan.id===first.plan.id).plan.sections[0].actions[0].text,'Bambi, the heart feels like home.','A name remains valid even with the standalone Bambi trigger selected');
  assert.ok(first.program.responsePrompts.length);assert.ok(first.program.events.some(e=>e.wipe?.text=== (intent.includes('phone')?'phone notifications':'unfinished work')));
  await page.waitForFunction(()=>!document.querySelector('.response-prompt').hidden);
  const preview=await page.evaluate(()=>({text:document.querySelector('.response-prompt').textContent,time:window.bambi.clock.time*1000,protected:window.bambi.sessionEvents.listenerResponseAt(window.bambi.clock.time*1000),voice:window.bambi.sessionEvents.voiceBusy}));
  assert.equal(preview.protected,true);assert.equal(preview.voice,false);assert.equal(preview.text,intent.includes('phone')?'I CAN LEAVE THE PHONE HERE.':'I CAN LEAVE THE WORK HERE.');
  mkdirSync(join(root,'runtime/modular-regie'),{recursive:true});
  const visualPrefix=(realTts?'real-':'fixture-')+(intent.includes('phone')?'phone':'work');
  await page.screenshot({path:join(root,'runtime/modular-regie',visualPrefix+'-preview.png')});
  try{await page.waitForFunction(offset=>window.bambi.audio.scheduledSounds.slice(offset).some(s=>s.kind==='snap'),soundOffset);}catch(error){throw Error('Snap playback missing: '+JSON.stringify(await page.evaluate(()=>({time:window.bambi.clock.time,snapshot:window.bambi.sessionEvents.snapshot,sounds:window.bambi.audio.scheduledSounds,plans:window.bambi.sessionEvents.scenePlans,events:window.bambi.sessionEvents.program.events.filter(e=>e.speech.requiredTrigger),status:document.body.innerText.slice(0,900),evidence:window.bambi.sessionEvents.outputEvidence}))));}
  await page.waitForFunction(()=>!document.querySelector('.event-black').hidden);
  const blackout=await page.evaluate(cueId=>({atMs:window.bambi.clock.time*1000,spoken:window.bambi.sessionEvents.outputEvidence.find(e=>e.occurrenceId.startsWith(cueId+':speech:'))}),first.program.events.find(e=>e.speech.requiredTrigger).id);
  const sounds=await page.evaluate(offset=>window.bambi.audio.scheduledSounds.slice(offset),soundOffset);assert.ok(sounds.some(s=>s.kind==='wiper'&&s.source==='local'&&s.assetId==='wiper_alt'));assert.ok(sounds.some(s=>s.kind==='snap'&&s.source==='local'));
  const cue=first.program.events.find(e=>e.speech.requiredTrigger);
  assert.ok(blackout.spoken);assert.ok(Math.abs(sounds.find(s=>s.kind==='snap').time-(blackout.spoken.audioStartSeconds+(cue.speech.triggerAtMs-250)/1000))<.03);
  await page.screenshot({path:join(root,'runtime/modular-regie',visualPrefix+'-black.png')});
  await page.waitForFunction(()=>window.bambi.sessionEvents.outputEvidence.some(e=>e.history.startsWith('Open your eyes.'))&&document.querySelector('.event-black').hidden);
  const returned=await page.evaluate(()=>({spoken:window.bambi.sessionEvents.outputEvidence.find(e=>e.history.startsWith('Open your eyes.')),eyeOpening:document.querySelector('[data-trigger-layer="eye"]').dataset.opening,eyeDisplay:document.querySelector('[data-trigger-layer="eye"]').style.display,canvasVisible:document.getElementById('visual').style.visibility}));
  assert.equal(returned.eyeDisplay,'none','the legacy eye overlay must not outlive the planned sleep');
  assert.equal(returned.eyeOpening,'1');
  assert.notEqual(returned.canvasVisible,'hidden');
  await page.screenshot({path:join(root,'runtime/modular-regie',visualPrefix+'-return.png')});
  trials.push({intent,firstPlan:first.plan,preview,blackout,returned,sounds:sounds.filter(s=>['wiper','snap'].includes(s.kind))});
  await page.evaluate(()=>window.bambi.ask('No wiping. I would prefer more space.'));
  await page.waitForFunction(async()=>{const {replies}=await(await fetch('/api/diagnostics/replies')).json();return replies.at(-1)?.stages['playback-start']!==undefined;});
  assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.scenePlans.some(p=>p.strategy.includes('spacious'))),false,'Direct correction response starts before preparing a replacement scene');
  const direct=await(await fetch(base+'/api/diagnostics/replies')).json();trials.at(-1).directReply=direct.replies.at(-1);
  await page.waitForFunction(()=>window.bambi.sessionEvents.scenePlans.some(p=>p.strategy.includes('spacious')));
  const revised=await page.evaluate(()=>window.bambi.sessionEvents.scenePlans.find(p=>p.strategy.includes('spacious')));assert.notEqual(revised.strategy,first.plan.strategy);trials.at(-1).revisedPlan=revised;
  await page.waitForFunction(()=>window.bambi.sessionEvents.outputEvidence.some(e=>e.history.startsWith('Imagine room around the heart.')));
  trials.at(-1).revisedOutput=await page.evaluate(()=>window.bambi.sessionEvents.outputEvidence.find(e=>e.history.startsWith('Imagine room around the heart.')));
  assert.equal(await page.evaluate(fromMs=>window.bambi.sessionEvents.program.events.some(e=>e.atMs>=fromMs&&e.wipe),revised.fromMs),false,'the revised future actually plays without wiping');
  await page.evaluate(()=>window.bambi.hardStop());assert.equal(await page.evaluate(()=>window.bambi.sessionEvents.active),false);
 }
 assert.deepEqual(errors,[]);mkdirSync(join(root,'runtime/modular-regie'),{recursive:true});const report={scope:fullAcceptance?'Actual ten-minute local model/Kokoro acceptance; isolated application state and no physical listening verdict.':'Actual application/server/player, isolated native lifecycle, structured model fixture, '+(realTts?'real existing offline Kokoro CPU synthesis':'silent WAV synthesis')+'; synthetic local effect fixtures. No shared runner access or real-model quality claim.',trials,modelPlans:plans.length,errors};writeFileSync(join(root,'runtime/modular-regie',reportName),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){mkdirSync(join(root,'runtime/modular-regie'),{recursive:true});const player=await page?.evaluate(()=>({time:window.bambi?.clock.time,plans:window.bambi?.sessionEvents.scenePlans,program:window.bambi?.sessionEvents.program,evidence:window.bambi?.sessionEvents.outputEvidence,breaths:window.bambi?.audio?.scheduledBreaths,context:window.bambi?.sessionEvents.interactionContext,breathAudit:window.breathAudit,sceneDiagnostics:window.bambi?.sessionEvents.sceneDiagnostics,breathing:document.querySelector('[data-breath-layer]')?.outerHTML,body:document.body.innerText.slice(-1800)})).catch(()=>null);writeFileSync(join(root,'runtime/modular-regie',reportName),JSON.stringify({ok:false,error:String(error),errors,plans,trials,player,serverLog:logs.slice(-12000)},null,2));throw error;}
finally{await browser?.close();if(app){app.kill('SIGTERM');await Promise.race([once(app,'exit'),new Promise(r=>setTimeout(r,3000))]);if(app.exitCode===null)app.kill('SIGKILL');}stub.closeAllConnections();await new Promise(r=>stub.close(r));rmSync(fixture,{recursive:true,force:true});}
