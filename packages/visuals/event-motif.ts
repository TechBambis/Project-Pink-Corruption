// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export type MotifForm = 'ring' | 'heart' | 'gears';
/** Original procedural geometry. No reference imagery or external asset requests. */
export function motifSvg(form: Exclude<MotifForm, 'ring'>) {
  const defs = '<defs><radialGradient id="motif-pink"><stop stop-color="#fff0f8"/><stop offset=".28" stop-color="#f9a3d3"/><stop offset=".72" stop-color="#d93691"/><stop offset="1" stop-color="#641d53"/></radialGradient></defs>';
  if (form === 'heart') return `<svg viewBox="0 0 200 200" aria-hidden="true">${defs}<path d="M100 174C80 155 26 124 24 77C22 34 74 22 100 55C126 22 178 34 176 77C174 124 120 155 100 174Z" fill="url(#motif-pink)" stroke="#f5bfdc" stroke-width="1.5"/><path d="M43 65C46 45 68 41 80 55" fill="none" stroke="#fff4fc" stroke-width="8" stroke-linecap="round" opacity=".65"/></svg>`;
  const gears = [[100,100,40,1],[39,100,21,-1],[162,100,22,-1],[100,37,23,-1],[100,164,24,-1]];
  const shapes = gears.map(([x,y,r,d],index) => {
    const points = Array.from({length:64},(_,i) => { const a=i/64*Math.PI*2, radius=r*(i%4===0||i%4===3?1:.88);return `${(Math.cos(a)*radius).toFixed(2)},${(Math.sin(a)*radius).toFixed(2)}`; }).join(' ');
    return `<g transform="translate(${x} ${y})"><g data-gear="${index}" data-direction="${d}" data-radius="${r}"><polygon points="${points}" fill="url(#motif-pink)" stroke="#f6badb" stroke-width="1"/><circle r="${r*.55}" fill="#2a1330" stroke="#d866ac" stroke-width="2"/><path d="M0 0C-9 -8 13 -13 16 0C20 22 -30 28 -28 0" transform="scale(${r*.55/30})" fill="none" stroke="#f6b6d6" stroke-width="2"/></g></g>`;
  }).join('');
  return `<svg viewBox="0 0 200 200" aria-hidden="true">${defs}${shapes}</svg>`;
}
export function motifTurn(form: MotifForm, atMs: number, reduced: boolean) {
  return !reduced && form === 'heart' ? Math.sin(atMs / 4800 * Math.PI * 2) * 76 : 0;
}
export function gearTurn(atMs: number, radius: number, direction: number, reduced: boolean) {
  return reduced ? 0 : atMs / 12000 * 360 * 40 / radius * direction;
}
