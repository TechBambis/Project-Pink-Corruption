// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {hashFile,inventory} from './desktop-windows-support.mjs';

if(process.argv.includes('--help')){console.log('Native Windows x64: node scripts/desktop-windows-install-check.mjs dist/desktop-windows/VERSION');process.exit(0);}
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Installer acceptance requires native Windows x64.');
if(!process.argv[2])throw Error('Supply the immutable version output directory.');
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),output=resolve(process.argv[2]);
const runtime=JSON.parse(readFileSync(join(output,'RUNTIME-MANIFEST.json'),'utf8'));
assert.match(runtime.version,/^0\.1\.0-(smoke|alpha)\.[1-9][0-9]*$/);
const product=runtime.phase==='alpha'?'Bambi Local':'Bambi Local Smoke';
const installer=join(output,`bambi-local-${runtime.version}-x64.exe`);
const staging=join(process.env.LOCALAPPDATA,'Bambi qualification installers');mkdirSync(staging,{recursive:true});
const scratch=mkdtempSync(join(staging,'Windows install ü ')),installed=join(scratch,'Received app ä');
const executable=join(installed,product+'.exe'),uninstaller=join(installed,'Uninstall '+product+'.exe');
const evidence={testedAt:new Date().toISOString(),version:runtime.version,installerSha256:await hashFile(installer),checks:[],result:'failed',limitations:[
 'Silent NSIS install/reinstall/uninstall on the recorded hosted Windows runner. This is not an ordinary Windows 11 account or browser-received download test.',
 'Download reputation, SmartScreen, Smart App Control, physical microphone/listening and GPU qualification remain separate reference tests.'
]};
const record=(name,detail={})=>{evidence.checks.push({name,...detail});console.log('PASS',name);};
function nsis(path,args){
 // NSIS requires /D= and _?= last and unquoted, including paths with spaces.
 // Quote only argv[0]; pass the remaining command line verbatim without a shell.
 execFileSync(path,args,{argv0:'"'+path+'"',windowsVerbatimArguments:true,windowsHide:true,timeout:120000,stdio:'inherit'});
}
let fixture,fixtureHash;
try{
 nsis(installer,['/S','/D='+installed]);assert(existsSync(executable)&&existsSync(uninstaller),'Expected per-user NSIS installation');
 const expected=await inventory(join(output,'win-unpacked/resources'));
 assert.deepEqual(await inventory(join(installed,'resources')),expected);
 assert.equal(await hashFile(executable),await hashFile(join(output,'win-unpacked',product+'.exe')));
 record('NSIS-install-in-fresh-space-and-Unicode-path',{path:installed,resourcesMatch:true});
 execFileSync(process.execPath,[join(root,'scripts/desktop-windows-check.mjs'),executable],{cwd:root,env:process.env,timeout:10*60*1000,stdio:'inherit'});
 record('actual-installed-application-packaging-acceptance');
 const testRoot=resolve(process.env.BAMBI_WINDOWS_TEST_OUTPUT||join(process.env.LOCALAPPDATA,'Bambi qualification'));
 const {readdirSync}=await import('node:fs');
 const runs=readdirSync(testRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory());assert.equal(runs.length,1);
 const appEvidence=JSON.parse(readFileSync(join(testRoot,runs[0].name,'evidence.json'),'utf8'));assert.equal(appEvidence.result,'passed');
 evidence.applicationEnvironment=appEvidence.environment;
 fixture=join(appEvidence.data,'data/bambi.sqlite');fixtureHash=await hashFile(fixture);
 nsis(uninstaller,['/S','/KEEP_APP_DATA','_?='+installed]);
 assert(!existsSync(executable)&&!existsSync(join(installed,'resources')),'Uninstaller retained executable/resources');
 assert.equal(await hashFile(fixture),fixtureHash);record('NSIS-uninstall-and-retained-profile');
 nsis(installer,['/S','/D='+installed]);assert(existsSync(executable)&&existsSync(uninstaller));
 assert.deepEqual(await inventory(join(installed,'resources')),expected);assert.equal(await hashFile(fixture),fixtureHash);
 record('NSIS-reinstall-with-retained-profile');
 nsis(uninstaller,['/S','/KEEP_APP_DATA','_?='+installed]);
 assert(!existsSync(executable)&&!existsSync(join(installed,'resources')));assert.equal(await hashFile(fixture),fixtureHash);
 record('NSIS-final-uninstall');evidence.result='passed';
}catch(error){evidence.failure=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{
 if(existsSync(executable)&&existsSync(uninstaller))try{nsis(uninstaller,['/S','/KEEP_APP_DATA','_?='+installed]);}catch(error){evidence.cleanupFailure=String(error);process.exitCode=1;evidence.result='failed';}
 writeFileSync(join(output,'INSTALLER-CHECK.json'),JSON.stringify(evidence,null,2)+'\n');
 console.log('Installer evidence:',join(output,'INSTALLER-CHECK.json'));
}
