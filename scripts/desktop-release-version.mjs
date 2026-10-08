// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
const base='(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)';
export function desktopVersion(version,phase,{development=false}={}){
 if(typeof version!=='string'||!['smoke','alpha'].includes(phase))return false;
 const suffix=phase==='alpha'?'-alpha\\.[1-9][0-9]*': '(?:-(?:smoke|beta|rc)\\.[1-9][0-9]*)?';
 return new RegExp(`^${base}${suffix}${development&&phase==='alpha'?'(?:-dev\\.[0-9]+)?':''}$`).test(version);
}
export function releaseTag(tag,packageVersion){
 if(typeof tag!=='string'||!tag.startsWith('v'))throw Error('Expected a semantic version tag beginning with v.');
 const version=tag.slice(1);
 if(!desktopVersion(version,'smoke'))throw Error('Tag releases currently support stable, smoke, beta and rc smoke packages; AI alphas use the native qualification workflow.');
 if(version.split('-')[0]!==packageVersion)throw Error('Tag base version must match package.json and package-lock.json.');
 return {tag,version,phase:'smoke',prerelease:version.includes('-')};
}
