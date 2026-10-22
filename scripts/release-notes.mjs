// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export const releaseTagPattern=/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc|smoke)\.[1-9]\d*)?$/;

export function validateReleaseText(value,{maximum=1800}={}){
 if(typeof value!=='string')throw Error('Release notes must be text.');
 const text=value.replaceAll('\r\n','\n').trim();
 if(text.length<40||text.length>maximum)throw Error(`Release notes must contain 40–${maximum} characters.`);
 if(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text))throw Error('Release notes must not contain emojis.');
 if(/@|<\/?[a-z!]|```|\b(?:TODO|TBD)\b|\bINSERT[_ ]HERE\b/i.test(text))throw Error('Remove mentions, HTML, code blocks and unfinished placeholders from release notes.');
 const bullets=text.match(/^- .+/gm)??[];
 if(bullets.length<1||bullets.length>5)throw Error('Use one to five short, informative change bullets.');
 const prose=text.replace(/\[[^\]]+\]\(https:\/\/[^\s)]+\)/g,'').replace(/https:\/\/\S+/g,'');
 if(prose.split(/\s+/).length>150)throw Error('Keep release notes under 150 words, excluding links.');
 return text;
}

export function readReleaseNotes(tag,project=projectRoot){
 if(!releaseTagPattern.test(tag??''))throw Error('Expected a version tag such as v0.1.0-alpha.42.');
 const path=join(project,'release-notes',tag+'.md');
 let text;
 try{
  if(!lstatSync(path).isFile())throw Error('Not a regular file.');
  text=readFileSync(path,'utf8');
 }catch{throw Error(`Codex must write release-notes/${tag}.md for this release before publishing.`);}
 return validateReleaseText(text,{maximum:1400});
}

export function renderReleaseNotes(build,project=projectRoot){
 const text=readReleaseNotes(build.tag,project);
 if(build.phase!=='smoke')return text+'\n';
 if(!/^[\w.-]+\/[\w.-]+$/.test(build.repository??'')||build.version!==build.tag.slice(1))throw Error('Invalid release download identity.');
 const base=`https://github.com/${build.repository}/releases/download/${build.tag}/bambi-local-${build.version}-`;
 return validateReleaseText(`${text}\n\nThis is a desktop preview with an offline sample. Local AI and voice aren't included yet.\n\n[Windows download](${base}x64.exe) · [Linux download](${base}x86_64.AppImage)`)+'\n';
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 const [command,tag,...extra]=process.argv.slice(2);
 if(command!=='preview'||extra.length)throw Error('Use: node scripts/release-notes.mjs preview TAG');
 process.stdout.write(readReleaseNotes(tag)+'\n');
}
