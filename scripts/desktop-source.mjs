// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {desktopVersion} from './desktop-release-version.mjs';
import {mkdirSync,readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copy,copyTree,sourcePathAllowed,inventory,digest,hashFile} from './desktop-windows-support.mjs';

const roots=['apps','packages','config','presets','tests','scripts','voices'];
const top=['package.json','package-lock.json','tsconfig.json','.gitignore','desktop-builder.cjs','desktop-alpha-builder.cjs','desktop-windows-builder.cjs','LICENSE','LICENSING.md','README.md'];
const docs=['MODEL_SETUP.md','PRIVACY_ACCESS.md','DESKTOP_SMOKE.md','DESKTOP_ALPHA.md','DESKTOP_WINDOWS.md','DESKTOP_WINDOWS_ALPHA.md','DESKTOP_RELEASE.md','AI_RUNTIME_STRATEGY.md','anubis-model.json','community-models.json','LICENSE.stable2','STABLE_CONTENT.md','LOCAL_AUDIO_LICENSES.md','SITUATIONAL_CONVERSATION.md','ADAPTIVE_DELIVERY.md','RELEASE-SECURITY.md'];

/** One source allowlist for every native builder; runtime/user data never enter it. */
export async function stageDesktopSource(root,destination,version){
 mkdirSync(destination,{recursive:true});
 // The repository explicitly lists distributable provisioning and CI scripts.
 // Local authoring/benchmark helpers can have source extensions too.
 const reviewedScripts=new Set([...readFileSync(join(root,'.gitignore'),'utf8').matchAll(/^!\/scripts\/([^\r\n]+)$/gm)].map(match=>match[1]));
 for(const folder of roots){mkdirSync(join(destination,folder),{recursive:true});copyTree(join(root,folder),join(destination,folder),path=>sourcePathAllowed(folder+'/'+path)&&(folder!=='scripts'||reviewedScripts.has(path)));}
 for(const path of top)copy(join(root,path),join(destination,path));
 for(const path of ['.gitattributes','CLA.md','CONTRIBUTING.md','ARCHITECTURE.md','VERSIONS.md'])if(existsSync(join(root,path)))copy(join(root,path),join(destination,path));
 for(const path of ['AppRun','AppRun.alpha'])copy(join(root,'apps/desktop',path),join(destination,'apps/desktop',path));
 if(existsSync(join(root,'voices/bambi_classic.npy')))copy(join(root,'voices/bambi_classic.npy'),join(destination,'voices/bambi_classic.npy'));
 for(const path of docs)if(existsSync(join(root,'docs',path)))copy(join(root,'docs',path),join(destination,'docs',path));
 copyTree(join(root,'docs/licenses'),join(destination,'docs/licenses'));
 mkdirSync(join(destination,'assets/sounds'),{recursive:true});copyTree(join(root,'assets/sounds'),join(destination,'assets/sounds'),path=>['tick-clicks.json','tick_main.wav','tick_sub.wav'].includes(path));
 mkdirSync(join(destination,'.github'),{recursive:true});copyTree(join(root,'.github'),join(destination,'.github'),path=>sourcePathAllowed('.github/'+path));
 const sourceFiles=await inventory(destination);
 const canonical=[];
 for(const file of sourceFiles){
  const bytes=readFileSync(join(destination,file.path));
  // Git's CRLF checkout must not make identical application code appear divergent.
  const normalized=/\.(wav|npy)$/.test(file.path)?bytes:Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  canonical.push({path:file.path,sha256:digest(normalized)});
 }
 return {schema:1,version,sourceDigest:digest(JSON.stringify(sourceFiles)),applicationDigest:digest(JSON.stringify(canonical)),files:sourceFiles};
}

export function validateReleaseSource(manifest,spec){
 if(manifest.version!==spec.version)throw Error('Release/source version mismatch.');
 const paths=new Set(manifest.files.map(file=>file.path));
 for(const [feature,required] of Object.entries(spec.features))for(const path of required)if(!paths.has(path))throw Error(`Missing ${feature} source: ${path}`);
 for(const path of spec.windowsRequired)if(!paths.has(path))throw Error('Missing qualified Windows source: '+path);
}

/** Builders bind their actual inputs to an immutable prepared snapshot when supplied. */
export async function releaseIdentity(root,manifest){
 const configuration=JSON.parse(readFileSync(join(root,'config/desktop-release.json'),'utf8'));
 const prepared=join(root,'RELEASE-SPEC.json');
 const spec=existsSync(prepared)?JSON.parse(readFileSync(prepared,'utf8')):{...configuration,version:manifest.version,phase:manifest.version.includes('-alpha.')?'alpha':'smoke'};
 if(existsSync(prepared)){
  for(const key of Object.keys(configuration))if(JSON.stringify(spec[key])!==JSON.stringify(configuration[key]))throw Error('Prepared release contract changed: '+key);
  if(!['smoke','alpha'].includes(spec.phase)||!desktopVersion(spec.version,spec.phase))throw Error('Invalid prepared release phase/version.');
 }
 validateReleaseSource(manifest,spec);
 if(spec.applicationDigest&&spec.applicationDigest!==manifest.applicationDigest)throw Error('Prepared application source changed; create a new snapshot/version.');
 if(spec.sourceDigest&&spec.sourceDigest!==manifest.sourceDigest)throw Error('Prepared source bytes changed.');
 return {schema:1,version:manifest.version,applicationDigest:manifest.applicationDigest,sourceDigest:manifest.sourceDigest,features:Object.keys(spec.features),snapshot:existsSync(prepared)?'prepared':'worktree'};
}

export async function verifySnapshot(root){
 const manifest=JSON.parse(readFileSync(join(root,'SOURCE-MANIFEST.json'),'utf8'));
 if(digest(JSON.stringify(manifest.files))!==manifest.sourceDigest)throw Error('Invalid snapshot inventory digest.');
 for(const file of manifest.files){
  if(!/^[a-zA-Z0-9_.\/-]+$/.test(file.path)||file.path.split('/').some(part=>part==='..'||part==='')||file.path.startsWith('/'))throw Error('Invalid snapshot path.');
  if(await hashFile(join(root,file.path))!==file.sha256)throw Error('Snapshot changed: '+file.path);
 }
 // Re-stage to reject newly added release inputs, as well as edited existing ones.
 const scratch=mkdtempSync(join(tmpdir(),'bambi-source-verify-'));
 try{
  const current=await stageDesktopSource(root,scratch,manifest.version);
  if(current.sourceDigest!==manifest.sourceDigest)throw Error('Snapshot source inventory changed.');
  if(current.applicationDigest!==manifest.applicationDigest)throw Error('Snapshot application identity changed.');
  if(existsSync(join(root,'RELEASE-SPEC.json')))await releaseIdentity(root,current);
 }
 finally{rmSync(scratch,{recursive:true,force:true});}
 return manifest;
}

export function writeSourceManifest(destination,manifest){writeFileSync(join(destination,'SOURCE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');}
