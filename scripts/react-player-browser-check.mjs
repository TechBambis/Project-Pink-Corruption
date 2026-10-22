// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Reuse the existing isolated fixtures rather than inventing a second backend.
// Both checks keep models, private data, paid services and physical devices out.
const root=fileURLToPath(new URL('../',import.meta.url));
for(const script of ['navigation-browser-check.mjs','high-impact-browser-check.mjs']){
 const child=spawn(process.execPath,['scripts/'+script],{cwd:root,env:{...process.env,BAMBI_BROWSER_UI:'react'},stdio:'inherit'});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
 if(code!==0){process.exitCode=Number(code);break;}
}
