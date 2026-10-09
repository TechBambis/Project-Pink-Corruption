// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {macNativeReport} from './desktop-macos-support.mjs';
import {downloadPinned,inventory,hashFile} from './desktop-windows-support.mjs';

if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Native Apple Silicon is required.');
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));process.chdir(root);
if(process.argv.length!==3)throw Error('Select the received app backend directory.');
const output=resolve(process.env.BAMBI_MACOS_RUNTIME_OUTPUT||'.runtime/macos-runtime-evidence');mkdirSync(output,{recursive:true});
const temporary=mkdtempSync(join(realpathSync(tmpdir()),'Bambi ü speech '));
const backend=realpathSync(resolve(process.argv[2])),data=join(temporary,'Private fixture data'),models=join(data,'models');
const local=relative(root,backend);assert(local.startsWith('..')||isAbsolute(local),'Use the received runtime outside the checkout.');
for(const path of [data,models])mkdirSync(path,{recursive:true});
const manifest=JSON.parse(readFileSync(join(backend,'config/desktop-alpha-models.json'),'utf8'));
const evidence={testedAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,gitSha:process.env.GITHUB_SHA||null,checks:[],measurements:{},conditions:{runner:process.env.RUNNER_NAME||null,os:execFileSync('/usr/bin/sw_vers',[],{encoding:'utf8'}).trim(),cpuCount:(await import('node:os')).cpus().length,memoryBytes:(await import('node:os')).totalmem(),externalRuntimePath:false,physicalMicrophone:false,physicalListening:false,fullChatModel:false,gpuOffloading:false},limitations:['Speech uses a public synthetic sentence, not physical microphone or listening evidence.','The unchanged full 9B model, full prompt conversation, GPU offload and physical Apple Silicon hardware are separate required gates.','This runtime slice does not certify the physical installation and audio devices.']};
const save=()=>writeFileSync(join(output,'MACOS-NATIVE-SPEECH-CHECK.json'),JSON.stringify(evidence,null,2)+'\n');
const record=(name,detail={})=>{evidence.checks.push({name,...detail});save();console.log('PASS',name);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const children=new Set();
const watchdog=setTimeout(()=>{
 evidence.result='failed';evidence.failure='Received native Mac checks exceeded seven minutes.';save();
 for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 setTimeout(()=>process.exit(1),2000);
},7*60*1000);
const env={};for(const key of ['HOME','USER','LANG','LC_ALL','LC_CTYPE'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{PATH:'',TMPDIR:temporary,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',BAMBI_RESOURCE_ROOT:backend,BAMBI_DATA_ROOT:data,BAMBI_MODELS_ROOT:models,BAMBI_DESKTOP_ALPHA:'1',BAMBI_TTS_THREADS:'2',BAMBI_INSTANCE_TOKEN:randomBytes(32).toString('hex'),BAMBI_TTS_TOKEN:randomBytes(32).toString('hex')});
function launch(executable,args,environment=env){
 const child=spawn(executable,args,{cwd:data,env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});children.add(child);
 let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-12000);});
 // Drain service stdout too. Only this public synthetic fixture is retained.
 child.stdout.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-12000);});
 child.on('error',error=>{child.launchError=String(error);});child.diagnostics=()=>diagnostics;return child;
}
async function stop(child){
 if(child.exitCode!==null||child.signalCode!==null)return;
 const exited=new Promise(r=>child.once('exit',r));child.kill();
 await Promise.race([exited,delay(5000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await Promise.race([exited,delay(2000)]);}assert(child.exitCode!==null||child.signalCode!==null,'Owned slice service survived termination');
}
async function port(){return await new Promise((accept,reject)=>{const socket=createServer();socket.on('error',reject);socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>accept(value));});});}
async function waitReady(child,url){
 const started=performance.now();while(performance.now()-started<90000){
  if(child.launchError||child.exitCode!==null||child.signalCode!==null)throw Error('Frozen speech failed to start: '+(child.launchError||child.diagnostics()));
  try{const response=await fetch(url,{headers:{'X-Bambi-TTS-Token':env.BAMBI_TTS_TOKEN},signal:AbortSignal.timeout(1500)});if(response.ok)return {value:await response.json(),ms:performance.now()-started};}catch{}
  await delay(150);
 }throw Error('Frozen speech preparation exceeded 90 seconds.');
}
function pcm(wav){
 assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
 let format,samples;for(let offset=12;offset+8<=wav.length;){const name=wav.toString('ascii',offset,offset+4),length=wav.readUInt32LE(offset+4),start=offset+8;assert(start+length<=wav.length);if(name==='fmt ')format={encoding:wav.readUInt16LE(start),channels:wav.readUInt16LE(start+2),rate:wav.readUInt32LE(start+4),bits:wav.readUInt16LE(start+14)};if(name==='data')samples=wav.subarray(start,start+length);offset=start+length+(length%2);}
 assert(format&&samples);assert.equal(format.encoding,1);assert.equal(format.bits,16);
 const frames=samples.length/(2*format.channels),mono=new Float32Array(frames);let peak=0;
 for(let i=0;i<frames;i++){for(let channel=0;channel<format.channels;channel++)mono[i]+=samples.readInt16LE((i*format.channels+channel)*2)/32768/format.channels;peak=Math.max(peak,Math.abs(mono[i]));}
 assert(peak>.001);const converted=new Float32Array(Math.floor(frames*16000/format.rate)+32000);
 for(let i=0;i<converted.length-32000;i++){const index=i*format.rate/16000,low=Math.floor(index),fraction=index-low;converted[i+16000]=mono[low]*(1-fraction)+(mono[Math.min(low+1,frames-1)]||0)*fraction;}
 return {samples:converted,peak,seconds:frames/format.rate,format};
}
function messages(child){
 const queue=[],waiting=[];let failure;
 const lines=createInterface({input:child.stdout});
 lines.on('line',line=>{try{const value=JSON.parse(line);if(waiting.length)waiting.shift().accept(value);else queue.push(value);}catch{failure=Error('Unexpected non-protocol worker output.');for(const item of waiting.splice(0))item.reject(failure);}});
 child.once('exit',()=>{failure=Error('Streaming worker exited: '+child.diagnostics());for(const item of waiting.splice(0))item.reject(failure);});
 return async function next(timeout=30000){
  if(queue.length)return queue.shift();if(failure)throw failure;
  return await new Promise((accept,reject)=>{const item={accept:value=>{clearTimeout(timer);accept(value);},reject:error=>{clearTimeout(timer);reject(error);}};const timer=setTimeout(()=>{const index=waiting.indexOf(item);if(index>=0)waiting.splice(index,1);reject(Error('Streaming protocol timed out.'));},timeout);waiting.push(item);});
 };
}
try{
 const runtime=JSON.parse(readFileSync(join(dirname(backend),'notices/RUNTIME-MANIFEST.json'),'utf8'));
 assert.equal(runtime.phase,'alpha');assert.equal(runtime.platform,'darwin');assert.equal(runtime.architecture,'arm64');
 evidence.build=runtime.native.speech;
 record('received-native-speech-and-LLM-runtime',{version:runtime.version,sourceDigest:runtime.sourceDigest,...evidence.build});
 const imports=macNativeReport(join(backend,'native'));assert.deepEqual(imports.unresolved,[],'Native Mac dependency closure differs');
 record('native-arm64-system-or-bundled-dependencies',{libraries:imports.entries.length});
 const llama=join(backend,'native/llama/llama-server');
 const options=execFileSync(llama,['--help'],{env,cwd:data,encoding:'utf8',timeout:60000,maxBuffer:4*1024**2});
 const required=['--ctx-size','--parallel','--ctx-checkpoints','--checkpoint-min-step','--cache-ram','--gpu-layers','--flash-attn','--jinja','--reasoning','--no-webui','--cache-type-k','--cache-type-v','--api-key','--alias','--device','--list-devices','--fit','--fit-ctx','--fit-target'];
 for(const option of required)assert(options.includes(option),'Native llama lacks required option '+option);
 record('relocated-native-llama-loader-and-required-options',{sha256:await hashFile(llama),options:required,modelLoaded:false});
 for(const asset of manifest.assets.slice(1))await downloadPinned(asset,join(models,asset.path));
 record('checksum-verified-public-speech-assets',{assets:manifest.assets.slice(1).map(({path,bytes,sha256})=>({path,bytes,sha256})),chatModelDownloaded:false});
 const original=await inventory(backend),speech=join(backend,'native/speech/bambi-speech'),servicePort=await port();env.BAMBI_TTS_PORT=String(servicePort);
 const base='http://127.0.0.1:'+servicePort,kokoro=launch(speech,['kokoro']);
 const ready=await waitReady(kokoro,base+'/desktop/identity');
 assert.equal(ready.value.pid,kokoro.pid);assert.equal(ready.value.instance,env.BAMBI_INSTANCE_TOKEN);assert.equal(ready.value.modelSha256,manifest.assets[1].sha256);
 record('frozen-Kokoro-starts-outside-checkout-with-empty-PATH',{startupMs:ready.ms,pid:kokoro.pid,voiceFingerprintCheckedByRegistry:'906e9b9050f2bd38b175298e26b6d255e7db0270570fcc66979f6fbccd1cdf61'});
 const headers={'content-type':'application/json','X-Bambi-TTS-Token':env.BAMBI_TTS_TOKEN};
 const started=performance.now();const response=await fetch(base+'/lab/render',{method:'POST',headers,body:JSON.stringify({text:'Keep the small silver key beside the blue glass.',voice:'bambi_classic',preset:'bambi_local_clean',speed:1}),signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Frozen synthesis failed: '+response.status+' '+await response.text());
 const wav=Buffer.from(await response.arrayBuffer()),audio=pcm(wav);record('approved-voice-real-nonzero-PCM',{renderMs:performance.now()-started,peak:audio.peak,seconds:audio.seconds,format:audio.format});
 const captionResponse=await fetch(base+'/dev/captioned_speech',{method:'POST',headers,body:JSON.stringify({text:'The small silver key stays beside the blue glass. [pause:550] The room is quiet.',voice:'bambi_classic',preset:'bambi_classic',speed:1}),signal:AbortSignal.timeout(120000)});
 assert(captionResponse.ok);const captions=(await captionResponse.text()).trim().split('\n').map(line=>JSON.parse(line));assert(captions.length>=2);
 for(const chunk of captions){assert.equal(chunk.preset,'bambi_classic');assert(chunk.timestamps.length>0);assert.equal(chunk.timing_source,'kokoro-phoneme-pcm-onset');pcm(Buffer.from(chunk.audio,'base64'));}
 record('existing-DSP-and-word-caption-timing',{chunks:captions.map(({text,timestamps,spoken_seconds,pause_ms,timing_source,preset})=>({text,timestamps,spoken_seconds,pause_ms,timing_source,preset}))});
 const streaming=launch(speech,['streaming']),next=messages(streaming);const sttStart=performance.now();assert.equal((await next()).type,'ready');record('frozen-streaming-worker-starts-with-empty-PATH',{startupMs:performance.now()-sttStart,pid:streaming.pid});
 const send=value=>new Promise((accept,reject)=>streaming.stdin.write(JSON.stringify(value)+'\n',error=>error?reject(error):accept()));
 const results=[];
 async function frame(id,samples){await send({type:'audio',id,pcm:Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength).toString('base64')});while(true){const result=await next();assert.notEqual(result.type,'error');if(result.type==='partial')results.push(result);if(result.type==='ack'){assert.equal(result.id,id);return;}}}
 await send({type:'start',id:'cancelled-fixture'});await frame('cancelled-fixture',audio.samples.subarray(0,1024));await send({type:'reset'});
 const id='recognized-fixture';await send({type:'start',id});const recognitionStart=performance.now();
 for(let offset=0;offset<audio.samples.length;offset+=1024)await frame(id,audio.samples.subarray(offset,offset+1024));
 await send({type:'finish',id});let final;while(!final){const value=await next();assert.notEqual(value.type,'error');if(value.type==='partial')results.push(value);if(value.type==='final')final=value;}
 assert.equal(final.id,id);assert(/silver|blue|glass|key/i.test(final.text));assert(results.some(r=>r.id===id&&/silver|blue|glass|key/i.test(r.text)));
 record('real-streaming-partial-and-final-recognition',{ms:performance.now()-recognitionStart,audioSeconds:audio.samples.length/16000,partials:results,final});
 assert(!results.some(r=>r.type==='final'&&r.id==='cancelled-fixture'));record('streaming-reset-cancels-prior-utterance',{finalId:final.id});
 streaming.stdin.end();await new Promise((accept,reject)=>{if(streaming.exitCode!==null)return accept();const timer=setTimeout(()=>reject(Error('Worker did not stop on pipe EOF')),5000);streaming.once('exit',code=>{clearTimeout(timer);code===0?accept():reject(Error('Worker EOF exit '+code));});});
 record('streaming-pipe-EOF-stops-owned-worker');await stop(kokoro);record('owned-Kokoro-process-stops');
 assert.deepEqual(await inventory(backend),original);record('relocated-runtime-resources-unchanged');evidence.result='passed';
}catch(error){
 evidence.result='failed';evidence.failure=String(error.stack||error);
 evidence.failureCause=error.cause?String(error.cause.stack||error.cause):undefined;
 await delay(250);
 evidence.publicFixtureServiceDiagnostics=[...children].map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode,launchError:child.launchError,diagnostics:child.diagnostics()}));
 console.error(error);process.exitCode=1;
}
finally{
 for(const child of children)try{await stop(child);}catch(error){evidence.cleanupFailure=String(error);process.exitCode=1;evidence.result='failed';}
 save();rmSync(temporary,{recursive:true,force:true});clearTimeout(watchdog);console.log('Received native Mac evidence:',output);
}
