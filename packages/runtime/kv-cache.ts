// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import {communityQwen} from '../ai/models';

export type KvCacheMode='default'|'q8_0';
export function kvCacheMode(enabled:unknown,model:string,platform:string):KvCacheMode {
 return enabled===true&&model===communityQwen&&platform==='linux'?'q8_0':'default';
}
export function validateKvCache(mode:KvCacheMode,model:string,platform:string){
 if(mode!=='default'&&mode!=='q8_0')throw Error('Unsupported KV cache setting.');
 if(mode==='q8_0'&&kvCacheMode(true,model,platform)!=='q8_0')throw Error('Experimental Q8 KV cache is available for Hauhau 9B on Linux.');
}
