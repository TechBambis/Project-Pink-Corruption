// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,existsSync,copyFileSync,appendFileSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {archiveTool,hashFile,digest} from './desktop-windows-support.mjs';
import {releaseTag} from './desktop-release-version.mjs';
import {releaseReport,sourceChecksMatch} from './desktop-release-support.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const writeJson=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const sha=/^[a-f0-9]{64}$/;
const namePattern=/^[A-Za-z0-9_.-]+$/;

export function downloadNames(build){
 return {windows:`bambi-local-${build.version}-x64.exe`,linux:`bambi-local-${build.version}-x86_64.AppImage`,
  details:`bambi-local-${build.version}-technical-details-and-source.zip`};
}

// Read only the small, flat supplementary archive. Never extract its paths.
export async function readTechnicalDetails(path){
 const limit=32*2**20;
 if(!lstatSync(path).isFile()||lstatSync(path).size>limit)throw Error('Invalid technical archive size/type.');
 const {default:AdmZip}=await import('adm-zip'),zip=new AdmZip(path),entries=zip.getEntries(),files=new Map();let total=0;
 if(!entries.length||entries.length>100)throw Error('Invalid technical archive entry count.');
 for(const entry of entries){
  const name=entry.entryName,type=entry.attr>>>16&0xf000;
  if(!namePattern.test(name)||entry.isDirectory||type!==0x8000||files.has(name))throw Error('Unsafe/duplicate technical archive entry.');
  assertSafePath(name);total+=entry.header.size;
  if(total>limit)throw Error('Technical archive exceeds its unpacked size bound.');
  const bytes=entry.getData(); // CRC validation is part of the ZIP reader.
  if(bytes.length!==entry.header.size)throw Error('Technical archive entry size mismatch.');
  files.set(name,bytes);
 }
 return files;
}

export function context(environment,project=root){
 const e=environment,pkg=json(join(project,'package.json')),lock=json(join(project,'package-lock.json'));
 if(lock.version!==pkg.version||lock.packages?.['']?.version!==pkg.version)throw Error('Package/lockfile version disagreement.');
 const tag=releaseTag(e.GITHUB_REF_NAME,pkg.version);
 if(e.GITHUB_REF!=='refs/tags/'+tag.tag||e.GITHUB_EVENT_NAME!=='push'||e.GITHUB_ACTIONS!=='true')throw Error('Only a GitHub Actions tag push can publish.');
 if(!/^[a-f0-9]{40}$/.test(e.GITHUB_SHA??'')||!/^\d+$/.test(e.GITHUB_RUN_ID??'')||!/^\d+$/.test(e.GITHUB_RUN_ATTEMPT??''))throw Error('Invalid GitHub build identity.');
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(e.GITHUB_REPOSITORY??'')||e.GITHUB_SERVER_URL!=='https://github.com')throw Error('Expected a github.com repository.');
 const policy=json(join(project,'config/release-pipeline.json'));
 if(!policy.authorizedActorIds.includes(e.GITHUB_ACTOR_ID))throw Error('Tag actor is not an authorized release maintainer.');
 return {...tag,commit:e.GITHUB_SHA,repository:e.GITHUB_REPOSITORY,workflow:e.GITHUB_WORKFLOW,
  workflowPath:'.github/workflows/release.yml',runId:e.GITHUB_RUN_ID,runAttempt:e.GITHUB_RUN_ATTEMPT,
  runUrl:`https://github.com/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}`};
}

export function assertTagCommit(build,project=root){
 const git=(...args)=>execFileSync('git',args,{cwd:project,encoding:'utf8'}).trim();
 if(git('rev-parse','HEAD')!==build.commit||git('rev-parse',`refs/tags/${build.tag}^{commit}`)!==build.commit)throw Error('Checkout does not match the exact tagged commit.');
 // A tracked edit (including a regenerated lockfile) is never a tagged release input.
 if(git('status','--porcelain','--untracked-files=no'))throw Error('Tracked release source changed after checkout.');
}

export function assertSafePath(path){
 const normalized=path.replaceAll('\\','/').replace(/^\.\//,'');
 if(normalized===''||normalized==='.')return;
 if(normalized.startsWith('/')||/^[A-Za-z]:/.test(normalized)||normalized.split('/').includes('..')||/[\x00-\x1f]/.test(normalized))throw Error('Unsafe distribution path.');
 if(/(?:^|\/)(?:\.git|\.runtime|\.cache|\.vscode|\.idea|__pycache__|recordings|imported-sounds|internal)(?:\/|$)/i.test(normalized)
  ||/(?:^|\/)(?:\.env(?:\.[^/]*)?|id_rsa|id_ed25519|credentials(?:\.[^/]*)?)(?:\/|$)/i.test(normalized)
  ||/\.(?:sqlite(?:3)?|db|key|pem|p12|pfx|log)$/i.test(normalized))throw Error('Sensitive/local material in distribution: '+normalized);
}

export function inspectArchive(path){
 const listing=execFileSync(archiveTool,['-tzf',path],{encoding:'utf8',maxBuffer:32*1024*1024}).split(/\r?\n/).filter(Boolean);
 if(!listing.length)throw Error('Empty source/notice archive.');
 for(const entry of listing)assertSafePath(entry);
 // Matching source and notice archives are copied from reviewed regular files.
 const verbose=execFileSync(archiveTool,['-tvzf',path],{encoding:'utf8',maxBuffer:32*1024*1024}).split(/\r?\n/).filter(Boolean);
 if(verbose.some(entry=>!['-','d'].includes(entry[0])))throw Error('Links/special entries in source/notice archive.');
}

async function asset(path){
 if(!namePattern.test(basename(path))||!lstatSync(path).isFile())throw Error('Expected a regular release asset.');
 return {filename:basename(path),bytes:lstatSync(path).size,sha256:await hashFile(path)};
}

export async function stageTarget(project,output,destination,target,build){
 const policy=json(join(project,'config/release-pipeline.json'));
 if(!policy.targets.includes(target)||existsSync(destination))throw Error('Use a fresh target staging directory.');
 const spec=json(join(project,'RELEASE-SPEC.json')),runtime=json(join(output,'RUNTIME-MANIFEST.json'));
 const qualification=json(join(output,'DESKTOP-QUALIFICATION.json')),checks=json(join(output,'SOURCE-CHECKS.json'));
 if(spec.version!==build.version||spec.phase!==build.phase||runtime.capabilities.ai||runtime.capabilities.speech)throw Error('Only the declared smoke release can use this pipeline.');
 const platform=target==='windows-x64'?'win32':'linux';
 if(!sourceChecksMatch(checks,spec,platform,'x64')||releaseReport(spec,[{target,runtime,qualification}]).targets.find(t=>t.target===target)?.status!=='qualified')throw Error('Required native release gates did not pass.');
 for(const entry of runtime.files){assertSafePath(entry.path);if(!sha.test(entry.sha256))throw Error('Invalid runtime inventory.');}
 for(const bound of qualification.payload)if(await hashFile(join(output,bound.filename))!==bound.sha256)throw Error('Tested payload changed before staging.');
 const executable=`bambi-local-${build.version}-${target==='windows-x64'?'x64.exe':'x86_64.AppImage'}`;
 const primary=qualification.payload.find(file=>file.filename===executable);
 if(!primary)throw Error('Final download has no qualification hash binding.');
 let evidence;
 if(target==='linux-x64'){
  if(qualification.appImage?.filename!==executable||qualification.appImage.sha256!==primary.sha256)throw Error('Final AppImage has not been exercised.');
  const reports=readdirSync(join(output,'qualification-linux')).filter(name=>existsSync(join(output,'qualification-linux',name,'evidence.json')));
  if(reports.length!==1)throw Error('Expected one native Linux qualification report.');
  evidence=json(join(output,'qualification-linux',reports[0],'evidence.json'));
 }else{
  const installer=json(join(output,'INSTALLER-CHECK.json'));
  if(installer.result!=='passed'||installer.installerSha256!==primary.sha256)throw Error('Actual installer was not qualified.');
  evidence=json(join(output,'WINDOWS-PACKAGING-CHECK.json'));
 }
 if(evidence.result!=='passed'||!evidence.checks?.length)throw Error('Native application acceptance failed.');
 mkdirSync(destination,{recursive:true});
 const copy=(from,to)=>{if(!lstatSync(from).isFile())throw Error('Release input must be a regular file.');copyFileSync(from,join(destination,to));};
 copy(join(output,executable),executable);
 copy(join(output,`bambi-local-${build.version}-source.tar.gz`),`bambi-local-${build.version}-${target}-source.tar.gz`);
 for(const filename of ['RUNTIME-MANIFEST.json','SOURCE-CHECKS.json','DESKTOP-QUALIFICATION.json',...(target==='windows-x64'?['INSTALLER-CHECK.json']:[])])copy(join(output,filename),target+'-'+filename);
 writeJson(join(destination,target+'-PACKAGING-CHECK.json'),evidence);
 const notices=join(output,target==='windows-x64'?'win-unpacked/resources/notices':'linux-unpacked/resources/notices');
 execFileSync(archiveTool,['-czf',join(destination,target+'-NOTICES.tar.gz'),'-C',notices,'.']);
 // npm is already part of the locked build toolchain; no SBOM package is added.
 const sbom=execFileSync(process.platform==='win32'?'npm.cmd':'npm',['sbom','--sbom-format=cyclonedx','--package-lock-only'],{cwd:project,encoding:'utf8',maxBuffer:16*1024*1024,shell:process.platform==='win32'});
 const parsed=JSON.parse(sbom);if(parsed.bomFormat!=='CycloneDX'||!parsed.components?.length)throw Error('Invalid npm SBOM.');
 writeFileSync(join(destination,target+'-SBOM.cdx.json'),sbom);
 const assets=[];
 for(const filename of readdirSync(destination).sort()){
  const path=join(destination,filename);if(filename.endsWith('.tar.gz'))inspectArchive(path);
  assets.push(await asset(path));
 }
 if(assets.reduce((sum,file)=>sum+file.bytes,0)>policy.maximumTransferMiB*2**20/policy.targets.length)throw Error('Target exceeds its bounded temporary storage allocation.');
 writeJson(join(destination,target+'-BUILD-INFO.json'),{schema:1,...build,target,platform,architecture:'x64',phase:spec.phase,
  applicationDigest:spec.applicationDigest,sourceDigest:runtime.sourceDigest,
  builtAt:runtime.builtAt,toolchain:{buildNode:process.version,npm:execFileSync(process.platform==='win32'?'npm.cmd':'npm',['--version'],{encoding:'utf8',shell:process.platform==='win32'}).trim(),runtimeNode:runtime.node,electron:runtime.electron,builder:runtime.builder},
  sbomScope:'Committed npm lockfile build/runtime dependencies; bundled external binaries are recorded separately in RUNTIME-MANIFEST and NOTICES.',assets});
}

export async function assemble(input,destination,build,project=root){
 const policy=json(join(project,'config/release-pipeline.json'));
 if(existsSync(destination))throw Error('Use a fresh publication directory.');
 const directories=readdirSync(input).sort();
 if(JSON.stringify(directories)!==JSON.stringify(policy.targets.map(t=>'release-'+t).sort()))throw Error('Both exact native target artifacts are required.');
 const targets=[];
 for(const target of policy.targets){
  const folder=join(input,'release-'+target),record=json(join(folder,target+'-BUILD-INFO.json'));
  for(const key of ['tag','version','phase','commit','repository','workflow','workflowPath','runId','runAttempt','runUrl'])if(record[key]!==build[key])throw Error('Transferred build identity mismatch: '+key);
  if(record.target!==target||!sha.test(record.applicationDigest)||!sha.test(record.sourceDigest))throw Error('Invalid target build identity.');
  const expected=[...record.assets.map(a=>a.filename),target+'-BUILD-INFO.json'].sort();
  if(new Set(expected).size!==expected.length||JSON.stringify(readdirSync(folder).sort())!==JSON.stringify(expected))throw Error('Unexpected/missing transferred assets.');
  for(const entry of record.assets){
   if(!namePattern.test(entry.filename)||!sha.test(entry.sha256))throw Error('Invalid transferred asset record.');
   const actual=await asset(join(folder,entry.filename));
   if(actual.sha256!==entry.sha256||actual.bytes!==entry.bytes)throw Error('Transferred asset integrity failure: '+entry.filename);
  }
  const runtime=json(join(folder,target+'-RUNTIME-MANIFEST.json')),q=json(join(folder,target+'-DESKTOP-QUALIFICATION.json'));
  const spec={...json(join(project,'config/desktop-release.json')),version:build.version,phase:build.phase,applicationDigest:record.applicationDigest,sourceDigest:record.sourceDigest};
  if(releaseReport(spec,[{target,runtime,qualification:q}]).targets.find(t=>t.target===target)?.status!=='qualified'
   ||!sourceChecksMatch(json(join(folder,target+'-SOURCE-CHECKS.json')),spec,target==='windows-x64'?'win32':'linux','x64'))throw Error('Transferred qualification failed.');
  const executable=record.assets.find(a=>a.filename.endsWith(target==='windows-x64'?'.exe':'.AppImage'));
  if(!executable||q.payload.find(p=>p.filename===executable.filename)?.sha256!==executable.sha256)throw Error('Executable/evidence mismatch.');
  if(target==='linux-x64'&&q.appImage?.sha256!==executable.sha256)throw Error('Missing transferred AppImage acceptance.');
  if(target==='windows-x64'){
   const installed=json(join(folder,target+'-INSTALLER-CHECK.json'));
   if(installed.result!=='passed'||installed.installerSha256!==executable.sha256)throw Error('Missing transferred installer acceptance.');
  }
  if(json(join(folder,target+'-PACKAGING-CHECK.json')).result!=='passed')throw Error('Missing transferred application acceptance.');
  targets.push(record);
 }
 if(new Set(targets.map(t=>t.applicationDigest)).size!==1)throw Error('Native targets used different application source.');
 const names=downloadNames(build),files=new Map(),assets=[];
 for(const target of policy.targets)for(const filename of readdirSync(join(input,'release-'+target)).sort()){
  if(files.has(filename))throw Error('Release asset collision.');
  const path=join(input,'release-'+target,filename);assertSafePath(filename);
  if(filename.endsWith('.tar.gz'))inspectArchive(path);
  assets.push(await asset(path));files.set(filename,path);
 }
 if(assets.reduce((sum,a)=>sum+a.bytes,0)>policy.maximumTransferMiB*2**20)throw Error('Combined release exceeds the storage bound.');
 const readme=Buffer.from(`Bambi Local ${build.version}: technical details and matching source\n\nWindows users only need ${names.windows}.\nLinux users only need ${names.linux}.\nThis optional archive preserves build records, native checks, SBOMs, licenses\nand the exact matching source archives for both downloads. It is not an installer.\n\nBUILD-INFO.json records the original files and their SHA-256 hashes.\nSHA256SUMS on the release page verifies the two executables and this entire ZIP.\nExtract the matching source and NOTICES tar.gz archives to inspect their files.\nVerification guide: https://github.com/${build.repository}/blob/${build.tag}/docs/RELEASE-SECURITY.md\n`);
 files.set('README.txt',readme);assets.push({filename:'README.txt',bytes:readme.length,sha256:digest(readme)});
 assets.sort((a,b)=>a.filename.localeCompare(b.filename,'en'));
 const record={schema:1,...build,applicationDigest:targets[0].applicationDigest,targets,assets,
  limitations:['Smoke: offline sample and desktop packaging; local AI/speech are not included.','Qualification is on hosted runners; recipient hardware/audio, Windows download reputation and Linux FUSE remain separate.','Native builds and qualification run in this workflow; the aggregation job attests their verified final files. This is not an independent source audit.']};
 const {default:AdmZip}=await import('adm-zip'),zip=new AdmZip();
 files.set('BUILD-INFO.json',Buffer.from(JSON.stringify(record,null,2)+'\n'));
 if([...files].filter(([name])=>name!==names.windows&&name!==names.linux)
  .reduce((sum,[,value])=>sum+(Buffer.isBuffer(value)?value.length:lstatSync(value).size),0)>32*2**20)throw Error('Technical archive exceeds its unpacked size bound.');
 mkdirSync(destination,{recursive:true});
 for(const [filename,bytes] of [...files].sort(([a],[b])=>a.localeCompare(b,'en'))){
  if(filename===names.windows||filename===names.linux){copyFileSync(bytes,join(destination,filename));continue;}
  const entry=zip.addFile(filename,Buffer.isBuffer(bytes)?bytes:readFileSync(bytes),'',0o644);
  // Fixed DOS date, permissions and ordering make the two aggregation jobs
  // produce identical ZIP bytes regardless of input mtimes or host timezone.
  entry.header.time=new Date(1980,0,1);entry.header.method=0;
 }
 writeFileSync(join(destination,names.details),zip.toBuffer());
 const checksums=[];
 for(const filename of readdirSync(destination).sort())checksums.push(`${await hashFile(join(destination,filename))}  ${filename}`);
 writeFileSync(join(destination,'SHA256SUMS'),checksums.join('\n')+'\n');
 await verifyPublication(destination,build);
 return record;
}

export async function verifyPublication(directory,build){
 const names=downloadNames(build);
 if(JSON.stringify(readdirSync(directory).sort())!==JSON.stringify([...Object.values(names),'SHA256SUMS'].sort()))throw Error('Expected exactly four release downloads.');
 const entries=readFileSync(join(directory,'SHA256SUMS'),'utf8').trim().split('\n').map(line=>{
  const match=line.match(/^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/);if(!match)throw Error('Invalid checksum record.');return {sha256:match[1],filename:match[2]};
 });
 if(new Set(entries.map(e=>e.filename)).size!==entries.length||JSON.stringify([...entries.map(e=>e.filename),'SHA256SUMS'].sort())!==JSON.stringify(readdirSync(directory).sort()))throw Error('Publication asset/checksum disagreement.');
 for(const entry of entries)if(await hashFile(join(directory,entry.filename))!==entry.sha256)throw Error('Publication bytes changed: '+entry.filename);
 const files=await readTechnicalDetails(join(directory,names.details));
 if(!files.has('BUILD-INFO.json'))throw Error('Missing archived build metadata.');
 const record=JSON.parse(files.get('BUILD-INFO.json').toString('utf8'));
 for(const key of ['tag','version','phase','commit','repository','workflow','workflowPath','runId','runAttempt','runUrl'])if(record[key]!==build[key])throw Error('Publication identity mismatch.');
 for(const entry of record.assets){
  if(!namePattern.test(entry.filename)||!sha.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw Error('Invalid archived asset record.');
  assertSafePath(entry.filename);
 }
 const archived=record.assets.filter(e=>e.filename!==names.windows&&e.filename!==names.linux).map(e=>e.filename);
 if(new Set(record.assets.map(e=>e.filename)).size!==record.assets.length||JSON.stringify([...archived,'BUILD-INFO.json'].sort())!==JSON.stringify([...files.keys()].sort()))throw Error('Technical archive/build inventory disagreement.');
 for(const executable of [names.windows,names.linux])if(!record.assets.some(e=>e.filename===executable))throw Error('Missing executable build binding.');
 for(const entry of record.assets){
  const bytes=files.get(entry.filename),path=join(directory,entry.filename);
  const actual=bytes?{bytes:bytes.length,sha256:digest(bytes)}:await asset(path);
  if(actual.bytes!==entry.bytes||actual.sha256!==entry.sha256)throw Error('Build metadata/asset mismatch: '+entry.filename);
 }
 return entries;
}

export async function githubApi(path,environment=process.env){
 const response=await fetch('https://api.github.com/'+path,{headers:{authorization:'Bearer '+environment.GH_TOKEN,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(30000)});
 if(response.status===404)return undefined;
 if(!response.ok)throw Error('GitHub API request failed ('+response.status+').');
 return response.json();
}

export async function findRelease(repo,tag,api=githubApi){
 // The tag endpoint does not resolve drafts. Authenticated release listing
 // includes them, so it also prevents replacing an existing unpublished draft.
 let match;
 for(let page=1;page<=100;page++){
  const releases=await api(`${repo}/releases?per_page=100&page=${page}`);
  if(!Array.isArray(releases))throw Error('Cannot inspect existing releases and drafts.');
  for(const release of releases)if(release.tag_name===tag){if(match)throw Error('Multiple releases use the requested tag.');match=release;}
  if(releases.length<100)return match;
 }
 throw Error('Release inventory exceeds supported inspection.');
}

export async function publish(directory,build,{api=githubApi,gh=(args)=>execFileSync('gh',args,{stdio:'inherit'})}={}){
 const entries=await verifyPublication(directory,build),repo='repos/'+build.repository;
 let ref=await api(repo+'/git/ref/tags/'+encodeURIComponent(build.tag));
 if(!ref)throw Error('Remote release tag does not exist.');
 for(let depth=0;ref.object.type==='tag'&&depth<5;depth++)ref=await api(repo+'/git/tags/'+ref.object.sha);
 if(ref?.object?.type!=='commit'||ref.object.sha!==build.commit)throw Error('Remote tag changed before publication.');
 if(await findRelease(repo,build.tag,api))throw Error('A release already exists; existing assets will never be replaced.');
 const repository=await api(repo);if(!repository)throw Error('Cannot read release repository.');
 // Public publication requires signed build provenance for every attached file,
 // including the aggregate metadata/checksums, before obtaining a release URL.
 if(!repository.private)for(const filename of readdirSync(directory).sort())gh(['attestation','verify',join(directory,filename),'--repo',build.repository,'--signer-workflow',build.repository+'/'+build.workflowPath,'--source-ref','refs/tags/'+build.tag,'--source-digest',build.commit]);
 const notes=join(directory,'..','release-notes.md');
 const names=downloadNames(build),download=`https://github.com/${build.repository}/releases/download/${build.tag}/`;
 writeFileSync(notes,`[Download for Windows (x64)](${download+names.windows}) · [Download for Linux (x64)](${download+names.linux})\n\nDownload only the file for your operating system. On Windows, run the .exe installer; on Linux, make the AppImage executable and open it.\n\n**Smoke test version:** includes the offline sample and desktop shell. Local AI and speech are not included.\n\n[Technical details and matching source (optional ZIP)](${download+names.details}) · [Checksums](${download}SHA256SUMS) · [Verification guide](https://github.com/${build.repository}/blob/${build.tag}/docs/RELEASE-SECURITY.md)\n\nBambi Local ${build.version} · Commit: ${build.commit}\nSource: https://github.com/${build.repository}/tree/${build.tag}\nBuild: ${build.runUrl}\n`);
 gh(['release','create',build.tag,...readdirSync(directory).sort().map(n=>join(directory,n)),'--repo',build.repository,'--verify-tag','--draft','--title',`Bambi Local ${build.version} (smoke)`,'--notes-file',notes,'--generate-notes',...(build.prerelease?['--prerelease']:[])]);
 const draft=await findRelease(repo,build.tag,api);
 const expected=[...entries,await asset(join(directory,'SHA256SUMS'))];
 if(!draft?.draft||draft.assets.length!==expected.length)throw Error('Draft upload incomplete; release remains unpublished.');
 for(const entry of expected){
  const uploaded=draft.assets.find(a=>a.name===entry.filename);
  if(uploaded?.digest!=='sha256:'+entry.sha256||uploaded.size!==lstatSync(join(directory,entry.filename)).size)throw Error('GitHub upload digest mismatch; release remains unpublished.');
 }
 await verifyPublication(directory,build);
 // Re-read the remote tag immediately before publishing the assembled draft.
 let finalRef=await api(repo+'/git/ref/tags/'+encodeURIComponent(build.tag));
 for(let depth=0;finalRef?.object?.type==='tag'&&depth<5;depth++)finalRef=await api(repo+'/git/tags/'+finalRef.object.sha);
 if(finalRef?.object?.type!=='commit'||finalRef.object.sha!==build.commit)throw Error('Remote tag changed; draft remains unpublished.');
 gh(['release','edit',build.tag,'--repo',build.repository,'--draft=false','--latest='+String(!build.prerelease)]);
}

async function preflight(build,environment){
 assertTagCommit(build);
 const policy=json(join(root,'config/release-pipeline.json')),event=json(environment.GITHUB_EVENT_PATH);
 if(typeof event.repository?.private!=='boolean')throw Error('Repository visibility is unknown.');
 if(event.repository.private&&environment.BAMBI_FREE_ALLOWANCE_CONFIRMED!=='true')throw Error('Confirm remaining account allowance and zero paid usage in RELEASE_FREE_ALLOWANCE_CONFIRMED before a private tag release.');
 let occupied=0;
 for(let page=1;page<=100;page++){
  const result=await githubApi(`repos/${build.repository}/actions/artifacts?per_page=100&page=${page}`);
  if(!result)throw Error('Cannot check temporary artifact storage.');
  occupied+=result.artifacts.filter(a=>!a.expired).reduce((n,a)=>n+a.size_in_bytes,0);
  if(result.artifacts.length<100)break;if(page===100)throw Error('Artifact inventory exceeds supported budget inspection.');
 }
 if(occupied+policy.maximumTransferMiB*2**20>500*1000*1000)throw Error('Existing repository artifacts leave insufficient storage for a bounded release. Account-wide allowance must also be confirmed.');
 appendFileSync(environment.GITHUB_OUTPUT,`version=${build.version}\nprerelease=${build.prerelease}\n`);
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 const [command,...args]=process.argv.slice(2),build=context(process.env);
 if(command==='preflight'&&!args.length)await preflight(build,process.env);
 else if(command==='stage'&&args.length===4)await stageTarget(resolve(args[0]),resolve(args[1]),resolve(args[2]),args[3],build);
 else if(command==='assemble'&&args.length===2)await assemble(resolve(args[0]),resolve(args[1]),build);
 else if(command==='publish'&&args.length===1){assertTagCommit(build);await publish(resolve(args[0]),build);}
 else throw Error('Use release-pipeline.mjs preflight | stage SNAPSHOT OUTPUT DESTINATION TARGET | assemble INPUT DESTINATION | publish DIRECTORY');
}
