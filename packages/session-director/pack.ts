// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { z } from 'zod';
import { ActionSchema } from '../safety/actions';
import { parseTimelineJSON } from '../timeline/import';

const assetSchema=z.object({id:z.string().uuid(),name:z.string().min(1).max(120),mime:z.literal('audio/wav'),sha256:z.string().regex(/^[a-f0-9]{64}$/),data:z.string().max(24000000).regex(/^[A-Za-z0-9+/]*={0,2}$/),attribution:z.string().max(1000)}).strict();
const cueBase={id:z.string().uuid(),time:z.number().finite().min(0)};
const cueSchema=z.discriminatedUnion('type',[
 z.object({...cueBase,type:z.literal('speech'),text:z.string().min(1).max(1200),duration:z.number().finite().min(.1).max(600),assetId:z.string().uuid()}).strict(),
 z.object({...cueBase,type:z.literal('caption'),text:z.string().max(1000),duration:z.number().finite().min(.1).max(60)}).strict(),
 z.object({...cueBase,type:z.literal('action'),action:ActionSchema}).strict(),
]);
export const SessionPackSchema=z.object({format:z.literal('bambi-session'),version:z.literal(1),title:z.string().min(1).max(120),duration:z.number().finite().min(1).max(3600),created:z.string().datetime(),description:z.string().max(2000),seed:z.number().int().min(0).max(2147483647),requirements:z.literal('Web Audio; pre-rendered WAV; no live model required'),cues:z.array(cueSchema).max(500),assets:z.array(assetSchema).max(64)}).strict().superRefine((pack,context)=>{
 const ids=new Set<string>();let encodedBytes=0;
 for(const asset of pack.assets){if(ids.has(asset.id))context.addIssue({code:'custom',message:'Duplicate asset ID'});ids.add(asset.id);encodedBytes+=asset.data.length;}
 if(encodedBytes>32000000)context.addIssue({code:'custom',message:'Session audio exceeds the portable package limit'});
 const cues=new Set<string>();let speechEnd=0;
 for(const cue of [...pack.cues].sort((a,b)=>a.time-b.time)){
  if(cues.has(cue.id))context.addIssue({code:'custom',message:'Duplicate cue ID'});cues.add(cue.id);
  const duration='duration' in cue?cue.duration:cue.action.type==='silence'||cue.action.type==='visual'?cue.action.durationMs/1000:0;
  if(cue.time+duration>pack.duration)context.addIssue({code:'custom',message:'A cue extends beyond the session'});
  if(cue.type==='speech'){if(!ids.has(cue.assetId))context.addIssue({code:'custom',message:'Missing speech asset'});if(cue.time<speechEnd)context.addIssue({code:'custom',message:'Speech cues overlap'});speechEnd=cue.time+cue.duration;}
 }
});
export type SessionPack=z.infer<typeof SessionPackSchema>;
export function newSessionPack():SessionPack{return {format:'bambi-session',version:1,title:'A quiet little session',duration:300,created:new Date().toISOString(),description:'',seed:0,requirements:'Web Audio; pre-rendered WAV; no live model required',cues:[],assets:[]};}
export function assetBytes(asset:SessionPack['assets'][number]){return Uint8Array.from(atob(asset.data),char=>char.charCodeAt(0));}
export async function assetHash(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function verifySessionPack(raw:unknown){const pack=SessionPackSchema.parse(raw);for(const asset of pack.assets){const bytes=assetBytes(asset);if(bytes.length<44||String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||String.fromCharCode(...bytes.slice(8,12))!=='WAVE'||await assetHash(bytes)!==asset.sha256)throw Error('Invalid or changed session audio: '+asset.name);}return pack;}
/** Only allowlisted presentation actions and captions can leave a package. */
export function packTimeline(pack:SessionPack){return parseTimelineJSON(JSON.stringify(pack.cues.map(cue=>cue.type==='action'?{time:cue.time,action:cue.action}:{time:cue.time,type:'caption',text:cue.text.slice(0,1000),duration:Math.min(60,cue.duration)})),pack.duration);}
export function packTranscript(pack:SessionPack){return [...pack.cues].sort((a,b)=>a.time-b.time).filter(cue=>cue.type==='speech').map(cue=>`[${cue.time.toFixed(2)}] ${'text' in cue?cue.text:''}`).join('\n');}
