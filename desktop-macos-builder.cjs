// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
module.exports={
 appId:'local.bambi.smoke',productName:'Bambi Local Smoke',electronVersion:'44.5.1',
 directories:{app:'.runtime/desktop-macos-stage/shell',output:'dist/desktop-macos/'+process.env.BAMBI_MACOS_VERSION},
 asar:true,npmRebuild:false,
 files:['main.cjs','permission-policy.cjs','runtime-environment.cjs','package.json','!node_modules/**/*'],
 extraResources:[{from:'.runtime/desktop-macos-stage/backend',to:'backend',filter:['**/*']},{from:'.runtime/desktop-macos-stage/backend/node_modules',to:'backend/node_modules',filter:['**/*']},{from:'.runtime/desktop-macos-stage/notices',to:'notices',filter:['**/*']}],
 mac:{target:[{target:'zip',arch:['arm64']}],category:'public.app-category.entertainment',minimumSystemVersion:'13.0',
  artifactName:'bambi-local-${version}-macos-${arch}.${ext}',identity:'-',hardenedRuntime:true,notarize:false,
  entitlements:'apps/desktop/macos-entitlements.plist',entitlementsInherit:'apps/desktop/macos-entitlements.plist',
  // Preserve pinned native resource bytes, including the official Node signature.
  signIgnore:['Contents/Resources/backend/'],
  extendInfo:{NSMicrophoneUsageDescription:'Bambi Local uses your microphone for local speech recognition when you enable microphone access.'}},
 publish:null,
};
