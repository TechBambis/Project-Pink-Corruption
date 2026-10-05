// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export async function transcribe(wav:Blob,signal:AbortSignal,url='http://127.0.0.1:8081',vocabulary='') {
 const form=new FormData();form.append('file',wav,'speech.wav');form.append('response_format','verbose_json');
 form.append('language','auto');form.append('temperature','0.0');if(vocabulary)form.append('prompt',vocabulary);
 const response=await fetch(url+'/inference',{method:'POST',body:form,signal});
 if(!response.ok)throw Error('Whisper HTTP '+response.status);return response.json();
}
