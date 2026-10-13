// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,open,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {localModelCatalog,downloadableModel,modelAsset,modelAssets,canDownloadModel} from '../packages/ai/model-catalog';
import {modelInventory} from '../packages/ai/model-inventory';
import {recommendModels} from '../packages/ai/recommendation';
import {baseHardwareProfile} from '../packages/hardware';
import {DesktopSetup,alphaModels} from '../packages/runtime/desktop-setup';
import {communityQwen,communityQwen2B,liquidSmall,communityQwen4B,communityQwen4BMtp,communityQwen4BMtpBaseline,communityQwen36,defiantFable,anubisMiniV1,nativeCheckpointModel,modelContext,nativeModelSampling,modelRuntimeInfo} from '../packages/ai/models';
import {modelConnection,buildChatRequest} from '../packages/ai/request';
const GiB=2**30;

test('catalog includes pinned comparison models and preserves the qualified default asset',()=>{
 const models=modelInventory({models:[]},{desktop:true,verified:false});
 assert.equal(models.length,11);assert(models.some(model=>model.id===anubisMiniV1));
 assert.deepEqual(modelAsset(communityQwen),alphaModels.assets[0]);
 for(const model of localModelCatalog)if(model.desktopSupported){assert.equal(model.context,24576);assert(canDownloadModel(model));assert(['apache-2.0','lfm1.0'].includes(downloadableModel(model.alias).license!));}
 assert.throws(()=>modelAsset('https://example.invalid/arbitrary-model'));
 assert.throws(()=>modelAsset(anubisMiniV1));
});
test('MTP on and off are manual native choices sharing one pinned export, full context and character contracts',async()=>{
 const on=localModelCatalog.find(model=>model.alias===communityQwen4BMtp)!,off=localModelCatalog.find(model=>model.alias===communityQwen4BMtpBaseline)!;
 for(const key of ['repo','revision','file','bytes','sha256'] as const)assert.equal(on[key],off[key]);
 assert.equal(on.sha256,'1443de63a550a7bd18905589dcebfa5c307da8b2ef86db858a7691fb9a3c15cc');
 assert.equal(on.bytes,2788710496);assert.equal(on.desktopSupported,false);
 const pins=JSON.parse(await readFile('docs/comparison-models.json','utf8'));
 assert.deepEqual(pins.find((pin:any)=>pin.alias===on.alias).runtime.speculative,{type:'draft-mtp',draft_tokens:3});
 assert.equal(pins.find((pin:any)=>pin.alias===off.alias).runtime.speculative,undefined);
 for(const model of [on.alias,off.alias]){
  assert.deepEqual(modelConnection(model,'bambisleep-classic'),{backend:'llama.cpp',context:24576});
  assert.equal(nativeCheckpointModel(model),true);
  assert.deepEqual(nativeModelSampling(model,'qwen'),nativeModelSampling(communityQwen4B,'qwen'));
  const request=buildChatRequest({type:'chat',text:'Public question',model,promptId:'bambisleep-classic',collar:true,collarName:'Chosen collar'});
  assert.equal(request.promptId,'bambisleep-classic');assert.equal(request.context,24576);assert.equal(request.collarName,'Chosen collar');
 }
 assert.equal(modelRuntimeInfo(on.alias)?.mtp,true);assert.equal(modelRuntimeInfo(off.alias)?.mtp,false);
 assert.equal(buildChatRequest({type:'chat',text:'Public question'}).model,communityQwen);
});
test('desktop recommendation respects actual runtime availability and excludes unsupported alternatives',()=>{
 const candidates=modelInventory({models:[]},{desktop:true});
 const pc=baseHardwareProfile('win32','x64','CPU',12,16*GiB,12*GiB);
 const result=recommendModels(pc,candidates,{native:true,ollama:false,platformReady:true});
 assert.equal(result.recommended?.id,communityQwen4B);assert.equal(result.recommended?.runtime,'setup-needed');
 assert.equal(result.alternatives.find(model=>model.id===communityQwen36)?.memoryFit,'too-large');
 const small=recommendModels({...pc,ramTotal:8*GiB,ramAvailable:6*GiB},candidates,{native:true,ollama:false,platformReady:true});
 assert.equal(small.recommended?.id,communityQwen2B);assert.equal(small.recommended?.resourcePlan.mode,'compact');
});
test('experimental 4B retains full native context, sampling and checkpoint layout while preserving the 9B default',()=>{
 const pin=downloadableModel(communityQwen4B),asset=modelAsset(communityQwen4B);
 assert.equal(pin.qualification,'experimental');assert.equal(pin.bytes,2707513696);
 assert.equal(asset.sha256,'79e28ecacf84e75b6056cf4059636d435aa9eb67795780f7b7dbc7d32a962741');
 assert.deepEqual(modelConnection(communityQwen4B,'custom'),{backend:'llama.cpp',context:24576});
 assert.equal(modelContext(communityQwen4B,'bambisleep-classic'),24576);assert.equal(nativeCheckpointModel(communityQwen4B),true);
 assert.deepEqual(nativeModelSampling(communityQwen4B,'qwen'),nativeModelSampling(communityQwen,'qwen'));
 assert.equal(buildChatRequest({type:'chat',text:'Public question',model:communityQwen4B}).context,24576);
 assert.equal(buildChatRequest({type:'chat',text:'Public question'}).model,communityQwen);
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

test('small models use their own pinned sampling and verified license assets with full native context',()=>{
 for(const alias of [communityQwen2B,liquidSmall]){
  assert.deepEqual(modelConnection(alias,'bambisleep-classic'),{backend:'llama.cpp',context:24576});
  assert.equal(nativeCheckpointModel(alias),true);
  const sampler=nativeModelSampling(alias,'qwen');
  assert.equal(sampler.xtc_probability,0);assert.equal(sampler.dry_multiplier,0);
 }
 assert.equal(nativeModelSampling(communityQwen2B,'qwen').temperature,.7);
 assert.equal(nativeModelSampling(liquidSmall,'qwen').temperature,.1);
 assert.equal(nativeModelSampling(liquidSmall,'qwen').repeat_penalty,1.05);
 const assets=modelAssets(liquidSmall),pin=downloadableModel(liquidSmall);
 assert.equal(assets.length,2);assert.equal(assets[1].path,'community/LFM2.5-LICENSE.txt');
 assert.equal(assets[1].sha256,pin.licenseNotice?.sha256);assert(assets[1].url.includes(pin.revision));
 assert.equal(canDownloadModel({...pin,licenseNotice:undefined}),false);
 assert.equal(canDownloadModel({...pin,license:'unknown-license'}),false);
});

test('the retained LiquidAI license is the exact pinned upstream notice',async()=>{
 const asset=modelAssets(liquidSmall)[1],bytes=await readFile('docs/licenses/lfm-open-v1/LICENSE.txt');
 assert.equal(bytes.length,asset.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
});

test('all comparable catalog models have the same complete native context, while discovered files remain unverified',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bambi-comparison-files-'));
 try{
  const eligible=localModelCatalog.filter(canDownloadModel);assert.equal(eligible.length,6);
  for(const pin of eligible)assert.equal(modelContext(pin.alias,'bambisleep-classic'),pin.context);
  const pin=downloadableModel(communityQwen36);await mkdir(join(root,'community'));const path=join(root,'community',pin.file),file=await open(path,'w');try{await file.truncate(pin.bytes);}finally{await file.close();}
  const entry=modelInventory({models:[]},{desktop:true,directory:root,verified:false}).find(item=>item.id===pin.alias)!;
  assert.equal(entry.availableForComparison,true);assert.equal(entry.installed,false);assert.equal(entry.promptCompatible,true);
  const target=join(root,'target.gguf');const {rename}=await import('node:fs/promises');await rename(path,target);await symlink(target,path);
  assert.equal(modelInventory({models:[]},{desktop:true,directory:root}).find(item=>item.id===pin.alias)?.availableForComparison,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
