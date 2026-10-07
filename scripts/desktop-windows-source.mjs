// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Portable source preparation; never represented as a Windows executable build.
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {stageWindowsSource,hashFile,copy} from './desktop-windows-support.mjs';
if(process.argv.includes('--help')){console.log('node scripts/desktop-windows-source.mjs OUTPUT_DIRECTORY; creates an immutable reviewed source kit, no Windows binaries.');process.exit(0);}
if(!process.argv[2])throw Error('Supply a fresh output directory outside the source tree.');
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),output=resolve(process.argv[2]);
const local=relative(root,output);if(!local.startsWith('..')&&!isAbsolute(local))throw Error('Choose a source kit output outside the source tree.');
if(existsSync(output))throw Error('Immutable source kit output already exists.');
mkdirSync(output,{recursive:true});const source=join(output,'source');
const manifest=await stageWindowsSource(root,source,'windows-native-preparation');
writeFileSync(join(source,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
const archive=join(output,'bambi-windows-build-source.tar.gz');
execFileSync('tar',['-czf',archive,'-C',source,'.'],{stdio:'inherit'});
copy(join(root,'docs/DESKTOP_WINDOWS.md'),join(output,'BUILD-AND-TEST.md'));
writeFileSync(join(output,'PREPARATION.json'),JSON.stringify({preparedAt:new Date().toISOString(),sourceDigest:manifest.sourceDigest,files:manifest.files.length,windowsBuilt:false,windowsQualified:false,nextBuild:'scripts\\desktop-windows-build.cmd smoke 0.1.0-smoke.4'},null,2)+'\n');
const sums=[];for(const name of ['bambi-windows-build-source.tar.gz','BUILD-AND-TEST.md','PREPARATION.json'])sums.push(`${await hashFile(join(output,name))}  ${name}`);
writeFileSync(join(output,'SHA256SUMS'),sums.join('\n')+'\n');console.log(JSON.stringify({output,archive,sourceDigest:manifest.sourceDigest,files:manifest.files.length,windowsBuilt:false},null,2));
