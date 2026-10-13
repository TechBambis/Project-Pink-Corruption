// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only

/** The latest reply and a user-owned draft share one field; no per-frame work. */
export function initPlayerComposer(){
 const form=document.getElementById('chat-form') as HTMLFormElement;
 const input=document.getElementById('chat-input') as HTMLTextAreaElement;
 const preview=document.getElementById('composer-reply')!;
 const messages=document.getElementById('messages')!;
 const send=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
 let locked=false;
 const invitation=()=>locked?'Bambi leads this session. Choose your journey, then press Start.':'Message Bambi, or turn on your mic.';
 let latest=invitation();
 let draft:string|undefined;
 let heard='';
 function show(text:string){
  if(text!==latest){const atEnd=preview.scrollHeight-preview.scrollTop-preview.clientHeight<24;latest=text;preview.textContent=text;if(atEnd)preview.scrollTop=preview.scrollHeight;}
  sync();
 }
 function sync(){
  const drafting=!!input.value.length;
  // An empty focused input still shows the scrollable reply after Enter.
  const editing=drafting&&!locked;
  form.dataset.editing=String(editing);
  form.dataset.drafting=String(drafting);
  preview.hidden=editing;
  input.placeholder=latest;
  input.disabled=locked;send.disabled=locked||!input.value.trim();
  if(draft!==input.value){
   draft=input.value;input.style.height='48px';
   if(drafting)input.style.height=Math.min(104,Math.max(48,input.scrollHeight))+'px';
  }
 }
 function readReply(){
  const replies=messages.querySelectorAll<HTMLElement>('.message p');
  const reply=replies[replies.length-1];
  const text=reply?(reply.dataset.displayText??reply.textContent?.trim()??''):invitation();
  show(heard||text||'Bambi is replying…');
 }
 // Token updates are batched by the browser. No second stream or audio request.
 new MutationObserver(readReply).observe(messages,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-display-text']});
 input.addEventListener('input',sync);
 input.addEventListener('focus',sync);
 input.addEventListener('blur',sync);
 preview.addEventListener('click',()=>{if(!locked)input.focus();});
 form.addEventListener('submit',sync);
 readReply();
 return {setInputAllowed(allowed:boolean){locked=!allowed;form.dataset.inputAllowed=String(allowed);readReply();},hearing(text:string){heard=text;readReply();},clearHearing(){if(heard){heard='';readReply();}}};
}
