// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Five-layer approach reviewed in slmingol/bass-drop-creator at
 * 33c699629896be9ac065ac4ecb22ec58bda74e14: sub, sweep, punch, rumble, body.
 * Original implementation: upstream has no LICENSE, so its source is not copied.
 * No psychological-effect claims are associated with these synthesis settings.
 */
export function layeredBassSweep(name:string,rate:number,duration:number,from:number,to:number){
  const samples=new Float32Array(Math.round(duration*rate));
  const rising=to>from,soft=name==='sub_fall'||name==='sinking'||rising;
  const drive=name==='sub_fall'?1.6:name==='descent'?1.3:1.1;
  const cutoff=Math.min(140,Math.max(45,Math.min(from,to)*1.7));
  const alpha=1-Math.exp(-2*Math.PI*cutoff/rate);
  const subHz=rising?from:to,bodyHz=Math.max(60,subHz*1.5);
  const audible=Math.min(from,to)>=120;
  let seed=0x513a5c27,rumbleA=0,rumbleB=0,phase=0;
  for(let i=0;i<samples.length;i++){
    const t=i/rate,p=t/duration,hz=from*(to/from)**p;
    // Integrate the exponential glide, retaining phase continuity across samples.
    phase+=2*Math.PI*hz/rate;
    seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
    const noise=(seed>>>0)/0x80000000-1;
    rumbleA+=alpha*(noise-rumbleA);rumbleB+=alpha*(rumbleA-rumbleB);
    const attack=Math.min(1,t/(soft?.035:.008));
    const release=Math.min(1,(duration-t)/.09);
    const sweep=Math.sin(phase)*Math.exp(-p*.7);
    const sub=Math.sin(2*Math.PI*subHz*t)*Math.exp(-p*1.4)*.24;
    const body=Math.sin(2*Math.PI*bodyHz*t)*(1-Math.exp(-t*5))*Math.exp(-p*2)*.13;
    const punchA=audible?subHz:100,punchB=audible?subHz*1.25:80;
    const punch=soft?0:(Math.sin(2*Math.PI*punchA*t)+Math.sin(2*Math.PI*punchB*t))*.1*(1-Math.exp(-t*100))*Math.exp(-t*12);
    const rumble=audible?0:rumbleB*.28*Math.exp(-p*1.5);
    samples[i]=Math.tanh((sweep+sub+body+punch+rumble)*drive)/Math.tanh(drive)*attack*release;
  }
  let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
  if(peak)for(let i=0;i<samples.length;i++)samples[i]*=10**(-1/20)/peak;
  return samples;
}
