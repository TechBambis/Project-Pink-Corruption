// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,existsSync,mkdirSync,writeFileSync,openSync,closeSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {hashFile} from './desktop-windows-support.mjs';

export function assertNativeTarget(spec,target,platform=process.platform,architecture=process.arch){
 const entry=spec.targets[target];
 if(!entry?.implemented)throw Error('Target is not implemented: '+target);
 if(entry.platform!==platform||entry.architecture!==architecture)throw Error('Use a native '+target+' host.');
}

export function sourceChecksMatch(record,spec,platform=process.platform,architecture=process.arch){
 return record?.schema===1&&record.result==='passed'&&record.version===spec.version
  &&/^[a-f0-9]{64}$/.test(record.applicationDigest)&&/^[a-f0-9]{64}$/.test(record.sourceDigest)
  &&record.applicationDigest===spec.applicationDigest&&record.sourceDigest===spec.sourceDigest
  &&record.platform===platform&&record.architecture===architecture;
}

export function releaseReport(spec,artifacts=[]){
 const targets=Object.entries(spec.targets).map(([target,entry])=>{
  const artifact=artifacts.find(item=>item.target===target);
  const gates=Object.fromEntries(spec.gates[spec.phase].map(gate=>[gate,'pending']));
  if(target==='linux-x64')gates.installer='not-applicable';
  if(!entry.implemented)return {target,status:'not-implemented',gates};
  if(!artifact)return {target,status:'not-built',gates};
  const {runtime,qualification}=artifact;
  const identity=runtime.release;
  if(runtime.version!==spec.version||runtime.platform!==entry.platform||runtime.architecture!==entry.architecture||identity?.applicationDigest!==spec.applicationDigest)
   return {target,status:'source-mismatch',gates};
  if(qualification){
   if(qualification.version!==spec.version||qualification.target!==target||qualification.applicationDigest!==spec.applicationDigest||qualification.sourceDigest!==runtime.sourceDigest)
    return {target,status:'evidence-mismatch',gates};
   for(const [name,value] of Object.entries(qualification.gates??{})){
    if(!(name in gates)||!['passed','failed','pending'].includes(value))throw Error('Invalid qualification gate: '+name);
    gates[name]=value;
   }
  }
  const status=Object.values(gates).includes('failed')?'failed':Object.values(gates).includes('pending')?'built-unqualified':'qualified';
  return {target,status,gates,sourceDigest:runtime.sourceDigest,applicationDigest:identity.applicationDigest};
 });
 if(new Set(artifacts.map(a=>a.target)).size!==artifacts.length||artifacts.some(a=>!spec.targets[a.target]))throw Error('Duplicate or unknown artifact target.');
 return {schema:1,version:spec.version,applicationDigest:spec.applicationDigest,ready:targets.filter(t=>spec.targets[t.target].implemented).every(t=>t.status==='qualified'),targets};
}

export async function readReleaseArtifact(directory){
 const runtime=JSON.parse(readFileSync(join(directory,'RUNTIME-MANIFEST.json'),'utf8'));
 const target=runtime.platform==='win32'?'windows-'+runtime.architecture:runtime.platform+'-'+runtime.architecture;
 // Qualification is valid only while the exact tested distribution payload is unchanged.
 const path=join(directory,'DESKTOP-QUALIFICATION.json');
 const qualification=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):undefined;
 if(qualification){
  if(!qualification.payload?.length)throw Error('Qualification has no payload binding.');
  for(const file of qualification.payload){
   if(!/^[a-zA-Z0-9_.-]+$/.test(file.filename)||await hashFile(join(directory,file.filename))!==file.sha256)throw Error('Qualified payload changed: '+file.filename);
  }
 }
 return {target,runtime,qualification};
}

export async function withReleaseLock(root,run){
 const folder=join(root,'.runtime');mkdirSync(folder,{recursive:true});const path=join(folder,'desktop-release.lock');
 const handle=openSync(path,'wx');writeFileSync(handle,String(process.pid));
 try{return await run();}finally{closeSync(handle);rmSync(path);}
}
