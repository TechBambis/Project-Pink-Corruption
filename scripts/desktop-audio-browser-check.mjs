// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Real browser PCM check on desktop loopback ports; no physical speaker qualification.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({stdin:{contents:"export {TickEngine} from './packages/audio/tick.ts';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'browser'});
const tick=readFileSync(new URL('../assets/sounds/tick_main.wav',import.meta.url));
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
 else if(req.url==='/assets/sounds/tick_main.wav'){res.setHeader('Content-Type','audio/wav');res.end(tick);}
 else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="bambi-app" content="bambi-local"><title>Isolated desktop audio fixture</title>');}
 else{res.writeHead(404);res.end();}
});
let browser;
try{
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;assert.notEqual(port,6969);
 browser=await chromium.launch({headless:true,...(process.env.BAMBI_BROWSER_BINARY?{executablePath:process.env.BAMBI_BROWSER_BINARY}:{})});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${port}/`);
 const records=await page.evaluate(async()=>{
  const {TickEngine}=await import('/fixture.js'),records=[];
  for(const rate of [44100,48000]){
   const context=new OfflineAudioContext(1,rate*4,rate),engine=new TickEngine(context,context.destination);await engine.init();engine.apply({type:'tick',operation:'on',bpm:60},.1);
   const output=await context.startRendering(),pcm=output.getChannelData(0),onsets=[];let active=false;
   for(let i=0;i<pcm.length;i++){const audible=Math.abs(pcm[i])>.001;if(audible&&!active){if(!onsets.length||i/rate-onsets.at(-1)>.2)onsets.push(i/rate);}active=audible;}
   records.push({rate,source:engine.events[0].source,bpm:engine.events[0].bpm,interval:engine.events[0].interval,onsets});engine.stop();
  }
  document.querySelector('meta[name="bambi-app"]').remove();const context=new OfflineAudioContext(1,44100,44100),fallback=new TickEngine(context,context.destination);await fallback.init();fallback.apply({type:'tick',operation:'on',bpm:60},.1);records.push({source:fallback.events[0].source,unmarked:true});fallback.stop();
  return records;
 });
 for(const record of records.filter(value=>!value.unmarked)){assert.equal(record.source,'asset');assert.equal(record.bpm,60);assert.equal(record.interval,1);assert.equal(record.onsets.length,4);for(let i=1;i<record.onsets.length;i++)assert(Math.abs(record.onsets[i]-record.onsets[i-1]-1)<=2/record.rate);}
 assert.equal(records.at(-1).source,'generated');console.log('Passed: packaged tick asset loads on a non-default desktop port; rendered PCM keeps 60 BPM at 44.1 and 48 kHz; unmarked extension pages retain the generated fallback. '+JSON.stringify(records));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
