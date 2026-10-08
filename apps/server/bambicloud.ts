// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {Router} from 'express';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {allowedBambiCloudAudioUrl,parseBambiCloudPlaylist,parseBambiCloudCueFile,playlistIdFromUrl} from '../../packages/media/bambicloud';

const headers={'User-Agent':'BambiLocal/0.1','Accept':'application/json','Origin':'https://bambicloud.com','Referer':'https://bambicloud.com/'};
async function request(url:string,host:string,fetcher:typeof fetch,signal:AbortSignal,extra:Record<string,string>={}){
 for(let hop=0;hop<4;hop++){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!==host||u.port||u.username||u.password)throw Error('Unsupported upstream redirect.');
  const response=await fetcher(u,{headers:{...headers,...extra},redirect:'manual',signal});
  if(![301,302,303,307,308].includes(response.status))return response;
  await response.body?.cancel();const location=response.headers.get('location');if(!location)throw Error('Invalid upstream redirect.');url=new URL(location,u).href;
 }
 throw Error('Too many upstream redirects.');
}
async function limitedJson(response:Response){
 if(Number(response.headers.get('content-length'))>2*1024*1024){await response.body?.cancel();throw Error('Playlist response is too large.');}
 if(!response.body)throw Error('Empty playlist response.');
 const reader=response.body.getReader();let count=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>2*1024*1024)throw Error('Playlist response is too large.');chunks.push(value);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
 }finally{await reader.cancel().catch(()=>{});}
}

/** Optional, user-started public content import. No account credentials or disk media cache. */
export function bambiCloudRouter(fetcher:typeof fetch=fetch){
 const router=Router();
 router.get('/playlist',async(req,res)=>{
  const id=typeof req.query.url==='string'&&req.query.url.length<=2000?playlistIdFromUrl(req.query.url):null;
  if(!id){res.status(400).json({error:'Enter a https://bambicloud.com/playlist/… URL.'});return;}
  const controller=new AbortController();res.on('close',()=>controller.abort());
  try{
   const upstream=await request(`https://api.bambicloud.com/playlists?uuid=${id}`,'api.bambicloud.com',fetcher,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
   if(!upstream.ok){await upstream.body?.cancel();res.status(502).json({error:`BambiCloud returned HTTP ${upstream.status}. Try again later.`});return;}
   const data=await limitedJson(upstream);let playlist;
   try{playlist=parseBambiCloudPlaylist(data,id);}catch{res.status(404).json({error:'No public playlist with supported tracks was found.'});return;}
   res.json(playlist);
  }catch{if(!res.headersSent&&!controller.signal.aborted)res.status(502).json({error:'BambiCloud is unavailable or returned an unsupported playlist. Try again later.'});}
 });
 router.get('/cues',async(req,res)=>{
  const url=req.query.url;if(typeof url!=='string'||url.length>4000||!allowedBambiCloudAudioUrl(url)){res.status(400).json({error:'Unsupported BambiCloud cue URL.'});return;}
  const controller=new AbortController();res.on('close',()=>controller.abort());
  try{const response=await request(url,'cdn.bambicloud.com',fetcher,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
   if(!response.ok){await response.body?.cancel();throw Error('Cues unavailable.');}
   res.json(parseBambiCloudCueFile(await limitedJson(response)));
  }catch{if(!res.headersSent&&!controller.signal.aborted)res.status(502).json({error:'Timed cues are unavailable or use an unsupported format. Original audio can still play.'});}
 });
 router.get('/stream',async(req,res)=>{
  const url=req.query.url;if(typeof url!=='string'||url.length>4000||!allowedBambiCloudAudioUrl(url)){res.status(400).json({error:'Unsupported BambiCloud audio URL.'});return;}
  const range=req.headers.range;
  if(range&&(!/^bytes=(?:\d+-\d*|-\d+)$/.test(range)||range.length>70)){res.status(400).json({error:'Unsupported byte range.'});return;}
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),30000);timer.unref();};refresh();
  res.on('close',()=>controller.abort());
  try{
   const upstream=await request(url,'cdn.bambicloud.com',fetcher,controller.signal,{Accept:'audio/*',...(range?{Range:range}:{})});
   if(upstream.status===416){const value=upstream.headers.get('content-range');if(value)res.setHeader('Content-Range',value);await upstream.body?.cancel();res.status(416).end();return;}
   const contentType=upstream.headers.get('content-type')??'application/octet-stream';
   if(![200,206].includes(upstream.status)||!upstream.body||(!contentType.startsWith('audio/')&&!contentType.startsWith('application/octet-stream'))){await upstream.body?.cancel();res.status(502).json({error:'BambiCloud audio is unavailable.'});return;}
   const max=1024*1024*1024;if(Number(upstream.headers.get('content-length'))>max){await upstream.body.cancel();res.status(502).json({error:'Audio response exceeds the streaming limit.'});return;}
   res.status(upstream.status);for(const name of ['content-type','content-length','content-range','accept-ranges']){const value=upstream.headers.get(name);if(value)res.setHeader(name,value);}
   let bytes=0;refresh();
   const limiter=new Transform({transform(chunk,_encoding,done){refresh();bytes+=chunk.length;done(bytes>max?Error('Streaming limit exceeded.'):null,chunk);}});
   await pipeline(Readable.fromWeb(upstream.body as any),limiter,res,{signal:controller.signal});
  }catch{if(!res.headersSent&&!res.destroyed&&!controller.signal.aborted)res.status(502).json({error:'BambiCloud audio stream was interrupted.'});else if(!res.destroyed)res.destroy();}
  finally{clearTimeout(timer!);controller.abort();}
 });
 return router;
}
