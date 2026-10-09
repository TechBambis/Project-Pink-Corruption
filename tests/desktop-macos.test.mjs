// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,symlinkSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertMachArm64,appPaths,ownedProcessIds,closeTrackedApplication,machOInfo,macNativeReport,copyResolvedNativeTree} from '../scripts/desktop-macos-support.mjs';
import {readReleaseArtifact} from '../scripts/desktop-release-support.mjs';
import {digest} from '../scripts/desktop-windows-support.mjs';

test('Apple Silicon package inspection rejects foreign and truncated executables',t=>{
 const dir=mkdtempSync(join(tmpdir(),'bambi-mach-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'native'),arm=Buffer.alloc(32);arm.writeUInt32LE(0xfeedfacf);arm.writeUInt32LE(0x0100000c,4);
 writeFileSync(path,arm);assert.doesNotThrow(()=>assertMachArm64(path));
 const x64=Buffer.from(arm);x64.writeUInt32LE(0x01000007,4);
 for(const bytes of [x64,Buffer.from('MZ foreign PE'),arm.subarray(0,8)]){writeFileSync(path,bytes);assert.throws(()=>assertMachArm64(path),/Mach-O arm64/);}
});
test('received Mac ZIP evidence maps Darwin to the shared target and is bound to the final archive',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'bambi-mac-zip-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'RUNTIME-MANIFEST.json'),JSON.stringify({platform:'darwin',architecture:'arm64'}));
 writeFileSync(join(dir,'app-macos-arm64.zip'),'finished zip fixture');
 writeFileSync(join(dir,'DESKTOP-QUALIFICATION.json'),JSON.stringify({payload:[{filename:'app-macos-arm64.zip',sha256:digest('finished zip fixture')}]}));
 assert.equal((await readReleaseArtifact(dir)).target,'macos-arm64');
 writeFileSync(join(dir,'app-macos-arm64.zip'),'replacement');await assert.rejects(readReleaseArtifact(dir),/payload changed/);
 const paths=appPaths('/received/Bambi Local Smoke.app/Contents/MacOS/Bambi Local Smoke');
 assert.equal(paths.resources,'/received/Bambi Local Smoke.app/Contents/Resources');
 assert.throws(()=>appPaths('/linux/bambi-local'),/received macOS/);
});
test('Mac cleanup inventory includes renderer and native descendants while excluding sibling apps',()=>{
 const rows=[{pid:23,parent:22},{pid:12,parent:10},{pid:24,parent:1},{pid:22,parent:11},{pid:11,parent:10},{pid:10,parent:1}];
 assert.deepEqual(ownedProcessIds(rows,10).sort((a,b)=>a-b),[10,11,12,22,23]);
});
test('Mac automation closes using its retained child after Playwright disposes the app dispatcher',async()=>{
 const application={process(){throw Error('Disposed dispatcher');},close(){throw Error('Already closed');}};
 let kills=0;
 await closeTrackedApplication(application,{exitCode:0,signalCode:null,kill(){kills++;}});
 assert.equal(kills,0);
 await closeTrackedApplication({close:()=>new Promise(()=>{})},{exitCode:null,signalCode:null,kill(signal){assert.equal(signal,'SIGKILL');kills++;}},10);
 assert.equal(kills,1);
});
test('Mac native dependency audit rejects truncated load commands and missing external libraries',t=>{
 const dir=mkdtempSync(join(tmpdir(),'bambi-mac-load-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const image=dependency=>{const name=Buffer.from(dependency+'\0'),length=Math.ceil((24+name.length)/8)*8,bytes=Buffer.alloc(32+length);bytes.writeUInt32LE(0xfeedfacf);bytes.writeUInt32LE(0x0100000c,4);bytes.writeUInt32LE(1,16);bytes.writeUInt32LE(length,20);bytes.writeUInt32LE(0xc,32);bytes.writeUInt32LE(length,36);bytes.writeUInt32LE(24,40);name.copy(bytes,56);return bytes;};
 const system=image('/usr/lib/libSystem.B.dylib');assert.deepEqual(machOInfo(system).dependencies,['/usr/lib/libSystem.B.dylib']);
 assert.throws(()=>machOInfo(system.subarray(0,system.length-1)),/Truncated/);
 const path=join(dir,'service');writeFileSync(path,system);assert.deepEqual(macNativeReport(dir).unresolved,[]);
 writeFileSync(path,image('/opt/homebrew/lib/libhost-only.dylib'));assert.equal(macNativeReport(dir).unresolved.length,1);
 writeFileSync(path,image('@loader_path/libbundled.dylib'));writeFileSync(join(dir,'libbundled.dylib'),system);assert.deepEqual(macNativeReport(dir).unresolved,[]);
 const foreign=Buffer.from(system);foreign.writeUInt32LE(0x01000007,4);writeFileSync(join(dir,'libbundled.dylib'),foreign);assert.throws(()=>macNativeReport(dir),/arm64/);
});
test('Mac Python redistribution retains each exact archive notice under a unique path',()=>{
 const root=new URL('../docs/licenses/macos-python-3.12.13/',import.meta.url),provenance=JSON.parse(readFileSync(new URL('PROVENANCE.json',root),'utf8'));
 assert.equal(new Set(provenance.notices.map(n=>n.file)).size,provenance.notices.length);
 for(const notice of provenance.notices){assert(!notice.file.startsWith('/')&&!notice.file.split('/').includes('..'));const bytes=readFileSync(new URL(notice.file,root));assert.equal(bytes.length,notice.bytes);assert.equal(digest(bytes),notice.sha256,notice.file);}
});
test('native resource copy materializes internal library links and rejects external/cyclic links',t=>{
 if(process.platform==='win32'){t.skip('POSIX link preparation; native Apple Silicon source checks also exercise this.');return;}
 const root=mkdtempSync(join(tmpdir(),'bambi-native-copy-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'source');mkdirSync(source);writeFileSync(join(source,'lib.dylib'),'reviewed native bytes');symlinkSync('lib.dylib',join(source,'alias.dylib'));
 const target=join(root,'received');copyResolvedNativeTree(source,target);assert(!lstatSync(join(target,'alias.dylib')).isSymbolicLink());assert.equal(readFileSync(join(target,'alias.dylib'),'utf8'),'reviewed native bytes');
 writeFileSync(join(root,'external'),'host-only bytes');symlinkSync('../external',join(source,'outside'));assert.throws(()=>copyResolvedNativeTree(source,join(root,'bad')),/escapes source/);rmSync(join(source,'outside'));
 symlinkSync('.',join(source,'loop'));assert.throws(()=>copyResolvedNativeTree(source,join(root,'cycle')),/cycle/);
});
