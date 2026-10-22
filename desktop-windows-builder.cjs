// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
const alpha=process.env.BAMBI_WINDOWS_PHASE==='alpha',productName=alpha?'Bambi Local':'Bambi Local Smoke';
module.exports={
 appId:alpha?'local.bambi.alpha':'local.bambi.smoke',productName,electronVersion:'44.5.1',
 directories:{app:'.runtime/desktop-windows-stage/shell',output:'dist/desktop-windows/'+(process.env.BAMBI_WINDOWS_VERSION||'0.1.0-smoke.2')},
 electronDist:process.env.BAMBI_ELECTRON_DIST||'.runtime/desktop-windows-electron',
 asar:true,npmRebuild:false,files:['main.cjs','permission-policy.cjs','runtime-environment.cjs','preload.cjs','package.json','!node_modules/**/*'],
 extraResources:[{from:'.runtime/desktop-windows-stage/backend',to:'backend',filter:['**/*']},{from:'.runtime/desktop-windows-stage/backend/node_modules',to:'backend/node_modules',filter:['**/*']},{from:'.runtime/desktop-windows-stage/notices',to:'notices',filter:['**/*']}],
 win:{target:alpha?[{target:'nsis',arch:['x64']},{target:'zip',arch:['x64']}]:[{target:'nsis',arch:['x64']}],artifactName:alpha?'bambi-local-${version}-windows-x64.${ext}':'bambi-local-${version}-x64.${ext}',requestedExecutionLevel:'asInvoker'},
 nsis:{artifactName:'bambi-local-${version}-x64.exe',oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,runAfterFinish:false,deleteAppDataOnUninstall:false,shortcutName:productName},
 publish:null,
};
