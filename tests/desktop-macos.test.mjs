// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertMachArm64,appPaths,ownedProcessIds} from '../scripts/desktop-macos-support.mjs';
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
