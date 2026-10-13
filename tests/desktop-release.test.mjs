// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageDesktopSource,validateReleaseSource,writeSourceManifest,verifySnapshot,releaseIdentity} from '../scripts/desktop-source.mjs';
import {releaseReport,assertNativeTarget,withReleaseLock,readReleaseArtifact,sourceChecksMatch} from '../scripts/desktop-release-support.mjs';
import {digest} from '../scripts/desktop-windows-support.mjs';

const configuration=JSON.parse(readFileSync(new URL('../config/desktop-release.json',import.meta.url)));
const spec={...configuration,phase:'alpha',version:'0.1.0-alpha.8',applicationDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64)};
const runtime={version:spec.version,platform:'win32',architecture:'x64',sourceDigest:'b'.repeat(64),release:{applicationDigest:spec.applicationDigest}};
const qualification={version:spec.version,target:'windows-x64',applicationDigest:spec.applicationDigest,sourceDigest:runtime.sourceDigest,gates:{packaging:'passed',installer:'passed',speech:'passed'}};

test('readiness never treats a build, speech check or another version/platform as complete qualification',()=>{
 const status=artifacts=>releaseReport(spec,artifacts).targets.find(t=>t.target==='windows-x64');
 assert.equal(status([]).status,'not-built');assert.equal(status([{target:'windows-x64',runtime}]).status,'built-unqualified');
 const partial=status([{target:'windows-x64',runtime,qualification}]);assert.equal(partial.status,'built-unqualified');assert.equal(partial.gates.localConversation,'pending');assert.equal(partial.gates.physicalAudio,'pending');
 assert.equal(status([{target:'windows-x64',runtime:{...runtime,version:'0.1.0-alpha.7'}}]).status,'source-mismatch');
 assert.equal(status([{target:'windows-x64',runtime:{...runtime,platform:'linux'}}]).status,'source-mismatch');
 assert.equal(status([{target:'windows-x64',runtime,qualification:{...qualification,sourceDigest:'old'}}]).status,'evidence-mismatch');
 assert.equal(status([{target:'windows-x64',runtime,qualification:{...qualification,gates:{packaging:'failed'}}}]).status,'failed');
 assert.equal(releaseReport(spec).ready,false);assert.equal(releaseReport(spec).targets.find(t=>t.target==='macos-arm64').status,'not-built');
 assert.throws(()=>releaseReport(spec,[{target:'windows-x64',runtime,qualification:{...qualification,gates:{unknown:'passed'}}}]),/Invalid/);
 assert.throws(()=>releaseReport(spec,[{target:'windows-x64',runtime},{target:'windows-x64',runtime}]),/Duplicate/);
});

test('native target selection rejects cross-platform execution and unimplemented targets',()=>{
 assert.doesNotThrow(()=>assertNativeTarget(spec,'windows-x64','win32','x64'));
 assert.throws(()=>assertNativeTarget(spec,'windows-x64','linux','x64'),/native/);
 assert.doesNotThrow(()=>assertNativeTarget(spec,'macos-arm64','darwin','arm64'));
 assert.throws(()=>assertNativeTarget({...spec,phase:'future'},'macos-arm64','darwin','arm64'),/phase is not implemented/);
 assert.doesNotThrow(()=>assertNativeTarget({...spec,phase:'smoke'},'macos-arm64','darwin','arm64'));
 assert.throws(()=>assertNativeTarget({...spec,phase:'smoke'},'macos-arm64','darwin','x64'),/native/);
});

test('source checks cannot be reused after a source/version/host change or failed suite',()=>{
 const record={schema:1,version:spec.version,applicationDigest:spec.applicationDigest,sourceDigest:spec.sourceDigest,platform:'linux',architecture:'x64',result:'passed'};
 assert(sourceChecksMatch(record,spec,'linux','x64'));
 for(const changed of [{result:'failed'},{applicationDigest:'old'},{sourceDigest:'old'},{version:'old'},{platform:'win32'},{architecture:'arm64'}])assert(!sourceChecksMatch({...record,...changed},spec,'linux','x64'));
 assert(!sourceChecksMatch(undefined,spec,'linux','x64'));
});

test('missing current features or proven platform sources block a release instead of silently shipping an older app',()=>{
 const paths=[...Object.values(configuration.features).flat(),...configuration.windowsRequired,...configuration.macosRequired];
 const manifest={version:spec.version,files:paths.map(path=>({path}))};assert.doesNotThrow(()=>validateReleaseSource(manifest,spec));
 assert.throws(()=>validateReleaseSource({...manifest,files:manifest.files.filter(f=>f.path!=='apps/web/src/privacy.ts')},spec),/privacyAccess/);
 assert.throws(()=>validateReleaseSource({...manifest,files:manifest.files.filter(f=>f.path!=='apps/desktop/speech.manifest')},spec),/qualified Windows/);
});

test('shared source snapshots retain notices and have equal application identity across CRLF/LF checkouts',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'bambi-release-source-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const source=join(folder,'input');mkdirSync(source);
 const put=(path,text)=>{mkdirSync(join(source,path,'..'),{recursive:true});writeFileSync(join(source,path),text);};
 for(const dir of ['apps','packages','config','presets','tests','scripts','voices','docs/licenses','assets/sounds','.github'])mkdirSync(join(source,dir),{recursive:true});
 for(const path of ['package.json','package-lock.json','tsconfig.json','.gitignore','desktop-builder.cjs','desktop-alpha-builder.cjs','desktop-windows-builder.cjs','LICENSE','LICENSING.md','README.md'])put(path,'fixture\n');
 put('.gitignore','/scripts/*\n!/scripts/public-check.mjs\n');put('scripts/public-check.mjs','public CI fixture\n');put('scripts/local-benchmark.mjs','local authoring fixture\n');
 for(const path of ['apps/desktop/AppRun','apps/desktop/AppRun.alpha','CLA.md','docs/anubis-model.json','docs/community-models.json'])put(path,'public fixture\n');
 const fixtureConfiguration={...configuration,features:{},windowsRequired:[],macosRequired:[]};put('config/desktop-release.json',JSON.stringify(fixtureConfiguration));
 put('apps/test.ts','public\nsource\n');put('docs/licenses/vendor.txt','Original notice\r\n');put('packages/speech/models/private.json','private');put('apps/web/public/vad/model.json','generated');put('scripts/reports/private.json','private');put('docs/internal/private.md','private');
 const first=join(folder,'first'),a=await stageDesktopSource(source,first,spec.version);writeSourceManifest(first,a);
 assert(!existsSync(join(first,'packages/speech/models/private.json')));assert(!existsSync(join(first,'apps/web/public/vad/model.json')));assert(!existsSync(join(first,'scripts/reports/private.json')));assert(!existsSync(join(first,'docs/internal/private.md')));
 assert(existsSync(join(first,'scripts/public-check.mjs')));assert(!existsSync(join(first,'scripts/local-benchmark.mjs')));
 assert.equal(readFileSync(join(first,'docs/licenses/vendor.txt'),'utf8'),'Original notice\r\n');
 assert(existsSync(join(first,'apps/desktop/AppRun')));assert(existsSync(join(first,'CLA.md')));assert(existsSync(join(first,'docs/anubis-model.json')));
 put('apps/test.ts','public\r\nsource\r\n');const b=await stageDesktopSource(source,join(folder,'second'),spec.version);
 assert.equal(a.applicationDigest,b.applicationDigest);assert.notEqual(a.sourceDigest,b.sourceDigest);
 const prepared={...fixtureConfiguration,version:spec.version,phase:'alpha',applicationDigest:a.applicationDigest,sourceDigest:a.sourceDigest};
 writeFileSync(join(first,'RELEASE-SPEC.json'),JSON.stringify(prepared));
 assert.equal((await releaseIdentity(first,a)).snapshot,'prepared');await verifySnapshot(first);
 writeFileSync(join(first,'RELEASE-SPEC.json'),JSON.stringify({...prepared,gates:{alpha:[]}}));await assert.rejects(verifySnapshot(first),/contract changed/);
 writeFileSync(join(first,'RELEASE-SPEC.json'),JSON.stringify(prepared));
 writeFileSync(join(first,'apps/new.ts'),'unexpected');await assert.rejects(verifySnapshot(first),/inventory changed/);
 rmSync(join(first,'apps/new.ts'));writeFileSync(join(first,'apps/test.ts'),'edited');await assert.rejects(verifySnapshot(first),/Snapshot changed/);
});

test('qualification is invalidated when the tested installer bytes change',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'bambi-release-payload-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 writeFileSync(join(folder,'RUNTIME-MANIFEST.json'),JSON.stringify(runtime));writeFileSync(join(folder,'app.exe'),'original');
 writeFileSync(join(folder,'DESKTOP-QUALIFICATION.json'),JSON.stringify({...qualification,payload:[{filename:'app.exe',sha256:digest('original')}]}));
 assert.equal((await readReleaseArtifact(folder)).target,'windows-x64');writeFileSync(join(folder,'app.exe'),'modified');await assert.rejects(readReleaseArtifact(folder),/payload changed/);
});

test('release lock rejects overlapping work and releases after failure',async t=>{
 const root=mkdtempSync(join(tmpdir(),'bambi-release-lock-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 await assert.rejects(withReleaseLock(root,async()=>{await assert.rejects(withReleaseLock(root,async()=>{}),/EEXIST/);throw Error('fixture build failed');}),/fixture build failed/);
 await withReleaseLock(root,async()=>{});assert(!existsSync(join(root,'.runtime/desktop-release.lock')));
});
