// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {resourcePath} from './paths';
export const nativeName=(name:string,platform=process.platform)=>name+(platform==='win32'?'.exe':'');
export const speechExecutable=()=>resourcePath('native/speech',nativeName('bambi-speech'));
export const llamaExecutable=()=>resourcePath('native/llama',nativeName('llama-server'));
