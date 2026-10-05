// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export const moanVariationIds=['moan','moan_alt','moan_third'] as const;

/** Shuffle available recordings once per round, avoiding repeats across rounds. */
export class MoanVariations {
 private pool='';private bag:string[]=[];private last:string|undefined;
 constructor(private random=()=>Math.random()){}
 next(available:Iterable<string>){
  const loaded=new Set(available),ids=moanVariationIds.filter(id=>loaded.has(id)),pool=ids.join(',');
  if(pool!==this.pool){this.pool=pool;this.bag=[];}
  if(!ids.length)return;
  if(!this.bag.length){
   this.bag=[...ids];
   for(let i=this.bag.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];}
   if(this.bag.length>1&&this.bag.at(-1)===this.last){const end=this.bag.length-1;[this.bag[0],this.bag[end]]=[this.bag[end],this.bag[0]];}
  }
  return this.last=this.bag.pop();
 }
}
