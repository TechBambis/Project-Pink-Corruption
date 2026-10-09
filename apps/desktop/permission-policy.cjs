// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
/** A denied preliminary check forces media requests through a fresh backend consent check. */
function permissionHandlers({alpha,origin,ownedContents,readAccess,askSystemAccess}){
 return {
  check:()=>false,
  request:(contents,permission,callback,details)=>{
   const trusted=()=>{try{return alpha&&contents===ownedContents()&&new URL(contents.getURL()).origin===origin
    &&permission==='media'&&details.isMainFrame===true&&details.mediaTypes?.length===1&&details.mediaTypes[0]==='audio';}catch{return false;}};
   const allowed=record=>record?.configured===true&&record.choices?.microphone===true;
   if(!trusted()){callback(false);return;}
   Promise.resolve().then(readAccess).then(async record=>{
    if(!allowed(record))return false;
    if(!askSystemAccess)return true;
    if(!await askSystemAccess())return false;
    // Consent or the owning page can change while the native prompt is open.
    const current=await readAccess();return trusted()&&allowed(current);
   }).then(callback,()=>callback(false));
  },
 };
}
module.exports={permissionHandlers};
