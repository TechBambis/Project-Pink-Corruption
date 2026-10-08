// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {releaseTag,desktopVersion} from '../scripts/desktop-release-version.mjs';
import {context,assertSafePath,inspectArchive,stageTarget,assemble,verifyPublication,publish} from '../scripts/release-pipeline.mjs';
import {archiveTool,hashFile} from '../scripts/desktop-windows-support.mjs';

const build={tag:'v0.1.0-smoke.20',version:'0.1.0-smoke.20',phase:'smoke',prerelease:true,
 commit:'a'.repeat(40),repository:'example/bambi',workflow:'Verified desktop tag release',workflowPath:'.github/workflows/release.yml',runId:'123',runAttempt:'1',runUrl:'https://github.com/example/bambi/actions/runs/123'};
const write=(path,data)=>writeFileSync(path,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
const read=path=>JSON.parse(readFileSync(path,'utf8'));

test('semantic tags select prereleases without allowing injection, version drift or unqualified AI alphas',()=>{
 for(const tag of ['v0.1.0','v0.1.0-beta.1','v0.1.0-rc.9','v0.1.0-smoke.20'])assert.equal(releaseTag(tag,'0.1.0').prerelease,tag.includes('-'));
 assert.equal(releaseTag('v2.3.4-rc.1','2.3.4').version,'2.3.4-rc.1');
 for(const tag of ['v0.1.0-alpha.1','v0.1.0-beta.01','v01.1.0','v0.1','v0.1.0;echo fail','v0.1.0/escape','0.1.0','v1.0.0'])assert.throws(()=>releaseTag(tag,'0.1.0'));
 assert(desktopVersion('2.4.6-alpha.3','alpha'));assert(!desktopVersion('2.4.6-alpha.3','smoke'));assert(!desktopVersion('2.4.6','alpha'));
});

test('publication context rejects local runs, unauthorized identities and inconsistent package locks',t=>{
 const fixture=mkdtempSync(join(tmpdir(),'bambi-context-'));t.after(()=>rmSync(fixture,{recursive:true,force:true}));mkdirSync(join(fixture,'config'));
 write(join(fixture,'package.json'),{version:'0.1.0'});write(join(fixture,'package-lock.json'),{version:'0.1.0',packages:{'':{version:'0.1.0'}}});copyFileSync(new URL('../config/release-pipeline.json',import.meta.url),join(fixture,'config/release-pipeline.json'));
 const env={GITHUB_REF_NAME:build.tag,GITHUB_REF:'refs/tags/'+build.tag,GITHUB_EVENT_NAME:'push',GITHUB_ACTIONS:'true',GITHUB_SHA:build.commit,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_REPOSITORY:build.repository,GITHUB_WORKFLOW:build.workflow,GITHUB_SERVER_URL:'https://github.com',GITHUB_ACTOR_ID:'337824705'};
 assert.deepEqual(context(env,fixture),build);
 for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_ACTOR_ID:'1'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_SHA:'main'},{GITHUB_REF:'refs/heads/main'}])assert.throws(()=>context({...env,...change},fixture));
 write(join(fixture,'package-lock.json'),{version:'0.1.1',packages:{'':{version:'0.1.0'}}});assert.throws(()=>context(env,fixture),/lockfile/);
});

test('distribution inspection rejects secrets, local data, archive traversal and links',t=>{
 for(const path of ['.git/config','./.env','backend/data/private.sqlite','/etc/passwd','../escape','a/../../escape','C:\\private','docs/internal/strategy.md','id_ed25519','config/user.key'])assert.throws(()=>assertSafePath(path));
 for(const path of ['apps/server/index.ts','./docs/licenses/NOTICE.txt','node_modules/express/index.js','.github/workflows/release.yml'])assert.doesNotThrow(()=>assertSafePath(path));
 const folder=mkdtempSync(join(tmpdir(),'bambi-archive-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));write(join(folder,'.env'),'fixture, not a secret');
 const archive=join(folder,'bad.tar.gz');execFileSync(archiveTool,['-czf',archive,'-C',folder,'.env']);assert.throws(()=>inspectArchive(archive),/Sensitive/);
});

async function fixture(t){
 const base=mkdtempSync(join(tmpdir(),'bambi-publication-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const input=join(base,'input');mkdirSync(input);const config=read(new URL('../config/desktop-release.json',import.meta.url));
 for(const target of ['linux-x64','windows-x64']){
  const folder=join(input,'release-'+target);mkdirSync(folder);
  const executable=`bambi-local-${build.version}-${target==='linux-x64'?'x86_64.AppImage':'x64.exe'}`;
  write(join(folder,executable),'Unique checked bytes for '+target);const executableSha=await hashFile(join(folder,executable));
  const sourceDigest='b'.repeat(64),applicationDigest='c'.repeat(64),platform=target==='linux-x64'?'linux':'win32';
  const runtime={version:build.version,phase:'smoke',platform,architecture:'x64',sourceDigest,release:{applicationDigest},capabilities:{ai:false,speech:false},files:[]};
  write(join(folder,target+'-RUNTIME-MANIFEST.json'),runtime);
  write(join(folder,target+'-SOURCE-CHECKS.json'),{schema:1,...runtime,applicationDigest,result:'passed'});
  write(join(folder,target+'-DESKTOP-QUALIFICATION.json'),{version:build.version,target,applicationDigest,sourceDigest,payload:[{filename:executable,sha256:executableSha}],gates:Object.fromEntries(config.gates.smoke.filter(g=>target==='windows-x64'||g!=='installer').map(g=>[g,'passed'])),...(target==='linux-x64'?{appImage:{filename:executable,sha256:executableSha}}:{})});
  write(join(folder,target+'-PACKAGING-CHECK.json'),{result:'passed',checks:[{name:'fixture'}]});
  if(target==='windows-x64')write(join(folder,target+'-INSTALLER-CHECK.json'),{result:'passed',installerSha256:executableSha});
  const assets=[];for(const filename of readdirSync(folder).sort())assets.push({filename,bytes:readFileSync(join(folder,filename)).length,sha256:await hashFile(join(folder,filename))});
  write(join(folder,target+'-BUILD-INFO.json'),{schema:1,...build,target,applicationDigest,sourceDigest,assets});
 }
 return {base,input};
}

async function rebind(input,target){
 const folder=join(input,'release-'+target),path=join(folder,target+'-BUILD-INFO.json'),record=read(path);
 for(const entry of record.assets){entry.sha256=await hashFile(join(folder,entry.filename));entry.bytes=readFileSync(join(folder,entry.filename)).length;}
 write(path,record);
}

test('assembly is deterministic across attestation/publication jobs and preserves final executable bytes',async t=>{
 const {base,input}=await fixture(t),a=join(base,'first'),b=join(base,'second');await assemble(input,a,build);await assemble(input,b,build);
 assert.deepEqual(readdirSync(a),readdirSync(b));for(const name of readdirSync(a))assert.equal(await hashFile(join(a,name)),await hashFile(join(b,name)));
 const checks=await verifyPublication(a,build);assert(checks.some(a=>a.filename==='BUILD-INFO.json'));
 const exe=`bambi-local-${build.version}-x64.exe`;assert.equal(await hashFile(join(a,exe)),await hashFile(join(input,'release-windows-x64',exe)));
 write(join(a,exe),'changed');await assert.rejects(verifyPublication(a,build),/bytes changed/);
});

test('missing targets, extra files, changed downloads and source disagreement prevent publication assembly',async t=>{
 const {base,input}=await fixture(t);write(join(input,'release-linux-x64','unexpected.json'),'private');await assert.rejects(assemble(input,join(base,'extra'),build),/Unexpected/);rmSync(join(input,'release-linux-x64','unexpected.json'));
 const path=join(input,'release-windows-x64','windows-x64-BUILD-INFO.json'),record=read(path);write(path,{...record,applicationDigest:'d'.repeat(64)});await assert.rejects(assemble(input,join(base,'different'),build),/qualification|source/i);write(path,record);
 write(join(input,'release-linux-x64',`bambi-local-${build.version}-x86_64.AppImage`),'tampered');await assert.rejects(assemble(input,join(base,'tampered'),build),/integrity/);
 rmSync(join(input,'release-linux-x64'),{recursive:true});await assert.rejects(assemble(input,join(base,'missing'),build),/Both/);
});

test('failed native gates cannot be hidden by regenerating transport checksums',async t=>{
 const {base,input}=await fixture(t),path=join(input,'release-windows-x64','windows-x64-DESKTOP-QUALIFICATION.json'),q=read(path);q.gates.installer='failed';write(path,q);await rebind(input,'windows-x64');await assert.rejects(assemble(input,join(base,'failed'),build),/qualification/);
});

test('target staging refuses old tar-only Linux evidence even when its generic packaging gate passed',async t=>{
 const {base,input}=await fixture(t),folder=join(input,'release-linux-x64'),project=join(base,'source'),output=join(base,'output');
 mkdirSync(join(project,'config'),{recursive:true});mkdirSync(output);
 for(const filename of ['desktop-release.json','release-pipeline.json'])copyFileSync(new URL('../config/'+filename,import.meta.url),join(project,'config',filename));
 const sourceDigest='b'.repeat(64),applicationDigest='c'.repeat(64);
 write(join(project,'RELEASE-SPEC.json'),{...read(new URL('../config/desktop-release.json',import.meta.url)),version:build.version,phase:build.phase,sourceDigest,applicationDigest});
 for(const filename of ['RUNTIME-MANIFEST.json','SOURCE-CHECKS.json','DESKTOP-QUALIFICATION.json'])copyFileSync(join(folder,'linux-x64-'+filename),join(output,filename));
 const executable=`bambi-local-${build.version}-x86_64.AppImage`;copyFileSync(join(folder,executable),join(output,executable));
 const qualification=read(join(output,'DESKTOP-QUALIFICATION.json'));delete qualification.appImage;write(join(output,'DESKTOP-QUALIFICATION.json'),qualification);
 await assert.rejects(stageTarget(project,output,join(base,'stage'), 'linux-x64',build),/AppImage has not been exercised/);
});

async function publicationMock(directory,{privateRepo=true,badDigest=false,existing=false,tagChanges=false}={}){
 const commands=[];let created=false,tagReads=0;
 const assets=[];for(const filename of readdirSync(directory))assets.push({name:filename,size:readFileSync(join(directory,filename)).length,digest:'sha256:'+await hashFile(join(directory,filename))});
 return {commands,
  api:async path=>{
   if(path.includes('/git/ref/'))return {object:{type:'commit',sha:tagChanges&&++tagReads>1?'d'.repeat(40):build.commit}};
   if(path.includes('/releases/tags/'))return existing?{draft:false}:created?{draft:true,assets:badDigest?assets.map((a,i)=>i? a:{...a,digest:'sha256:'+'0'.repeat(64)}):assets}:undefined;
   return {private:privateRepo};
  },gh:args=>{commands.push(args);if(args[0]==='release'&&args[1]==='create')created=true;}
 };
}

test('private publication skips unsupported attestations, confirms remote digests and publishes the draft last',async t=>{
 const {base,input}=await fixture(t),directory=join(base,'publish');await assemble(input,directory,build);const mock=await publicationMock(directory);await publish(directory,build,mock);
 assert.deepEqual(mock.commands.map(c=>c.slice(0,2)),[['release','create'],['release','edit']]);assert(mock.commands[0].includes('--verify-tag'));assert(mock.commands[0].includes('--prerelease'));assert(mock.commands[1].includes('--draft=false'));assert(mock.commands[1].includes('--latest=false'));
});

test('public publication verifies every asset against workflow/ref/commit before creating its draft',async t=>{
 const {base,input}=await fixture(t),directory=join(base,'publish');await assemble(input,directory,build);const mock=await publicationMock(directory,{privateRepo:false});await publish(directory,build,mock);
 const verifies=mock.commands.filter(c=>c[0]==='attestation');assert.equal(verifies.length,readdirSync(directory).length);assert(verifies.every(c=>c.includes('--source-digest')&&c.includes(build.commit)&&c.includes('--signer-workflow')));
 assert.equal(mock.commands.at(-1)[1],'edit');
});

test('failed provenance, existing releases, upload corruption or moved tags leave releases unpublished',async t=>{
 const {base,input}=await fixture(t),directory=join(base,'publish');await assemble(input,directory,build);
 for(const options of [{badDigest:true},{existing:true},{tagChanges:true}]){
  const mock=await publicationMock(directory,options);await assert.rejects(publish(directory,build,mock));assert(!mock.commands.some(c=>c[1]==='edit'));
 }
 const mock=await publicationMock(directory,{privateRepo:false});await assert.rejects(publish(directory,build,{...mock,gh:()=>{throw Error('Attestation rejected');}}),/Attestation rejected/);assert.equal(mock.commands.length,0);
});
