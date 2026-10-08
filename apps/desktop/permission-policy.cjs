// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
/** A denied preliminary check forces media requests through a fresh backend consent check. */
function permissionHandlers({alpha,origin,ownedContents,readAccess}){
 return {
  check:()=>false,
  request:(contents,permission,callback,details)=>{
   let trusted=false;
   try{trusted=alpha&&contents===ownedContents()&&new URL(contents.getURL()).origin===origin
    &&permission==='media'&&details.isMainFrame===true&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio';}catch{}
   if(!trusted){callback(false);return;}
   Promise.resolve().then(readAccess).then(record=>callback(record?.configured===true&&record.choices?.microphone===true),()=>callback(false));
  },
 };
}
module.exports={permissionHandlers};
