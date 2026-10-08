// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
/** Load local recordings only in our app, never in an extension on another page. */
export function isAppAudioOrigin(origin=globalThis.location?.origin??'',marked=typeof document!=='undefined'&&!!document.querySelector('meta[name="bambi-app"]')){
 try{const url=new URL(origin);return marked&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);}catch{return false;}
}
