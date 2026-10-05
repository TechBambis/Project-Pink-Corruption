// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {readFileSync} from 'node:fs';
const direction=JSON.parse(readFileSync(new URL('./script-direction.json',import.meta.url),'utf8')) as {format:string;sounds:string;commands:Record<string,string>};
export const scriptFormatDirection=direction.format;
export const scriptSoundDirection=direction.sounds;
/** Audio directions supplement the existing persona and phases without replacing them. */
export function scriptCommandDirection(request:string){
 const key=request.trim().toLowerCase().replace(/[.!?]+$/,'');
 return Object.entries(direction.commands).find(([name])=>key===name||key.startsWith(name+':')||key.startsWith(name+' '))?.[1]??'';
}
export function appendScriptDirection(base:string,request:string){
 return [base,direction.format,direction.sounds,scriptCommandDirection(request)].filter(Boolean).join('\n\n');
}
