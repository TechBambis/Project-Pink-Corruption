// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';

const uuid=z.string().uuid();
export function playlistIdFromUrl(raw:string){
 try{const u=new URL(raw);if(u.protocol!=='https:'||!['bambicloud.com','www.bambicloud.com'].includes(u.hostname)||u.port||u.username||u.password)return null;
  const match=u.pathname.match(/^\/playlist\/([a-f0-9-]{36})\/?$/i);return match&&uuid.safeParse(match[1]).success?match[1].toLowerCase():null;
 }catch{return null;}
}
export function allowedBambiCloudAudioUrl(raw:string){
 try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='cdn.bambicloud.com'&&!u.port&&!u.username&&!u.password&&!u.hash;}catch{return false;}
}
export const BambiCloudTrackSchema=z.object({
 playlistId:uuid,playlistTitle:z.string().max(500),fileId:uuid,title:z.string().max(500),author:z.string().max(160),
 durationMs:z.number().finite().nonnegative(),url:z.string().max(4000).refine(allowedBambiCloudAudioUrl).nullable(),locked:z.boolean(),
 cueUrl:z.string().max(4000).refine(allowedBambiCloudAudioUrl).nullable().optional(),
 triggers:z.array(z.string().max(160)).max(200).optional(),warnings:z.array(z.string().max(500)).max(200).optional(),
 hypnosisType:z.string().max(160).nullable().optional(),
}).strict().refine(t=>!t.locked||t.url===null&&!t.cueUrl);
export type BambiCloudTrack=z.infer<typeof BambiCloudTrackSchema>;
export interface BambiCloudPlaylist{id:string;title:string;author:string;tracks:BambiCloudTrack[]}
export function bambiCloudTrackId(track:BambiCloudTrack){return `bambicloud:${track.playlistId}:${track.fileId}`;}

/** Normalize public API metadata. Never expose a private or membership-gated audio URL. */
export function parseBambiCloudPlaylist(data:unknown,id:string):BambiCloudPlaylist{
 const person=z.object({username:z.string().max(160).nullish()}).passthrough().nullish();
 const source=z.object({playlists:z.array(z.object({uuid,name:z.string().max(500),isPublic:z.boolean(),creator:person,
  files:z.array(z.object({uuid,name:z.string().max(500),isPublic:z.boolean(),duration:z.number().finite().nonnegative().nullish(),
   author:person,audioURL:z.string().max(4000).nullish(),patreonTiers:z.array(z.unknown()).nullish(),hapticsURL:z.string().max(4000).nullish(),
   triggers:z.array(z.object({name:z.string().max(160)}).passthrough()).max(200).nullish(),
   warnings:z.array(z.object({name:z.string().max(500)}).passthrough()).max(200).nullish(),hypnosisType:z.string().max(160).nullish(),
  }).passthrough()).max(500),
 }).passthrough()).max(100)}).passthrough().parse(data);
 const playlist=source.playlists.find(p=>p.uuid.toLowerCase()===id.toLowerCase());
 if(!playlist||!playlist.isPublic)throw Error('Playlist is not public or could not be found.');
 const author=playlist.creator?.username??'';
 return {id:playlist.uuid,title:playlist.name,author,tracks:playlist.files.map(f=>{
  const locked=!!f.patreonTiers?.length;
  return BambiCloudTrackSchema.parse({playlistId:playlist.uuid,playlistTitle:playlist.name,fileId:f.uuid,title:f.name,
   author:f.author?.username??author,durationMs:f.duration??0,locked,url:!locked&&f.isPublic&&f.audioURL&&allowedBambiCloudAudioUrl(f.audioURL)?f.audioURL:null,
   cueUrl:!locked&&f.isPublic&&f.hapticsURL&&allowedBambiCloudAudioUrl(f.hapticsURL)?f.hapticsURL:null,
   triggers:f.triggers?.map(t=>t.name)??[],warnings:f.warnings?.map(w=>w.name)??[],hypnosisType:f.hypnosisType??null});
 })};
}

// The currently observed haptics file is a timed trigger list, not actuator commands.
const sourceCueSchema=z.object({start:z.number().finite().nonnegative(),stop:z.number().finite().nonnegative().nullish(),trigger:z.string().trim().min(1).max(160),snap:z.boolean().optional()}).strip();
function usableCueEnd(c:{start:number;stop?:number|null}){return c.stop!=null&&c.stop>=c.start&&c.stop-c.start<=60000;}
// Keep the source start authoritative. Invalid/missing ends affect text display only.
export const BambiCloudCueSchema=sourceCueSchema.transform(c=>({...c,stop:usableCueEnd(c)?c.stop!:c.start+300}));
export type BambiCloudCue=z.infer<typeof BambiCloudCueSchema>;
export function parseBambiCloudCueFile(data:unknown){
 const entries=z.array(z.unknown()).max(10000).parse(data),cues:BambiCloudCue[]=[];let skipped=0,adjustedEnds=0;
 for(const entry of entries){const parsed=sourceCueSchema.safeParse(entry);if(!parsed.success){skipped++;continue;}
  if(!usableCueEnd(parsed.data))adjustedEnds++;cues.push(BambiCloudCueSchema.parse(parsed.data));
 }
 if(entries.length&&!cues.length)throw Error('No usable timed trigger cues.');
 return {cues:cues.sort((a,b)=>a.start-b.start),skipped,adjustedEnds};
}
export function parseBambiCloudCues(data:unknown){return parseBambiCloudCueFile(data).cues;}

/** Follow media time. Late cues and cues skipped by a seek never catch up in a burst. */
export class BambiCloudCuePlayback{
 private cues:BambiCloudCue[]=[];private cursor=0;
 load(cues:BambiCloudCue[],seconds=0){this.cues=cues;this.seek(seconds);}
 seek(seconds:number){this.cursor=this.cues.findIndex(c=>c.start>=seconds*1000);if(this.cursor<0)this.cursor=this.cues.length;}
 tick(seconds:number){const now=seconds*1000,due:BambiCloudCue[]=[];while(this.cursor<this.cues.length&&this.cues[this.cursor].start<=now){const cue=this.cues[this.cursor++];if(now-cue.start<=150)due.push(cue);}return due;}
}
