// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import {communityQwen4B} from '../ai/models';
export type DFlashMode='off'|'on';
export function dflashMode(enabled:unknown,model:string,platform:string):DFlashMode {
 return enabled===true&&model===communityQwen4B&&platform==='linux'?'on':'off';
}
export function validateDFlash(mode:DFlashMode,model:string,platform:string){
 if(mode!=='off'&&mode!=='on')throw Error('Unsupported DFlash setting.');
 if(mode==='on'&&dflashMode(true,model,platform)!=='on')throw Error('DFlash testing is available for Hauhau 4B on Linux.');
}
