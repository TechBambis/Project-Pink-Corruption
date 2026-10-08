// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
const version=process.env.BAMBI_ALPHA_VERSION;
if(!/^0\.1\.0-alpha\.[0-9]+(?:-dev\.[0-9]+)?$/.test(version||''))throw Error('Explicit immutable alpha version required');
module.exports={
 appId:'local.bambi.alpha',productName:'Bambi Local',electronVersion:'44.5.1',
 directories:{app:'.runtime/desktop-alpha-stage/shell',output:'dist/desktop/'+version},
 asar:true,npmRebuild:false,files:['main.cjs','permission-policy.cjs','runtime-environment.cjs','preload.cjs','package.json','!node_modules/**/*'],
 extraFiles:[{from:'apps/desktop/AppRun.alpha',to:'AppRun'}],appImage:{executableArgs:[]},
 extraResources:[{from:'.runtime/desktop-alpha-stage/backend',to:'backend',filter:['**/*']},{from:'.runtime/desktop-alpha-stage/backend/node_modules',to:'backend/node_modules',filter:['**/*']},{from:'.runtime/desktop-alpha-stage/notices',to:'notices',filter:['**/*']}],
 linux:{target:['AppImage'],executableName:'bambi-local',category:'AudioVideo',maintainer:'BambiOS',artifactName:'bambi-local-${version}-${arch}.${ext}'},publish:null,
};
