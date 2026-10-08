// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Temporary private transport. Each part must be received and verified locally
// before the receiver removes that new part and the runner uploads the next.
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,readSync,writeSync,statSync,existsSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {hashFile} from './desktop-windows-support.mjs';

export function splitBundle(bundle,output,partBytes){
 if(!Number.isSafeInteger(partBytes)||partBytes<1024**2)throw Error('Invalid bounded transfer part size.');
 const total=statSync(bundle).size,count=Math.ceil(total/partBytes);
 if(count<1||count>8)throw Error('Package needs more than eight bounded parts. No upload prepared.');
 mkdirSync(output,{recursive:true});
 const input=openSync(bundle,'r'),buffer=Buffer.alloc(1024**2),parts=[];
 try{
  for(let index=0;index<count;index++){
   const name='part-'+index+'.bin',path=join(output,name),fd=openSync(path,'wx');let bytes=0;
   try{while(bytes<partBytes){const length=readSync(input,buffer,0,Math.min(buffer.length,partBytes-bytes),null);if(!length)break;let written=0;while(written<length)written+=writeSync(fd,buffer,written,length-written);bytes+=length;}}
   finally{closeSync(fd);}
   parts.push({index,name,bytes,path});
  }
 }finally{closeSync(input);}
 return parts;
}

async function prepare(output,transport,allowance){
 if(!Number.isSafeInteger(allowance)||allowance<32||allowance>450)throw Error('Use a checked shared storage allowance between 32 and 450 MiB.');
 const retained=['RUNTIME-MANIFEST.json','TESTER-GUIDE.md','NOTICES.tar.gz','WINDOWS-PACKAGING-CHECK.json','INSTALLER-CHECK.json','WINDOWS-NATIVE-SPEECH-CHECK.json','SOURCE-CHECKS.json','DESKTOP-QUALIFICATION.json','RELEASE-STATUS.json'];
 const runtime=JSON.parse(readFileSync(join(output,'RUNTIME-MANIFEST.json'),'utf8'));
 if(runtime.phase!=='alpha'||!/^0\.1\.0-alpha\.[1-9][0-9]*$/.test(runtime.version))throw Error('Bounded transfer is reserved for a valid new alpha version.');
 const load=name=>existsSync(join(output,name))?JSON.parse(readFileSync(join(output,name),'utf8')):null;
 const application=load('WINDOWS-PACKAGING-CHECK.json'),installer=load('INSTALLER-CHECK.json'),speech=load('WINDOWS-NATIVE-SPEECH-CHECK.json');
 const qualification=load('DESKTOP-QUALIFICATION.json'),sourceChecks=load('SOURCE-CHECKS.json');
 if(runtime.release?.snapshot==='prepared'){
  for(const [name,record] of [['SOURCE-CHECKS.json',sourceChecks],['DESKTOP-QUALIFICATION.json',qualification],['RELEASE-STATUS.json',load('RELEASE-STATUS.json')]]){
   if(!record)throw Error('Missing frozen release evidence: '+name);
   if(record.version!==runtime.version||record.applicationDigest!==runtime.release.applicationDigest)throw Error('Frozen release evidence identity mismatch: '+name);
  }
  if(sourceChecks.sourceDigest!==runtime.sourceDigest||qualification.sourceDigest!==runtime.sourceDigest||sourceChecks.platform!=='win32'||sourceChecks.architecture!=='x64'||qualification.target!=='windows-x64')throw Error('Frozen release evidence source/target mismatch.');
  if(sourceChecks.result!=='passed'||['sourceChecks','packaging','installer','speech'].some(gate=>qualification.gates[gate]!=='passed'))throw Error('Frozen release native gates did not pass.');
 }
 const capability={version:runtime.version,sourceDigest:runtime.sourceDigest,applicationDigest:runtime.release?.applicationDigest,buildGitSha:process.env.GITHUB_SHA,buildRunId:process.env.GITHUB_RUN_ID,
  qualification:{application:application?.result||'not-run',installer:installer?.result||'not-run',installedSpeech:speech?.result||'not-run'},
  releaseGates:qualification?.gates,
  nativeApplicationChecks:application?.checks.map(c=>c.name)||[],nativeInstallerChecks:installer?.checks.map(c=>c.name)||[],nativeSpeechChecks:speech?.checks.map(c=>c.name)||[],
  conditions:application?.environment||speech?.conditions||null,
  referenceHardware:{os:'Windows 11 x64',cpu:'AMD Ryzen 5 5600X',systemMemoryGiB:16,gpu:'AMD Radeon RX 6600 XT',dedicatedMemoryGiB:8,status:'pending'},
  pending:['Unchanged full 9B model with full authored prompts and 24576-token context.','Actual Vulkan offload and CPU fallback on reference hardware.','Real text and spoken conversation, independent mute controls, cancellation and crash cleanup with loaded AI.','Offline restart and conversation after verified model setup.','Physical microphone, listening, sleep/wake and normal Windows 11 received-download security flow.'],
  storage:{transport:'Sequential private parts; receiver verifies and fsyncs each part before deleting only that new temporary artifact.',confirmedRemainingMiB:allowance,partReserveFraction:0.1},
  limitations:['Hosted Windows Server 2022 CPU results are not Windows 11 GPU or physical device evidence.','Unsigned alpha. Do not disable Windows security controls to run it.']};
 writeFileSync(join(output,'CAPABILITY-RECORD.json'),JSON.stringify(capability,null,2)+'\n');
 const guide=`# Bambi Local ${runtime.version} Windows alpha\n\nInstall the per-user x64 installer. No Node, Python, Git or compiler installation is required. Keep Windows security controls enabled; report a blocked download or launch.\n\n1. Open the app and try Load offline sample, Play/Pause, Audio Mute and End session before installing models.\n2. Open Studio and import the prepared sample linked in the app guide; preview, stop, export and reopen it.\n3. Open Setup. Explicitly download the pinned model data, or copy an existing verified model directory. Watch progress; cancel and retry. Only complete hash-verified files become active. The chat model is several GiB and Setup also installs public voice/recognition data.\n4. After Setup completes, prepare the full local model. Keep the approved model, full prompts and 24576-token context. Record actual CPU/Vulkan selection and errors.\n5. Test text conversation, speech, microphone partial/final recognition, Audio Mute, Mic Mute, End session and Quit separately. Audio Mute should silence output; Mic Mute should release capture; End session should cancel current work; Quit should stop owned services.\n6. Restart with the network disconnected and verified model data still present. Try conversation again. Record timing, RAM/VRAM use, physical listening and microphone results on the named Windows 11 reference PC.\n\nSee CAPABILITY-RECORD.json and the native check reports for the exact verified scope. Full model, GPU, physical devices and offline conversation remain pending until reference hardware results are supplied. Do not describe the package as fully qualified before those checks pass. Preserve these reports and SHA256SUMS with the matching source and NOTICES.tar.gz.\n`;
 writeFileSync(join(output,'START-HERE.md'),guide);
 retained.push('CAPABILITY-RECORD.json','START-HERE.md',`bambi-local-${runtime.version}-x64.exe`,`bambi-local-${runtime.version}-source.tar.gz`);
 const names=retained.filter(name=>existsSync(join(output,name))).sort(),files=[];
 for(const name of names)files.push({name,bytes:statSync(join(output,name)).size,sha256:await hashFile(join(output,name))});
 writeFileSync(join(output,'SHA256SUMS'),files.map(f=>`${f.sha256}  ${f.name}`).join('\n')+'\n');
 files.push({name:'SHA256SUMS',bytes:statSync(join(output,'SHA256SUMS')).size,sha256:await hashFile(join(output,'SHA256SUMS'))});
 if(existsSync(transport))throw Error('Transfer output already exists.');mkdirSync(transport,{recursive:true});
 const bundle=join(transport,'handoff.tar');
 execFileSync('tar',['-cf',bundle,'-C',output,...files.map(f=>f.name)],{stdio:'inherit'});
 const parts=splitBundle(bundle,join(transport,'parts'),Math.floor(allowance*1024**2*0.90));
 const manifest={schema:1,runId:process.env.GITHUB_RUN_ID,headSha:process.env.GITHUB_SHA,version:runtime.version,bundle:{bytes:statSync(bundle).size,sha256:await hashFile(bundle)},files,parts:[]};
 for(const part of parts)manifest.parts.push({index:part.index,name:part.name,bytes:part.bytes,sha256:await hashFile(part.path)});
 for(const part of parts){const folder=join(transport,String(part.index));mkdirSync(folder);copyFileSync(part.path,join(folder,part.name));writeFileSync(join(folder,'TRANSFER-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');}
 if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,`count=${parts.length}\nroot=${transport}\n`,{flag:'a'});
 console.log(`Prepared ${parts.length} bounded private parts (${manifest.bundle.bytes} bytes), allowance ${allowance} MiB.`);
}

async function waitReceived(id){
 if(!/^\d+$/.test(id)||process.env.GITHUB_REPOSITORY!=='TechBambis/Project-Pink-Corruption')throw Error('Unexpected transfer identity.');
 if(!process.env.GH_TOKEN)throw Error('A read-only Actions token is required.');
 const endpoint=`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${id}`;
 const deadline=Date.now()+5*60*1000;
 while(Date.now()<deadline){
  const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(15000)});
  if(response.status===404){
   const list=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts?per_page=100`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
   if(!list.ok)throw Error('Cannot confirm readable artifact inventory after receipt.');
   const inventory=await list.json();
   if(inventory.total_count!==inventory.artifacts.length||inventory.artifacts.some(a=>a.id===Number(id)))throw Error('Incomplete or inconsistent receipt inventory.');
   console.log('Temporary part received and removed by the local receiver.');return;
  }
  if(!response.ok)throw Error(`Transfer status failed: HTTP ${response.status}.`);
  const artifact=await response.json();
  if(artifact.workflow_run.id!==Number(process.env.GITHUB_RUN_ID)||artifact.workflow_run.head_sha!==process.env.GITHUB_SHA||!artifact.name.startsWith(`bambi-windows-transfer-${process.env.GITHUB_RUN_ID}-`))throw Error('Temporary artifact identity mismatch.');
  await new Promise(r=>setTimeout(r,5000));
 }
 throw Error('Local receiver did not verify and remove the temporary part within five minutes. No further part uploaded.');
}

async function checkPart(folder,allowance){
 if(process.env.GITHUB_REPOSITORY!=='TechBambis/Project-Pink-Corruption'||!process.env.GH_TOKEN)throw Error('Unexpected private transport repository or token.');
 const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts?per_page=100`,{headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Cannot verify current artifact storage before uploading the next part.');
 const inventory=await response.json();if(inventory.total_count!==inventory.artifacts.length)throw Error('Incomplete live artifact inventory.');
 const manifest=JSON.parse(readFileSync(join(folder,'TRANSFER-MANIFEST.json'),'utf8'));
 if(manifest.runId!==process.env.GITHUB_RUN_ID||manifest.headSha!==process.env.GITHUB_SHA)throw Error('Part manifest does not match this run.');
 const index=Number(folder.split(/[\\/]/).at(-1)),part=manifest.parts[index];if(!part||part.index!==index)throw Error('Unexpected transfer part.');
 const size=statSync(join(folder,part.name)).size+statSync(join(folder,'TRANSFER-MANIFEST.json')).size;
 if(size>allowance*1024**2*0.95)throw Error('Part exceeds confirmed allowance and archive reserve.');
 const active=inventory.artifacts.filter(a=>!a.expired);
 if(active.some(a=>a.name.startsWith(`bambi-windows-transfer-${process.env.GITHUB_RUN_ID}-`)))throw Error('A previous temporary transfer part is still retained.');
 if(active.reduce((sum,a)=>sum+a.size_in_bytes,0)+Math.ceil(size/0.95)>450*1024**2)throw Error('Part would exceed the included shared storage minus the 50 MiB reserve.');
 console.log('Live storage and bounded part size verified; no existing temporary part.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='prepare'&&args.length===3)await prepare(resolve(args[0]),resolve(args[1]),Number(args[2]));
 else if(mode==='wait'&&args.length===1)await waitReceived(args[0]);
 else if(mode==='check'&&args.length===2)await checkPart(resolve(args[0]),Number(args[1]));
 else throw Error('Use prepare <version output> <fresh transport directory> <checked MiB>, or wait <new artifact ID>.');
}
