// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import * as ort from 'onnxruntime-web/wasm';
import {Silero} from '@ricky0123/vad-web/dist/models/silero';
import {SpeechDetector} from './detector';
import type {DetectorCommand,DetectorReply} from './detector-client';

const scope=globalThis as unknown as {onmessage:((event:MessageEvent<DetectorCommand>)=>void)|null;postMessage(message:DetectorReply):void};
async function start(){
 ort.env.wasm.wasmPaths='/vad/';ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.logLevel='error';
 const model=await Silero.new(ort,async()=>{
  const response=await fetch('/vad/silero_vad_v5.onnx');
  if(!response.ok)throw Error('Could not load local speech detection.');
  return response.arrayBuffer();
 });
 let epoch=0;
 const detector=new SpeechDetector(model,event=>scope.postMessage({type:'event',epoch,event}),error=>scope.postMessage({type:'error',message:String(error)}));
 scope.onmessage=({data})=>{
  if(data.type==='configure'){detector.configure(data.sensitivity,data.silenceMs);return;}
  if(data.type==='reset'){epoch=data.epoch;detector.reset();return;}
  if(data.epoch!==epoch)return;
  detector.push(data.data,data.rate);
  scope.postMessage({type:'accepted',epoch,durationMs:data.durationMs});
 };
 scope.postMessage({type:'ready'});
}
void start().catch(error=>scope.postMessage({type:'error',message:error instanceof Error?error.message:'Could not load local speech detection.'}));
