// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {deniedAccess,type AccessRecord,type AccessKey} from '../../../packages/safety/access';
import type {LocalContextRequest} from '../../../packages/ai/local-context';

export const accessState:{record:AccessRecord}={record:{version:1,configured:false,choices:{...deniedAccess},place:null}};
const names:Record<AccessKey,string>={microphone:'microphone',devices:'device control',modelDownloads:'model downloads',onlineMedia:'online session audio',cloudAI:'cloud AI',localClock:'date and time',approximateLocation:'approximate IP location',contextToCloud:'local context for cloud AI'};
export function accessAllowed(key:AccessKey){return accessState.record.configured&&accessState.record.choices[key];}
export function localContextRequest():LocalContextRequest|undefined{
 return accessAllowed('localClock')?{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}:undefined;
}
export function acceptAccess(record:AccessRecord){accessState.record=record;if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('bambi-access-changed',{detail:record}));}
export async function requireAccess(key:AccessKey){
 const response=await fetch('/api/access');if(!response.ok)throw Error('Access choices could not be checked.');
 accessState.record=await response.json() as AccessRecord;
 if(!accessAllowed(key)){
  window.dispatchEvent(new CustomEvent('bambi-open-privacy'));
  throw Error(`Allow ${names[key]} in Privacy & access, then try again.`);
 }
}
