// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type {BambiCloudTrack} from '../../../packages/media/bambicloud';
export interface LibraryItem{id:string;file?:File;remote?:BambiCloudTrack;favorite:boolean;notes:string;tags:string}
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const name=(track:LibraryItem)=>track.file?.name??track.remote?.title??'Unavailable session';
const duration=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
const copy=(tag:string,className:string,text:string)=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;};

/** Collection navigation is local UI state; it never changes the playback queue. */
export class SessionLibrary<T extends LibraryItem>{
 private collection='all';private editing:T|null=null;
 constructor(private host:{items:()=>T[];selected:()=>number;choose:(index:number)=>void;save:()=>void;analyze:(track:T,info:HTMLElement,button:HTMLButtonElement)=>Promise<void>}){
  el('library-filter').addEventListener('input',()=>this.render());
  const dialog=el<HTMLDialogElement>('library-notes');
  el('library-notes-cancel').onclick=()=>dialog.close();
  el<HTMLFormElement>('library-notes-form').onsubmit=event=>{event.preventDefault();if(this.editing){this.editing.notes=el<HTMLTextAreaElement>('library-notes-text').value;this.editing.tags=el<HTMLInputElement>('library-notes-tags').value;this.host.save();}dialog.close();this.render();};
 }
 render(){
  const items=this.host.items(),selected=this.host.selected();
  const groups=new Map<string,{title:string;count:number}>();
  for(const item of items)if(item.remote){const key='cloud:'+item.remote.playlistId;const group=groups.get(key);if(group)group.count++;else groups.set(key,{title:item.remote.playlistTitle,count:1});}
  if(!['all','favorites','local'].includes(this.collection)&&!groups.has(this.collection))this.collection='all';
  const collections=[{key:'all',title:'All sessions',count:items.length},{key:'favorites',title:'Favorites',count:items.filter(t=>t.favorite).length},{key:'local',title:'On this device',count:items.filter(t=>t.file).length},...[...groups].map(([key,group])=>({key,...group}))];
  const rail=el('library-collections');rail.replaceChildren();
  for(const group of collections){const button=document.createElement('button');button.type='button';button.dataset.collection=group.key;button.setAttribute('aria-pressed',String(this.collection===group.key));button.append(copy('span','',group.title),copy('small','',String(group.count)));button.onclick=()=>{this.collection=group.key;this.render();rail.querySelector<HTMLButtonElement>(`[data-collection="${group.key}"]`)?.focus({preventScroll:true});};rail.append(button);}
  el('collection-title').textContent=collections.find(c=>c.key===this.collection)!.title;
  const query=el<HTMLInputElement>('library-filter').value.trim().toLocaleLowerCase();
  const visible=items.map((track,index)=>({track,index})).filter(({track})=>{
   const collection=this.collection==='all'||this.collection==='favorites'&&track.favorite||this.collection==='local'&&!!track.file||this.collection==='cloud:'+track.remote?.playlistId;
   return collection&&(!query||[name(track),track.remote?.playlistTitle,track.remote?.author,track.tags,...(track.remote?.triggers??[])].join(' ').toLocaleLowerCase().includes(query));
  });
  el('collection-count').textContent=`${visible.length} ${visible.length===1?'session':'sessions'}`;
  const chosen=items[selected];el('library-selection').hidden=!chosen;if(chosen)el('library-selected-name').textContent=name(chosen);
  const container=el('tracks');container.replaceChildren();
  if(!visible.length){const empty=copy('div','collection-empty','');empty.append(copy('span','',query?'No matches yet.':items.length?'Nothing here yet.':'Make a little room for your favorites.'),copy('p','',query?'Try another title, author or trigger.':this.collection==='favorites'?'Tap a heart to keep a session here.':'Add files or paste a BambiCloud playlist above.'));container.append(empty);return;}
  for(const {track,index} of visible){
   const locked=!!track.remote&&!track.remote.url;
   const row=document.createElement('div');row.className='track';row.dataset.selected=String(index===selected);row.dataset.locked=String(locked);
   const play=document.createElement('button');play.type='button';play.className='track-select';play.textContent=locked?'◇':index===selected?'♥':'▶';play.setAttribute('aria-label',`Choose ${name(track)}`);play.setAttribute('aria-pressed',String(index===selected));play.disabled=locked;play.onclick=()=>this.host.choose(index);
   const info=document.createElement('div');info.className='track-info';
   const title=document.createElement('button');title.type='button';title.className='track-name';title.textContent=name(track);title.disabled=locked;title.onclick=()=>this.host.choose(index);info.append(title);
   const meta=track.remote?`${track.remote.author} · ${duration(track.remote.durationMs)}${locked?' · '+(track.remote.locked?'Membership required':'Unavailable'):''}`:`On this device · ${((track.file?.size??0)/1024/1024).toFixed(1)} MB`;
   info.append(copy('small','track-meta',meta));if(track.tags)info.append(copy('small','track-tags',track.tags));
   if(track.remote?.warnings?.length)info.append(copy('small','track-warning','Content notes: '+track.remote.warnings.join(', ')));
   const favorite=document.createElement('button');favorite.type='button';favorite.className='favorite'+(track.favorite?' active':'');favorite.textContent=track.favorite?'♥':'♡';favorite.setAttribute('aria-label',track.favorite?'Remove from favorites':'Add to favorites');favorite.setAttribute('aria-pressed',String(track.favorite));favorite.onclick=()=>{track.favorite=!track.favorite;this.host.save();this.render();};
   const menu=document.createElement('details');menu.className='track-menu';const summary=copy('summary','','⋯');summary.setAttribute('aria-label','Options for '+name(track));menu.append(summary);
   const actions=copy('div','track-menu-actions','');
   const notes=document.createElement('button');notes.type='button';notes.textContent='Notes & tags';notes.onclick=()=>{menu.open=false;this.editing=track;el('library-notes-title').textContent=name(track);el<HTMLTextAreaElement>('library-notes-text').value=track.notes;el<HTMLInputElement>('library-notes-tags').value=track.tags;el<HTMLDialogElement>('library-notes').showModal();};actions.append(notes);
   if(track.file){const analyze=document.createElement('button');analyze.type='button';analyze.textContent='Analyze audio';analyze.onclick=()=>{menu.open=false;void this.host.analyze(track,info,analyze);};actions.append(analyze);}
   menu.append(actions);row.append(play,info,favorite);
   if(track.remote){
    const badge=copy('span','cue-badge','');badge.dataset.available=String(!!track.remote.cueUrl);
    badge.title=track.remote.cueUrl?'Timed trigger cues available':'No timed trigger cues';badge.setAttribute('aria-label',badge.title);badge.setAttribute('role','img');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M4 5v14M12 9v10M20 3v16M2 8h4M10 12h4M18 6h4');svg.append(path);badge.append(svg);row.append(badge);
   }
   row.append(menu);container.append(row);
  }
 }
}
