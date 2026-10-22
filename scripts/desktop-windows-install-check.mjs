// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {desktopVersion} from './desktop-release-version.mjs';
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
const receivedInstaller=process.argv.includes('--received-installer');
const runtime=JSON.parse(readFileSync(join(output,'RUNTIME-MANIFEST.json'),'utf8'));
assert(desktopVersion(runtime.version,runtime.phase),'Invalid runtime phase/version');
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
 // AI packages contain several GiB of native CPU/GPU libraries. Keep a bounded
 // deadline while allowing their extraction under ordinary antivirus scanning.
 const timeout=runtime.phase==='alpha'?10*60*1000:120000;
 const operation=path===installer?'install':'uninstall',started=performance.now();
 console.log(`NSIS ${operation} started; deadline ${timeout/1000} seconds.`);
 let passed=false;
 try{execFileSync(path,args,{argv0:'"'+path+'"',windowsVerbatimArguments:true,windowsHide:true,timeout,stdio:'inherit'});passed=true;}
 finally{(evidence.nsisOperations??=[]).push({operation,timeoutMs:timeout,durationMs:performance.now()-started,passed});}
}
let fixture,fixtureHash;
try{
 nsis(installer,['/S','/D='+installed]);assert(existsSync(executable)&&existsSync(uninstaller),'Expected per-user NSIS installation');
 // A received private artifact has no build staging tree. Its embedded hashes
 // and corresponding source are audited by the application check below.
 const expected=await inventory(receivedInstaller?join(installed,'resources'):join(output,'win-unpacked/resources'));
 assert.deepEqual(await inventory(join(installed,'resources')),expected);
 const installedExecutableHash=await hashFile(executable);
 if(!receivedInstaller)assert.equal(installedExecutableHash,await hashFile(join(output,'win-unpacked',product+'.exe')));
 record('NSIS-install-in-fresh-space-and-Unicode-path',{path:installed,resourcesMatch:!receivedInstaller,receivedInstaller,installedExecutableHash,resourceAudit:receivedInstaller?'Embedded runtime/source/shell hashes below; installed inventory retained for reinstall comparison.':'Build staging inventory and executable hash.'});
 // Speech is independently testable immediately after the installed resource
 // audit. Retain its evidence before unrelated interactive UI checks run.
 if(runtime.phase==='alpha'){
  const nativeOutput=join(scratch,'Public installed speech evidence');
  try{execFileSync(process.execPath,[join(root,'scripts/desktop-windows-runtime-slice.mjs'),'--received-runtime',join(installed,'resources/backend')],{cwd:root,env:{...process.env,BAMBI_WINDOWS_SLICE_OUTPUT:nativeOutput},timeout:8*60*1000,stdio:'inherit'});}
  finally{if(existsSync(join(nativeOutput,'RUNTIME-SLICE-CHECK.json')))writeFileSync(join(output,'WINDOWS-NATIVE-SPEECH-CHECK.json'),readFileSync(join(nativeOutput,'RUNTIME-SLICE-CHECK.json')));}
  const nativeEvidence=JSON.parse(readFileSync(join(nativeOutput,'RUNTIME-SLICE-CHECK.json'),'utf8'));assert.equal(nativeEvidence.result,'passed');
  record('actual-installed-native-speech-and-runtime-acceptance',{checks:nativeEvidence.checks.map(check=>check.name)});
 }
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
 assert.equal(await hashFile(executable),installedExecutableHash);
 record('NSIS-reinstall-with-retained-profile');
 nsis(uninstaller,['/S','/KEEP_APP_DATA','_?='+installed]);
 assert(!existsSync(executable)&&!existsSync(join(installed,'resources')));assert.equal(await hashFile(fixture),fixtureHash);
 record('NSIS-final-uninstall');evidence.result='passed';
}catch(error){evidence.failure=String(error.stack||error);console.error(error);process.exitCode=1;}
finally{
 if(existsSync(executable)&&existsSync(uninstaller))try{nsis(uninstaller,['/S','/KEEP_APP_DATA','_?='+installed]);}catch(error){evidence.cleanupFailure=String(error);process.exitCode=1;evidence.result='failed';}
 const evidencePath=join(output,receivedInstaller?'QUALIFIED-INSTALLER-CHECK.json':'INSTALLER-CHECK.json');
 writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
 console.log('Installer evidence:',evidencePath);
}
