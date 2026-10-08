// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
module.exports={
 appId:'local.bambi.smoke',productName:'Bambi Local Smoke',electronVersion:'44.5.1',
 directories:{app:'.runtime/desktop-stage/shell',output:process.env.BAMBI_SMOKE_VERSION?'dist/desktop/'+process.env.BAMBI_SMOKE_VERSION:'dist/desktop'},
 asar:true,npmRebuild:false,files:['main.cjs','permission-policy.cjs','runtime-environment.cjs','package.json','!node_modules/**/*'],
 extraFiles:[{from:'apps/desktop/AppRun',to:'AppRun'}],
 appImage:{executableArgs:[]},
 extraResources:[{from:'.runtime/desktop-stage/backend',to:'backend',filter:['**/*']},{from:'.runtime/desktop-stage/backend/node_modules',to:'backend/node_modules',filter:['**/*']},{from:'.runtime/desktop-stage/notices',to:'notices',filter:['**/*']}],
 linux:{target:['AppImage'],executableName:'bambi-local-smoke',category:'AudioVideo',maintainer:'BambiOS',artifactName:'bambi-local-${version}-${arch}.${ext}'},
 publish:null,
};
