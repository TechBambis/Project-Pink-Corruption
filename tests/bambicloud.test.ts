// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {bambiCloudRouter} from '../apps/server/bambicloud';
import {playlistIdFromUrl,allowedBambiCloudAudioUrl,parseBambiCloudPlaylist,parseBambiCloudCues,parseBambiCloudCueFile,BambiCloudCuePlayback} from '../packages/media/bambicloud';
const id='ff15f538-6e6b-433c-b68b-b4af5ee5d14d',fileId='c0effdad-6002-4269-a982-479d676c8d46';
const publicFile={uuid:fileId,name:'Fixture track',isPublic:true,duration:10000,audioURL:'https://cdn.bambicloud.com/fixture.mp3',patreonTiers:null};
const payload=(files:unknown[]=[publicFile],isPublic=true)=>({playlists:[{uuid:id,name:'Fixture playlist',isPublic,creator:{username:'Fixture'},files}]});
test('source cues retain unknown full names and snap metadata without prescribing audio actions',()=>{
 const cues=parseBambiCloudCues([{start:0,trigger:'Bambi eyes lock',snap:true},{start:1,trigger:'Unknown future cue'},{start:2,trigger:'Shut pink box'}]);
 assert.deepEqual(cues.map(c=>c.trigger),['Bambi eyes lock','Unknown future cue','Shut pink box']);
 assert.equal(cues[0].snap,true);
});

async function serve(fetcher:typeof fetch){const app=express();app.use(bambiCloudRouter(fetcher));const server=app.listen(0,'127.0.0.1');await once(server,'listening');return {base:`http://127.0.0.1:${(server.address() as any).port}`,close:()=>new Promise<void>(r=>server.close(()=>r()))};}
test('public metadata handles null tiers and never exposes private, locked or foreign audio',()=>{
 assert.equal(playlistIdFromUrl('https://bambicloud.com/playlist/'+id),id);
 for(const url of ['http://bambicloud.com/playlist/'+id,'https://bambicloud.com.attacker.test/playlist/'+id,'https://user@bambicloud.com/playlist/'+id,'https://bambicloud.com/playlist/not-a-uuid'])assert.equal(playlistIdFromUrl(url),null);
 const p=parseBambiCloudPlaylist(payload([publicFile,{...publicFile,patreonTiers:[{}]},{...publicFile,isPublic:false},{...publicFile,audioURL:'https://localhost/internal'}]),id);
 assert.deepEqual(p.tracks.map(t=>t.url),[publicFile.audioURL,null,null,null]);assert.equal(p.tracks[1].locked,true);
 assert.throws(()=>parseBambiCloudPlaylist(payload([],false),id),/not public/);
 for(const url of ['http://cdn.bambicloud.com/a','https://cdn.bambicloud.com:444/a','https://cdn.bambicloud.com.attacker.test/a','https://user@cdn.bambicloud.com/a'])assert.equal(allowedBambiCloudAudioUrl(url),false);
});
test('playlist route uses the fixed upstream API and rejects invalid URLs before any network call',async()=>{
 const calls:string[]=[];const server=await serve(async(url,options)=>{calls.push(String(url));assert.equal(options?.redirect,'manual');return Response.json(payload());});
 try{let r=await fetch(server.base+'/playlist?url='+encodeURIComponent('https://localhost/private'));assert.equal(r.status,400);assert.equal(calls.length,0);
  r=await fetch(server.base+'/playlist?url='+encodeURIComponent('https://bambicloud.com/playlist/'+id));assert.equal(r.status,200);assert.equal((await r.json()).tracks[0].url,publicFile.audioURL);assert.deepEqual(calls,['https://api.bambicloud.com/playlists?uuid='+id]);
 }finally{await server.close();}
});
test('stream forwards a single Range and seek headers, but never external cookies',async()=>{
 const server=await serve(async(_url,options)=>{assert.equal(new Headers(options?.headers).get('range'),'bytes=0-15');return new Response(new Uint8Array(16),{status:206,headers:{'content-type':'audio/mpeg','content-length':'16','content-range':'bytes 0-15/100','accept-ranges':'bytes','set-cookie':'foreign=secret'}});});
 try{const r=await fetch(server.base+'/stream?url='+encodeURIComponent(publicFile.audioURL),{headers:{Range:'bytes=0-15'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 0-15/100');assert.equal(r.headers.get('accept-ranges'),'bytes');assert.equal(r.headers.get('set-cookie'),null);assert.equal((await r.arrayBuffer()).byteLength,16);
 }finally{await server.close();}
});
test('stream rejects hostile URLs and ranges; off-host redirects are not followed',async()=>{
 let calls=0;const server=await serve(async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/internal'}});});
 try{for(const [url,range] of [['http://127.0.0.1/internal','bytes=0-15'],[publicFile.audioURL,'bytes=0-1,3-4']]){const r=await fetch(server.base+'/stream?url='+encodeURIComponent(url),{headers:{Range:range}});assert.equal(r.status,400);}assert.equal(calls,0);
  const r=await fetch(server.base+'/stream?url='+encodeURIComponent(publicFile.audioURL));assert.equal(r.status,502);assert.equal(calls,1);
 }finally{await server.close();}
});
test('oversized playlist response is cancelled rather than accumulated',async()=>{
 let cancelled=false;const server=await serve(async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
 try{const r=await fetch(server.base+'/playlist?url='+encodeURIComponent('https://bambicloud.com/playlist/'+id));assert.equal(r.status,502);assert.equal(cancelled,true);}finally{await server.close();}
});
test('metadata preserves playlist order, trigger names and content notes; locked cues stay inaccessible',()=>{
 const file={...publicFile,hapticsURL:'https://cdn.bambicloud.com/cues.json',triggers:[{name:'Good girl',trains:true}],warnings:[{name:'Fixture note'}],hypnosisType:'induction'};
 const tracks=parseBambiCloudPlaylist(payload([file,{...file,name:'Second',patreonTiers:[1]}]),id).tracks;
 assert.deepEqual(tracks.map(t=>t.title),['Fixture track','Second']);assert.deepEqual(tracks[0].triggers,['Good girl']);assert.deepEqual(tracks[0].warnings,['Fixture note']);assert.equal(tracks[0].cueUrl,file.hapticsURL);assert.equal(tracks[1].cueUrl,null);
});
test('timed cues reject invalid intervals and follow playback without bursts after stalls or seeks',()=>{
 const cues=parseBambiCloudCues([{start:2000,stop:2200,trigger:'Bambi sleep'},{start:1000,stop:1300,trigger:'Good girl',snap:true}]);
 assert.equal(parseBambiCloudCues([{start:10,stop:0,trigger:'x'}])[0].stop,310);assert.throws(()=>parseBambiCloudCues([{start:0,stop:1,trigger:' '}])) ;
 assert.equal(parseBambiCloudCues([{start:1000,trigger:'Good girl'}])[0].stop,1300,'Missing source ends receive only a short display duration');
 const player=new BambiCloudCuePlayback();player.load(cues);assert.deepEqual(player.tick(.99),[]);assert.equal(player.tick(1.04)[0].trigger,'Good girl');assert.deepEqual(player.tick(1.1),[]);
 assert.deepEqual(player.tick(3),[]);player.seek(0);assert.equal(player.tick(1.1).length,1);player.seek(2.1);assert.deepEqual(player.tick(2.11),[]);
});
test('cue endpoint returns validated timed metadata, never raw actuator commands',async()=>{
 const server=await serve(async()=>Response.json([{start:1000,stop:1300,trigger:'Good girl',vibration:100,snap:true}]));
 try{const r=await fetch(server.base+'/cues?url='+encodeURIComponent('https://cdn.bambicloud.com/cues.json'));assert.equal(r.status,200);assert.deepEqual(await r.json(),{cues:[{start:1000,stop:1300,trigger:'Good girl',snap:true}],skipped:0,adjustedEnds:0});}finally{await server.close();}
});
test('one damaged interval never rejects the remaining file or changes cue starts',()=>{
 const result=parseBambiCloudCueFile([{start:1000,stop:1500,trigger:'Good girl'},
  {start:2000,stop:1700,trigger:'Good girl',voice:'fg'},
  {start:3000,stop:104000,trigger:'Good girl'},
  {start:4000,trigger:'Bambi sleep'},
  {start:-100,stop:0,trigger:'Good girl'},null,{start:'5000',stop:5300,trigger:'Good girl'}]);
 assert.deepEqual(result.cues.map(c=>c.start),[1000,2000,3000,4000]);assert.deepEqual(result.cues.map(c=>c.stop),[1500,2300,3300,4300]);assert.equal(result.skipped,3);assert.equal(result.adjustedEnds,3);
 assert.throws(()=>parseBambiCloudCueFile({actions:[]}));assert.throws(()=>parseBambiCloudCueFile([{start:-1,trigger:'Good girl'}]));assert.throws(()=>parseBambiCloudCueFile(Array(10001).fill(null)));
});
test('cue route keeps a valid file playable despite an inverted source interval',async()=>{
 const server=await serve(async()=>Response.json([{start:1000,stop:1500,trigger:'Good girl'},{start:2000,stop:1700,trigger:'Good girl'}]));
 try{const r=await fetch(server.base+'/cues?url='+encodeURIComponent('https://cdn.bambicloud.com/cues.json'));assert.equal(r.status,200);const file=await r.json();assert.equal(file.cues.length,2);assert.equal(file.cues[1].start,2000);assert.equal(file.cues[1].stop,2300);assert.equal(file.adjustedEnds,1);}finally{await server.close();}
});
