// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { WiperFrame } from '../audio/wiper';

const pivot = { x: 500, y: 690 }, limit = 64;
function point(angle: number, radius = 1800) {
  const radians = angle * Math.PI / 180;
  return `${pivot.x + Math.sin(radians) * radius} ${pivot.y - Math.cos(radians) * radius}`;
}
/** The remaining word occupies the unswept sector of the physical blade's arc. */
export function windshieldPose(frame: WiperFrame) {
  const angle = -limit + Math.min(1, Math.max(0, frame.x)) * limit * 2;
  const from = frame.direction > 0 ? angle : -limit, to = frame.direction > 0 ? limit : angle;
  const clip = frame.remaining <= 0 ? 'M0 0Z' : `M${pivot.x} ${pivot.y} L${point(from)} L${point(to)} Z`;
  const tail = angle - frame.direction * 7;
  const sheen = `M${point(angle, 570)} A570 570 0 0 ${frame.direction > 0 ? 0 : 1} ${point(tail, 570)} L${point(tail, 180)} A180 180 0 0 ${frame.direction > 0 ? 1 : 0} ${point(angle, 180)} Z`;
  return { angle, clip, sheen };
}

let sequence = 0;
/** Original car-style rubber blade and articulated arm, sampled only from the audio clock. */
export class WiperOverlay {
  private layer = document.createElement('div');
  private svg: SVGSVGElement;
  private word: SVGTextElement;
  private blade: SVGGElement;
  private mask: SVGPathElement;
  private sheen: SVGPathElement;
  constructor(canvas: HTMLCanvasElement) {
    const id = `windshield-${++sequence}`;
    this.layer.dataset.wiperLayer = 'sweep'; this.layer.setAttribute('aria-hidden', 'true');
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:8;display:none;';
    // Inline original vector geometry: sharp at any resolution, no imported animation or timers.
    this.layer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;overflow:visible">
      <defs>
        <linearGradient id="${id}-metal" x1="0" x2="1"><stop stop-color="#372338"/><stop offset=".3" stop-color="#ba7796"/><stop offset=".46" stop-color="#ffe1ef"/><stop offset=".62" stop-color="#99516f"/><stop offset="1" stop-color="#261c2b"/></linearGradient>
        <clipPath id="${id}-clear" clipPathUnits="userSpaceOnUse"><path data-wiper-clip=""/></clipPath>
      </defs>
      <text data-wiper-word="" x="500" y="352" text-anchor="middle" dominant-baseline="middle" clip-path="url(#${id}-clear)" fill="#ffc0e6" stroke="#f65eaf" stroke-width=".7" style="font:700 58px 'Trebuchet MS',sans-serif;letter-spacing:3px"></text>
      <path data-wiper-sheen="" fill="#f78fc7" opacity="0"/>
      <g data-wiper-blade="" transform="translate(500 690) rotate(-64)">
        <path d="M0 0 L-15 -70 L-7 -330 L0 -354" fill="none" stroke="#09080c" stroke-width="17" stroke-linejoin="round"/>
        <path d="M0 0 L-15 -70 L-7 -330 L0 -354" fill="none" stroke="url(#${id}-metal)" stroke-width="10" stroke-linejoin="round"/>
        <rect x="-8" y="-576" width="16" height="398" rx="7" fill="#09080c"/>
        <path d="M-3 -565 L-3 -190" stroke="#75616d" stroke-width="2" stroke-linecap="round"/>
        <path d="M3 -566 Q9 -390 3 -189" fill="none" stroke="#ffacda" stroke-width="2" stroke-opacity=".75"/>
        <path d="M-5 -491 L-5 -462 M-5 -390 L-5 -361 M-5 -287 L-5 -258" stroke="#211820" stroke-width="5"/>
        <rect x="-12" y="-374" width="24" height="39" rx="5" fill="url(#${id}-metal)" stroke="#130d18" stroke-width="2"/>
        <circle cx="0" cy="0" r="16" fill="#100b15" stroke="#c987a7" stroke-width="3"/>
        <circle cx="0" cy="0" r="5" fill="#ebaccd"/>
      </g>
    </svg>`;
    this.svg = this.layer.querySelector('svg')!;
    this.word = this.layer.querySelector('[data-wiper-word]')!;
    this.blade = this.layer.querySelector('[data-wiper-blade]')!;
    this.mask = this.layer.querySelector('[data-wiper-clip]')!;
    this.sheen = this.layer.querySelector('[data-wiper-sheen]')!;
    canvas.parentNode?.appendChild(this.layer);
  }
  update(frame: WiperFrame, reduced: boolean) {
    if (!frame.active && !frame.visible) {
      if (this.layer.style.display !== 'none') { this.layer.style.display = 'none'; this.word.textContent = ''; }
      return;
    }
    this.layer.style.display = 'block';
    this.layer.dataset.stroke = String(frame.stroke); this.layer.dataset.position = frame.x.toFixed(4);
    if (this.word.textContent !== frame.text) this.word.textContent = frame.text;
    const pose = windshieldPose(frame);
    this.layer.dataset.angle = pose.angle.toFixed(3);
    this.blade.style.display = reduced ? 'none' : '';
    this.blade.setAttribute('transform', `translate(${pivot.x} ${pivot.y}) rotate(${pose.angle})`);
    this.mask.setAttribute('d', reduced ? 'M0 0H1000V700H0Z' : pose.clip);
    this.word.style.opacity = String(reduced ? frame.remaining * .8 : 1);
    this.sheen.setAttribute('d', pose.sheen);
    this.sheen.setAttribute('opacity', String(reduced ? 0 : frame.strength * .12));
    this.svg.dataset.motion = reduced ? 'reduced' : 'windshield';
  }
}
