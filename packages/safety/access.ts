// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';

export const accessKeys=['microphone','devices','modelDownloads','onlineMedia','cloudAI','localClock','approximateLocation','contextToCloud'] as const;
export type AccessKey=typeof accessKeys[number];
export const AccessChoicesSchema=z.object({
 microphone:z.boolean(),devices:z.boolean(),modelDownloads:z.boolean(),onlineMedia:z.boolean(),
 cloudAI:z.boolean(),localClock:z.boolean(),approximateLocation:z.boolean(),contextToCloud:z.boolean(),
}).strict();
export type AccessChoices=z.infer<typeof AccessChoicesSchema>;
export const deniedAccess:AccessChoices=Object.fromEntries(accessKeys.map(key=>[key,false])) as AccessChoices;
/** First-run selections still require saving before they authorize any feature. */
export const defaultAccess:AccessChoices={...deniedAccess,microphone:true,devices:true,modelDownloads:true,onlineMedia:true,cloudAI:true,contextToCloud:true};
export const visibleAccessKeys=accessKeys.filter(key=>key!=='contextToCloud');
const placeText=z.string().trim().min(1).max(100).refine(text=>!/[\p{Cc}\p{Cf}]/u.test(text));
export const ApproximatePlaceSchema=z.object({city:placeText,region:placeText.optional(),country:placeText,source:z.literal('geojs-ip'),checkedAt:z.string().datetime()}).strict();
export type ApproximatePlace=z.infer<typeof ApproximatePlaceSchema>;
const RecordSchema=z.object({version:z.literal(1),configured:z.boolean(),choices:AccessChoicesSchema,place:ApproximatePlaceSchema.nullable()}).strict();
export type AccessRecord=z.infer<typeof RecordSchema>;
interface AccessStore{get(key:string,fallback:unknown):unknown;set(key:string,value:unknown):void}
export class AccessDeniedError extends Error{
 constructor(readonly permission:AccessKey){super(`Allow ${permission} in Privacy & access before using this feature.`);}
}

/** App feature gates, not an operating-system sandbox. Ordinary preference saves cannot grant access. */
export class AccessPolicy{
 private record:AccessRecord;
 private controllers=new Map<AccessKey,AbortController>();
 constructor(private store:AccessStore){
  const saved=RecordSchema.safeParse(store.get('privacy-access',null));
  this.record=saved.success?saved.data:{version:1,configured:false,choices:{...defaultAccess},place:null};
  if(!this.record.configured)this.record.choices={...defaultAccess};
  if(!this.allowed('approximateLocation'))this.record.place=null;
  for(const key of accessKeys)this.controllers.set(key,new AbortController());
 }
 snapshot():AccessRecord{return structuredClone(this.record);}
 allowed(key:AccessKey){return this.record.configured&&this.record.choices[key];}
 require(key:AccessKey){if(!this.allowed(key))throw new AccessDeniedError(key);}
 signal(key:AccessKey){this.require(key);return this.controllers.get(key)!.signal;}
 update(raw:unknown,beforeRevoke?:(keys:AccessKey[])=>void){
  const choices=AccessChoicesSchema.parse(raw);
  // One Cloud AI choice covers remote requests and any separately permitted context.
  choices.contextToCloud=choices.cloudAI;
  const revoked=accessKeys.filter(key=>this.allowed(key)&&!choices[key]);
  beforeRevoke?.(revoked);
  const next:AccessRecord={version:1,configured:true,choices,place:choices.approximateLocation?this.record.place:null};
  this.store.set('privacy-access',next);this.record=next;
  for(const key of revoked){this.controllers.get(key)!.abort(new AccessDeniedError(key));this.controllers.set(key,new AbortController());}
  return this.snapshot();
 }
 setPlace(raw:unknown){this.require('approximateLocation');this.record={...this.record,place:ApproximatePlaceSchema.parse(raw)};this.store.set('privacy-access',this.record);return this.snapshot();}
 clearPlace(){this.record={...this.record,place:null};this.store.set('privacy-access',this.record);}
}
