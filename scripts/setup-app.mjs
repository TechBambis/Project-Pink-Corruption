// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {spawnSync} from 'node:child_process';
import {existsSync,copyFileSync} from 'node:fs';
if(process.argv.includes('--help')){console.log('Usage: npm run setup [-- --cloud]\nInstall locked application dependencies, check TypeScript and build the web pages.\n--cloud copies the configuration example only when .env.cloud does not exist.\nLocal model and speech setup are separate.');process.exit(0);}
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13)){console.error('Node.js 22.13 or newer is required.');process.exit(1);}
function run(args){const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);}
if(process.argv.includes('--cloud')&&!existsSync('.env.cloud'))copyFileSync('.env.cloud.example','.env.cloud');
run(['ci','--ignore-scripts']);run(['run','check']);run(['run','build']);
console.log('Application ready. Run npm start, then open http://127.0.0.1:6969/setup.');
console.log('Cloud inference is optional. Configure .env.cloud before selecting Cydonia.');
console.log('Local models, Kokoro and Whisper need their separate setup steps.');
