// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localModelCatalog,downloadableModel,modelAsset} from '../packages/ai/model-catalog';
import {modelInventory} from '../packages/ai/model-inventory';
import {recommendModels} from '../packages/ai/recommendation';
import {baseHardwareProfile} from '../packages/hardware';
import {DesktopSetup,alphaModels} from '../packages/runtime/desktop-setup';
import {communityQwen,communityQwen36,defiantFable,anubisMiniV1} from '../packages/ai/models';
const GiB=2**30;

test('catalog includes all six pinned comparison models and preserves the qualified default asset',()=>{
 const models=modelInventory({models:[]},{desktop:true,verified:false});
 assert.equal(models.length,6);assert(models.some(model=>model.id===anubisMiniV1));
 assert.deepEqual(modelAsset(communityQwen),alphaModels.assets[0]);
 for(const model of localModelCatalog)if(model.desktopSupported){assert.equal(model.context,24576);assert.equal(downloadableModel(model.alias).license,'apache-2.0');}
 assert.throws(()=>modelAsset('https://example.invalid/arbitrary-model'));
 assert.throws(()=>modelAsset(anubisMiniV1));
});
test('desktop recommendation respects actual runtime availability and excludes unsupported alternatives',()=>{
 const candidates=modelInventory({models:[]},{desktop:true});
 const pc=baseHardwareProfile('win32','x64','CPU',12,16*GiB,12*GiB);
 const result=recommendModels(pc,candidates,{native:true,ollama:false,platformReady:true});
 assert.equal(result.recommended?.id,communityQwen);assert.equal(result.recommended?.runtime,'setup-needed');
 assert.equal(result.alternatives.find(model=>model.id===communityQwen36)?.memoryFit,'too-large');
 const small=recommendModels({...pc,ramTotal:8*GiB,ramAvailable:6*GiB},candidates,{native:true,ollama:false,platformReady:true});
 assert.equal(small.recommended,null);
});
test('persisted model switching retains previous assets and rejects changes during active setup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bambi-model-choice-'));
 try{
  const setup=new DesktopSetup(root,[],false);
  await setup.select(defiantFable);
  assert.equal(setup.model,defiantFable);assert.equal(setup.context,24576);assert.equal(setup.verified,false);
  assert.equal(JSON.parse(await readFile(join(root,'selected-model.json'),'utf8')).model,defiantFable);
  const reopened=new DesktopSetup(root,[],false);assert.equal(reopened.model,defiantFable);
  await assert.rejects(()=>setup.select(anubisMiniV1));assert.equal(setup.model,defiantFable);
  const check=setup.check();await assert.rejects(()=>setup.select(communityQwen),/cancel setup/);await check;
 }finally{await rm(root,{recursive:true,force:true});}
});
test('an installed short-context model is listed but not recommended for the full companion prompt',()=>{
 const candidates=modelInventory({models:[{name:'fluffy/l3-8b-stheno-v3.2:latest',size:4*GiB}]},{directory:'/nonexistent-model-fixture'});
 const model=candidates.find(candidate=>candidate.id==='fluffy/l3-8b-stheno-v3.2:latest');
 assert.equal(model?.installed,true);assert.equal(model?.promptCompatible,false);
 const result=recommendModels(baseHardwareProfile('linux','x64','CPU',8,12*GiB,10*GiB),candidates,{native:true,ollama:true});
 assert.notEqual(result.recommended?.id,model?.id);
});
