// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** One live control surface inside the picture, for mouse, touch and keyboard. */
export function initSessionControls() {
 const dock=document.querySelector<HTMLElement>('.session-dock')!;
 const stage=document.getElementById('stage')!;
 const anchor=document.getElementById('session-control-anchor')!;
 stage.append(dock);anchor.hidden=true;
 let lastActivity=performance.now(),overDock=false,keyboard=false,fullscreen=false,scrollPosition=0;
 const reveal=()=>{lastActivity=performance.now();stage.classList.add('controls-visible');stage.classList.remove('controls-hidden');};
 stage.addEventListener('pointermove',reveal);
 stage.addEventListener('pointerenter',reveal);
 stage.addEventListener('pointerdown',()=>{keyboard=false;reveal();});
 stage.addEventListener('keydown',()=>{keyboard=true;reveal();});
 stage.addEventListener('focusin',reveal);
 dock.addEventListener('pointerenter',()=>{overDock=true;reveal();});
 dock.addEventListener('pointerleave',()=>{overDock=false;lastActivity=performance.now();});
 document.addEventListener('player-controls-open',()=>{reveal();stage.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
 document.addEventListener('fullscreenchange',()=>{
  const next=document.fullscreenElement===stage;if(next===fullscreen)return;fullscreen=next;
  const button=document.getElementById('fullscreen')!;button.setAttribute('aria-pressed',String(next));button.setAttribute('aria-label',next?'Exit fullscreen':'Enter fullscreen');button.title=(next?'Exit fullscreen':'Enter fullscreen')+' (F)';
  if(next){scrollPosition=scrollY;stage.focus({preventScroll:true});}
  else{document.getElementById('fullscreen')!.focus({preventScroll:true});requestAnimationFrame(()=>scrollTo({top:scrollPosition,behavior:'instant'}));}
  document.dispatchEvent(new CustomEvent('player-fullscreen',{detail:{active:next}}));reveal();
 });
 return {
  present(wall:number){
   const focus=document.activeElement===document.getElementById('chat-input')||keyboard&&stage.contains(document.activeElement);
   const show=overDock||focus||wall-lastActivity<2400;
   stage.classList.toggle('controls-visible',show);stage.classList.toggle('controls-hidden',!show);
  },reveal,
 };
}
