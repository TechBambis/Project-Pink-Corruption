// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Attended release qualification of the exact received Linux payload on Ubuntu.
import {execFileSync} from 'node:child_process';
import {createReadStream,readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {desktopVersion} from './desktop-release-version.mjs';
const run=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',...options});
const capture=(command,args)=>execFileSync(command,args,{encoding:'utf8'}).trim();
const api=path=>JSON.parse(capture('gh',['api',path]));
const {RELEASE_TAG:tag,GITHUB_REPOSITORY:repository,GITHUB_ACTOR_ID:actor,RUNNER_TEMP:temporary,BAMBI_SMOKE_OUTPUT:evidence}=process.env;
const version=tag?.slice(1),mode=process.argv[2];
if(process.platform!=='linux'||actor!=='337824705'||repository!=='TechBambis/Project-Pink-Corruption'||!temporary||!evidence||tag!=='v'+version||!desktopVersion(version,'alpha')||!['receive','upload'].includes(mode))throw Error('Use the authorized native Ubuntu release workflow.');
const checkedOutHead=capture('git',['rev-parse','HEAD']),base=`repos/${repository}`;
// The REST tag lookup only returns published releases. Drafts must be found by
// listing accessible releases, then all later writes use that immutable ID.
const release=api(`${base}/releases?per_page=100`).find(value=>value.tag_name===tag);
if(!release?.draft)throw Error('Only an unpublished draft can receive this installer.');
let ref=api(`${base}/git/ref/tags/${tag}`).object;
if(ref.type==='tag')ref=api(`${base}/git/tags/${ref.sha}`).object;
if(ref.type!=='commit')throw Error('The release tag must identify a source commit.');
const head=ref.sha;
if(head!==checkedOutHead){
 run('git',['fetch','--depth=1','origin',head]);
 const changed=capture('git',['diff','--name-only',head,checkedOutHead]).split('\n').filter(Boolean);
 if(changed.some(path=>path!=='scripts/desktop-ubuntu-release.mjs'))throw Error('Application or qualification source differs from the release tag.');
}
const root=join(temporary,'ubuntu-package'),deb=join(temporary,`bambi-local-${version}-linux-amd64.deb`),receipt=join(evidence,'RECEIPT.json');
const hash=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');};
if(mode==='receive'){
 mkdirSync(root);mkdirSync(evidence,{recursive:true});
 const name=`bambi-local-${version}-x86_64.AppImage`,asset=release.assets.find(a=>a.name===name);
 if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest??''))throw Error('The exact AppImage digest is required.');
 run('gh',['release','download',tag,'--repo',repository,'--pattern',name,'--dir',root]);
 const appImage=join(root,name);if(statSync(appImage).size!==asset.size||'sha256:'+await hash(appImage)!==asset.digest)throw Error('Received AppImage checksum mismatch.');
 run('chmod',['+x',appImage]);run(appImage,['--appimage-extract'],{cwd:root,stdio:'ignore'});
 const app=join(root,'squashfs-root'),runtime=JSON.parse(readFileSync(join(app,'resources/notices/RUNTIME-MANIFEST.json'),'utf8'));
 if(runtime.version!==version||runtime.platform!=='linux'||runtime.architecture!=='x64')throw Error('Received runtime identity mismatch.');
 writeFileSync(join(evidence,'RUNTIME-MANIFEST.json'),JSON.stringify(runtime,null,2)+'\n');
 const staging=join(root,'deb');for(const dir of ['opt','DEBIAN','usr/share/applications','usr/share/icons/hicolor/512x512/apps'])mkdirSync(join(staging,dir),{recursive:true});
 run('mv',[app,join(staging,'opt/bambi-local')]);run('chmod',['-R','a+rX,go-w',join(staging,'opt/bambi-local')]);run('chmod',['4755',join(staging,'opt/bambi-local/chrome-sandbox')]);
 writeFileSync(join(staging,'DEBIAN/control'),`Package: bambi-local\nVersion: ${version.replace('-alpha.','~alpha.')}\nSection: sound\nPriority: optional\nArchitecture: amd64\nMaintainer: BambiOS <337824705+BambiOS@users.noreply.github.com>\nDepends: libc6 (>= 2.35), libstdc++6, libnss3, libgtk-3-0t64 | libgtk-3-0, libasound2t64 | libasound2, libgbm1, libdrm2, libx11-6, libxkbcommon0, libxcomposite1, libxdamage1, libxrandr2, libcups2t64 | libcups2, libatk1.0-0t64 | libatk1.0-0, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libpango-1.0-0, libcairo2, libudev1\nHomepage: https://github.com/${repository}\nDescription: Bambi Local chat, voice and media alpha\n Includes the local runtime and Chromium sandbox. Model downloads\n remain an explicit in-app setup choice.\n`);
 writeFileSync(join(staging,'usr/share/applications/bambi-local.desktop'),'[Desktop Entry]\nName=Bambi Local\nExec=/opt/bambi-local/AppRun %U\nTerminal=false\nType=Application\nIcon=bambi-local\nStartupWMClass=Bambi Local\nCategories=AudioVideo;\n');
 copyFileSync(join(staging,'opt/bambi-local/bambi-local.png'),join(staging,'usr/share/icons/hicolor/512x512/apps/bambi-local.png'));
 run('dpkg-deb',['--build','--root-owner-group','-Zxz','-z6','--threads-max=4',staging,deb]);
 if(statSync(deb).size>=2**31)throw Error('Installer exceeds the release asset size limit.');
 run('sudo',['dpkg','--install',deb]);
 if(capture('stat',['-c','%U:%G:%a','/opt/bambi-local/chrome-sandbox'])!=='root:root:4755')throw Error('Installed sandbox ownership mismatch.');
 writeFileSync(receipt,JSON.stringify({version,head,appImage:{name,sha256:asset.digest},deb:{name:deb.split('/').at(-1),bytes:statSync(deb).size,sha256:await hash(deb)},result:'pending-installed-check'},null,2)+'\n');
}else{
 const record=JSON.parse(readFileSync(receipt,'utf8'));
 const reports=readdirSync(evidence).filter(name=>name.startsWith('Linux ü alpha ')).map(name=>JSON.parse(readFileSync(join(evidence,name,'evidence.json'),'utf8')));
 if(record.version!==version||record.head!==head||reports.length!==1||reports[0].errors.length||reports[0].checks.length!==22||reports[0].executable!=='/opt/bambi-local/AppRun'||await hash(deb)!==record.deb.sha256)throw Error('The installed package has not passed its 22 native checks.');
 run('gh',['release','upload',tag,deb,'--repo',repository]);
 const uploaded=api(`${base}/releases/${release.id}`).assets.find(asset=>asset.name===record.deb.name);
 if(!uploaded||uploaded.digest!=='sha256:'+record.deb.sha256||uploaded.size!==record.deb.bytes)throw Error('Uploaded Ubuntu installer digest mismatch.');
 writeFileSync(receipt,JSON.stringify({...record,result:'passed',installedChecks:22},null,2)+'\n');
}
