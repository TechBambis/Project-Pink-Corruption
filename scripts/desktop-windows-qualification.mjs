// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Qualification driver is recorded separately from the immutable binary source.
import {readFileSync,writeFileSync,readdirSync,mkdtempSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {hashFile,archiveTool} from './desktop-windows-support.mjs';
const [snapshotArg,outputArg,...extra]=process.argv.slice(2);
if(process.platform!=='win32'||!snapshotArg||!outputArg||extra.length)throw Error('Use the native Windows qualification workflow.');
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),snapshot=resolve(snapshotArg),output=resolve(outputArg);
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const {verifySnapshot}=await import(pathToFileURL(join(snapshot,'scripts/desktop-source.mjs')).href);
await verifySnapshot(snapshot);
const spec=json(join(snapshot,'RELEASE-SPEC.json')),runtime=json(join(output,'RUNTIME-MANIFEST.json')),checks=json(join(snapshot,'SOURCE-CHECKS.json'));
if(spec.phase!=='alpha'||runtime.version!==spec.version||runtime.platform!=='win32'||runtime.architecture!=='x64'||runtime.release.applicationDigest!==spec.applicationDigest||runtime.sourceDigest!==spec.sourceDigest||checks.result!=='passed'||checks.sourceDigest!==spec.sourceDigest)throw Error('Frozen binary/source identity mismatch.');
writeFileSync(join(output,'SOURCE-CHECKS.json'),JSON.stringify(checks,null,2)+'\n');
const payload=[];
for(const filename of readdirSync(output).filter(name=>/\.(?:exe|zip|tar\.gz)$/.test(name)||['RUNTIME-MANIFEST.json','SOURCE-CHECKS.json'].includes(name)))payload.push({filename,sha256:await hashFile(join(output,filename))});
const gates={sourceChecks:'passed'},qualification={schema:1,version:spec.version,target:'windows-x64',applicationDigest:spec.applicationDigest,sourceDigest:runtime.sourceDigest,payload,gates,testedAt:new Date().toISOString(),qualificationDriver:{commit:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,changes:'Wait for setup initialization and explicitly select the unchanged full reference model before testing download controls; application source is the unchanged release tag.'}};
const testOutput=mkdtempSync(join(output,'qualification-'));
try{
 try{execFileSync(process.execPath,[join(root,'scripts/desktop-windows-install-check.mjs'),output],{cwd:root,env:{...process.env,BAMBI_WINDOWS_TEST_OUTPUT:testOutput},stdio:'inherit'});}
 finally{
  const reports=readdirSync(testOutput).filter(name=>existsSync(join(testOutput,name,'evidence.json')));
  if(reports.length!==1)throw Error('Expected one fresh native application report.');
  writeFileSync(join(output,'WINDOWS-PACKAGING-CHECK.json'),readFileSync(join(testOutput,reports[0],'evidence.json')));
 }
 for(const name of ['INSTALLER-CHECK.json','WINDOWS-NATIVE-SPEECH-CHECK.json','WINDOWS-PACKAGING-CHECK.json'])if(json(join(output,name)).result!=='passed')throw Error('Native qualification failed: '+name);
 for(const file of payload)if(await hashFile(join(output,file.filename))!==file.sha256)throw Error('Distribution changed during qualification.');
 await verifySnapshot(snapshot);gates.packaging=gates.installer=gates.speech='passed';
 const notices=join(output,'win-unpacked/resources/notices');
 execFileSync(archiveTool,['-czf','NOTICES.tar.gz','-C',notices,'.'],{cwd:output,stdio:'inherit'});
}catch(error){gates.packaging='failed';throw error;}
finally{writeFileSync(join(output,'DESKTOP-QUALIFICATION.json'),JSON.stringify(qualification,null,2)+'\n');}
