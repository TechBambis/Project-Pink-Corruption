// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,open,readFile,rm,symlink,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ModelSources} from '../packages/runtime/model-sources';
import {localModelCatalog} from '../packages/ai/model-catalog';
const pin=localModelCatalog.find(model=>model.desktopSupported)!;
test('chosen files and nested repository folders persist, deduplicate and can be forgotten without touching originals',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bambi-sources-'));t.after(()=>rm(root,{recursive:true,force:true}));const profile=join(root,'profile'),folder=join(root,'another-repository'),nested=join(folder,'models/community');await mkdir(nested,{recursive:true});
 const file=join(nested,'renamed.gguf'),handle=await open(file,'w');await handle.truncate(pin.bytes);await handle.close(); // Sparse metadata fixture, not model weights.
 const sources=new ModelSources(profile),id=await sources.add(file,'file');assert.equal(await sources.add(file,'file'),id);const directoryId=await sources.add(folder,'folder');
 const reopened=new ModelSources(profile),entries=await reopened.list();assert.equal(entries.length,2);assert.deepEqual(entries[1].models,[pin.alias]);assert.equal((await reopened.find(directoryId,pin.alias)).modelFile,file);
 await reopened.remove(id);assert.equal((await new ModelSources(profile).list()).length,1);assert.equal((await lstat(file)).size,pin.bytes);
 await assert.rejects(()=>reopened.find(id,pin.alias),/saved model location/);
 const persisted=JSON.parse(await readFile(join(profile,'model-sources.json'),'utf8'));assert.equal(persisted[0].path,folder);
});
test('unknown quantizations, unchosen paths and links outside a registered folder are not import candidates',async t=>{
 const root=await mkdtemp(join(tmpdir(),'bambi-sources-boundary-'));t.after(()=>rm(root,{recursive:true,force:true}));const folder=join(root,'chosen');await mkdir(folder);const foreign=join(root,'foreign.gguf'),handle=await open(foreign,'w');await handle.truncate(pin.bytes);await handle.close();await symlink(foreign,join(folder,'escape.gguf'));
 await writeFile(join(folder,'unknown.gguf'),'GGUF-unreviewed');const sources=new ModelSources(join(root,'profile')),id=await sources.add(folder,'folder');assert.deepEqual((await sources.list())[0].models,[]);await assert.rejects(()=>sources.find(id,pin.alias),/No matching catalog file/);await assert.rejects(()=>sources.add(join(folder,'unknown.gguf'),'folder'),/model folder/);
});
