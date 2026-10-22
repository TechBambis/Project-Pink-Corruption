// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modelProgress,type SetupState} from '../apps/web/src/model-progress';
import {isAppAudioOrigin} from '../packages/audio/app-origin';
import {gpuProbeCommands,parseWindowsGPUs} from '../packages/hardware';
const state:SetupState={phase:'downloading',model:'chosen',completed:2e9,total:5e9,verified:false,operation:'download',stage:'transferring',updatedAt:1000};
test('progress separates selection, bytes, verification and missing speech instead of implying idle setup is downloading',()=>{
 assert.equal(modelProgress(null,'chosen','Model').title,'Download has not started');
 assert.equal(modelProgress(state,'different','Other model').ratio,0);
 const downloading=modelProgress(state,'chosen','Model',2000,10e6);assert.equal(downloading.ratio,.4);assert.match(downloading.detail,/40%.*10.0 MB\/s.*5 min/);
 const checking=modelProgress({...state,stage:'checking-file',assetCompleted:3e9,assetTotal:5e9},'chosen','Model');assert.equal(checking.ratio,.6);assert.equal(checking.title,'Checking model files');assert(!checking.detail.includes('MB/s'));
 assert.match(modelProgress({...state,phase:'partial',remainingBytes:100e6},'chosen','Model').detail,/remaining 100.0 MB/);
 assert.match(modelProgress({...state,phase:'installed',verified:true},'chosen','Model').detail,/No download is running/);
 assert.equal(modelProgress({...state,phase:'preparing'},'chosen','Model').ratio,null);
});
test('a stalled transfer explains the wait while checksum work is not mislabeled as a network stall',()=>{
 assert.match(modelProgress(state,'chosen','Model',41000).detail,/No new data for 40 seconds/);
 assert(!modelProgress({...state,stage:'checking-file'},'chosen','Model',41000).detail.includes('No new data'));
});

test('a missing publisher license is explained as a setup file rather than a voice-only download',()=>{
 const progress=modelProgress({...state,phase:'partial',missing:['community/LFM2.5-LICENSE.txt'],remainingBytes:10596},'chosen','Model');
 assert.match(progress.title,/setup files still needed/);assert.match(progress.detail,/license notice/);
 assert.match(modelProgress({...state,phase:'partial',missing:['voice/model.onnx']},'chosen','Model').title,/voice files still needed/);
});
test('ready files or missing runtime metadata do not establish GPU processing',()=>{
 assert.match(modelProgress({...state,phase:'ready'},'chosen','Model').detail,/not been confirmed/);
 assert.match(modelProgress({...state,phase:'ready',runtime:{phase:'ready',ready:true,backend:'cpu'}},'chosen','Model').detail,/CPU/);
 assert.match(modelProgress({...state,phase:'ready',runtime:{phase:'ready',ready:true,backend:'vulkan',deviceName:'Test GPU'}},'chosen','Model').detail,/GPU.*Test GPU/);
});
test('Windows probes use absolute system paths even in the restricted desktop PATH; AMD identity does not invent VRAM',()=>{
 const commands=gpuProbeCommands('win32',{SystemRoot:'D:\\Windows',PATH:'D:\\Bambi\\node'});
 assert.equal(commands.powershell,'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert.equal(commands.nvidia,'D:\\Windows\\System32\\nvidia-smi.exe');
 assert.match(commands.script,/Get-CimInstance/);assert.match(commands.script,/Get-PnpDevice/);
 const cards=parseWindowsGPUs('[{"Name":"AMD Radeon RX 7900 XTX","AdapterRAM":4294967295},{"Name":"AMD Radeon Graphics"}]');assert.equal(cards.length,2);assert.equal(cards[0].memoryTotal,null);
 assert.equal(gpuProbeCommands('linux').nvidia,'nvidia-smi');
});
test('packaged audio can load on any app loopback port without loading recordings in third-party extension pages',()=>{
 for(const origin of ['http://127.0.0.1:6969','http://127.0.0.1:16969','http://localhost:17969','http://[::1]:9999'])assert(isAppAudioOrigin(origin,true));
 for(const origin of ['https://example.com','http://127.0.0.1.evil:6969','file://','invalid'])assert(!isAppAudioOrigin(origin,true));
 assert(!isAppAudioOrigin('http://127.0.0.1:16969',false));
});
