// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {stageDesktopSource,validateReleaseSource,writeSourceManifest,verifySnapshot} from './desktop-source.mjs';
import {assertNativeTarget,releaseReport,readReleaseArtifact,withReleaseLock,sourceChecksMatch} from './desktop-release-support.mjs';
import {hashFile} from './desktop-windows-support.mjs';

const project=resolve(fileURLToPath(new URL('../',import.meta.url)));
const [command,...args]=process.argv.slice(2);
const usage='prepare smoke|alpha VERSION OUTSIDE_DIRECTORY | check SNAPSHOT_SOURCE | build SNAPSHOT_SOURCE TARGET | qualify SNAPSHOT_SOURCE TARGET OUTPUT_DIRECTORY | status SNAPSHOT_SOURCE [OUTPUT_DIRECTORY ...]';
if(!command||command==='--help'){console.log('node scripts/desktop-release.mjs '+usage);process.exit(command?0:1);}
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const run=(root,script,arguments_,env={})=>execFileSync(process.execPath,[join(root,script),...arguments_],{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true});
async function checkSource(root,spec){
 const record={schema:1,version:spec.version,applicationDigest:spec.applicationDigest,sourceDigest:spec.sourceDigest,
  platform:process.platform,architecture:process.arch,testedAt:new Date().toISOString(),result:'failed'};
 try{
  run(root,'node_modules/typescript/bin/tsc',['--noEmit']);
  const tests=readdirSync(join(root,'tests')).filter(path=>/\.test\.(ts|mjs)$/.test(path)).sort().map(path=>join(root,'tests',path));
  if(!tests.length)throw Error('No release source tests found.');
  execFileSync(process.execPath,['--import','tsx','--test','--test-concurrency=4',...tests],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
  await verifySnapshot(root);record.result='passed';
 }finally{writeFileSync(join(root,'SOURCE-CHECKS.json'),JSON.stringify(record,null,2)+'\n');}
 return record;
}
const sourceChecks=root=>existsSync(join(root,'SOURCE-CHECKS.json'))?json(join(root,'SOURCE-CHECKS.json')):undefined;

if(command==='prepare'){
 const [phase,version,requested,...extra]=args;
 if(!requested||extra.length||!['smoke','alpha'].includes(phase)||!new RegExp(`^0\\.1\\.0-${phase}\\.[1-9][0-9]*$`).test(version??''))throw Error(usage);
 const destination=resolve(requested),local=relative(project,destination);
 if(local===''||!local.startsWith('..')&&!isAbsolute(local)||existsSync(destination))throw Error('Use a fresh snapshot directory outside the repository.');
 mkdirSync(destination,{recursive:true});const source=join(destination,'source');
 const spec={...json(join(project,'config/desktop-release.json')),version,phase};
 const manifest=await stageDesktopSource(project,source,version);validateReleaseSource(manifest,spec);writeSourceManifest(source,manifest);
 Object.assign(spec,{applicationDigest:manifest.applicationDigest,sourceDigest:manifest.sourceDigest});
 writeFileSync(join(source,'RELEASE-SPEC.json'),JSON.stringify(spec,null,2)+'\n');
 const archive=`bambi-local-${version}-release-source.tar.gz`;
 execFileSync('tar',['-czf',join(destination,archive),'-C',source,'.'],{stdio:'inherit'});
 writeFileSync(join(destination,'SHA256SUMS'),`${await hashFile(join(destination,archive))}  ${archive}\n`);
 writeFileSync(join(destination,'RELEASE-STATUS.json'),JSON.stringify(releaseReport(spec),null,2)+'\n');
 console.log(JSON.stringify({source,version,applicationDigest:spec.applicationDigest,status:'prepared; no target built'},null,2));
}else if(['check','build','qualify','status'].includes(command)){
 const [requested,target,output,...extra]=args;if(!requested)throw Error(usage);
 const root=resolve(requested),spec=json(join(root,'RELEASE-SPEC.json'));await verifySnapshot(root);
 if(command==='status'){
  const artifacts=await Promise.all(args.slice(1).map(directory=>readReleaseArtifact(resolve(directory))));
  console.log(JSON.stringify(releaseReport(spec,artifacts),null,2));
 }else if(command==='check'){
  if(args.length!==1)throw Error(usage);
  await withReleaseLock(root,()=>checkSource(root,spec));
 }else{
  if(extra.length||!target||command==='build'&&output||command==='qualify'&&!output)throw Error(usage);
  assertNativeTarget(spec,target);
  await withReleaseLock(root,async()=>{
   if(command==='build'){
    if(!existsSync(join(root,'node_modules/typescript')))throw Error('Install the frozen source dependencies with npm ci --ignore-scripts first.');
    if(!sourceChecksMatch(sourceChecks(root),spec))await checkSource(root,spec);
    if(target==='windows-x64')run(root,'scripts/desktop-windows-build.mjs',[spec.phase,spec.version]);
    else run(root,'scripts/desktop-build.mjs',[],{[spec.phase==='alpha'?'BAMBI_ALPHA_VERSION':'BAMBI_SMOKE_VERSION']:spec.version});
    await verifySnapshot(root);console.log('Built from the frozen source; native qualification remains pending.');
   }else{
    const directory=resolve(output),{runtime}=await readReleaseArtifact(directory);
    const preliminary=releaseReport(spec,[{target,runtime}]).targets.find(t=>t.target===target);
    if(preliminary.status==='source-mismatch')throw Error('Artifact does not match the frozen release source.');
    const checks=sourceChecks(root);
    if(checks)writeFileSync(join(directory,'SOURCE-CHECKS.json'),JSON.stringify(checks,null,2)+'\n');
    const gates={sourceChecks:sourceChecksMatch(checks,spec)?'passed':checks?.result==='failed'?'failed':'pending'};const payload=[];
    for(const filename of readdirSync(directory).filter(name=>/\.(?:exe|AppImage|tar\.gz)$/.test(name)||['RUNTIME-MANIFEST.json','SOURCE-CHECKS.json'].includes(name)))payload.push({filename,sha256:await hashFile(join(directory,filename))});
    if(!payload.some(p=>/\.(exe|AppImage)$/.test(p.filename)))throw Error('No distribution executable found.');
    const qualification={schema:1,version:spec.version,target,applicationDigest:spec.applicationDigest,sourceDigest:runtime.sourceDigest,payload,gates,testedAt:new Date().toISOString()};
    try{
     if(target==='windows-x64'){
      const testOutput=mkdtempSync(join(directory,'qualification-'));
      try{run(root,'scripts/desktop-windows-install-check.mjs',[directory],{BAMBI_WINDOWS_TEST_OUTPUT:testOutput});}
      finally{
       const reports=readdirSync(testOutput).filter(name=>existsSync(join(testOutput,name,'evidence.json')));
       if(reports.length>1)throw Error('Multiple native application reports in the fresh qualification directory.');
       if(reports.length)writeFileSync(join(directory,'WINDOWS-PACKAGING-CHECK.json'),readFileSync(join(testOutput,reports[0],'evidence.json')));
       const notices=join(directory,'win-unpacked/resources/notices');
       if(existsSync(notices))execFileSync('tar',['-czf',join(directory,'NOTICES.tar.gz'),'-C',notices,'.'],{stdio:'inherit'});
      }
      const installed=json(join(directory,'INSTALLER-CHECK.json'));if(installed.result!=='passed'||installed.version!==spec.version)throw Error('Installer acceptance failed.');
      gates.installer='passed';gates.packaging='passed';
      if(spec.phase==='alpha'){const speech=json(join(directory,'WINDOWS-NATIVE-SPEECH-CHECK.json'));if(speech.result!=='passed')throw Error('Installed speech acceptance failed.');gates.speech='passed';}
     }else{
      const received=mkdtempSync(join(tmpdir(),'Bambi release received '));
      try{
       execFileSync('tar',['-xzf',join(directory,`bambi-local-${spec.version}-x64.tar.gz`),'-C',received],{stdio:'inherit'});
       const executable=join(received,spec.phase==='alpha'?'bambi-local':'bambi-local-smoke');
       run(root,spec.phase==='alpha'?'scripts/desktop-alpha-check.mjs':'scripts/desktop-smoke.mjs',[executable],{BAMBI_SMOKE_OUTPUT:join(directory,'qualification-linux')});gates.packaging='passed';
      }finally{rmSync(received,{recursive:true,force:true});}
     }
     for(const file of payload)if(await hashFile(join(directory,file.filename))!==file.sha256)throw Error('Distribution changed during qualification.');
     await verifySnapshot(root);
    }catch(error){gates.packaging='failed';throw error;}
    finally{writeFileSync(join(directory,'DESKTOP-QUALIFICATION.json'),JSON.stringify(qualification,null,2)+'\n');}
    console.log(JSON.stringify(releaseReport(spec,[{target,runtime,qualification}]),null,2));
   }
  });
 }
}else throw Error(usage);
