// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { WiperFrame } from '../audio/wiper';

// Paired tandem geometry with extended travel: both arms leave the image before reversing.
// Mounts are below the visible windshield; the glass clip hides them at every aspect ratio.
export function windshieldLayout(width = 1000, height = 700) {
  const w = Math.max(1, width), h = Math.max(1, height), y = h + h * 3 / 35;
  return [
    { x: w * .46, y, rest: -100, raised: 100, reach: Math.max(y * 1.03, w * .55), inner: h * .25 },
    { x: w * .93, y, rest: -102, raised: 98, reach: Math.max(y * 1.1, w * .65), inner: h * .27 },
  ];
}
type Blade = ReturnType<typeof windshieldLayout>[number];
const blades = windshieldLayout();
function point(blade: Blade, angle: number, radius = Math.max(blade.y, blade.x, blade.reach) * 3) {
  const radians = angle * Math.PI / 180;
  return `${blade.x + Math.sin(radians) * radius} ${blade.y - Math.cos(radians) * radius}`;
}
function sector(blade: Blade, from: number, to: number) {
  // Intermediate outer points keep the fan outside the glass even for almost-horizontal arms.
  const rays = [point(blade, from)];
  for (let angle = from + 15; angle < to; angle += 15) rays.push(point(blade, angle));
  rays.push(point(blade, to));
  return `M${blade.x} ${blade.y} L${rays.join(' L')} Z`;
}
/** Intersect the unswept sectors: either blade can clear a portion of the word. */
export function windshieldPose(frame: WiperFrame, layout: readonly Blade[] = blades) {
  const progress = Math.min(1, Math.max(0, frame.x));
  return layout.map(blade => {
    const angle = blade.rest + progress * (blade.raised - blade.rest);
    // Beyond horizontal, the entire arm is below the glass. Clamp only the word mask,
    // while the actual geometry keeps travelling out of view before reversing.
    const maskAngle = Math.min(89, Math.max(-89, angle));
    const from = frame.direction > 0 ? maskAngle : -89, to = frame.direction > 0 ? 89 : maskAngle;
    const clip = frame.remaining <= 0 ? 'M0 0Z' : sector(blade, from, to);
    const tail = angle - frame.direction * 5;
    const sheen = `M${point(blade, angle, blade.reach)} A${blade.reach} ${blade.reach} 0 0 ${frame.direction > 0 ? 0 : 1} ${point(blade, tail, blade.reach)} L${point(blade, tail, blade.inner)} A${blade.inner} ${blade.inner} 0 0 ${frame.direction > 0 ? 1 : 0} ${point(blade, angle, blade.inner)} Z`;
    return { angle, clip, sheen, x: blade.x, y: blade.y };
  });
}

function bladeMarkup(blade: Blade, id: string) {
  const clamp = (blade.inner + blade.reach) / 2;
  return `
            <path d="M0 0 L-12 -75 L-5 -${clamp - 24} L0 -${clamp}" fill="none" stroke="#09080c" stroke-width="13" stroke-linejoin="round"/>
            <path d="M0 0 L-12 -75 L-5 -${clamp - 24} L0 -${clamp}" fill="none" stroke="url(#${id}-metal)" stroke-width="7" stroke-linejoin="round"/>
            <rect x="-6" y="-${blade.reach}" width="12" height="${blade.reach - blade.inner}" rx="5" fill="#09080c"/>
            <path d="M-2 -${blade.reach - 8} L-2 -${blade.inner + 8}" stroke="#655660" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M3 -${blade.reach - 8} Q7 -${clamp} 3 -${blade.inner + 8}" fill="none" stroke="#f5aaca" stroke-width="1.5" stroke-opacity=".6"/>
            <rect x="-9" y="-${clamp + 16}" width="18" height="32" rx="4" fill="url(#${id}-metal)" stroke="#130d18" stroke-width="2"/>
`;
}

let sequence = 0;
/** Original paired rubber blades and articulated arms, sampled only from the audio clock. */
export class WiperOverlay {
  private layout = blades;
  private height = 700;
  private metalId = '';
  private lastFrame?: { frame: WiperFrame; reduced: boolean };
  private layer = document.createElement('div');
  private svg: SVGSVGElement;
  private word: SVGTextElement;
  private blades: SVGGElement[];
  private masks: SVGPathElement[];
  private sheens: SVGPathElement[];
  constructor(canvas: HTMLCanvasElement) {
    const id = this.metalId = `windshield-${++sequence}`;
    this.layer.dataset.wiperLayer = 'sweep'; this.layer.setAttribute('aria-hidden', 'true');
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:8;display:none;';
    // Original vector geometry, without extra animation timers or imported assets.
    this.layer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;overflow:hidden">
      <defs>
        <linearGradient id="${id}-metal" x1="0" x2="1"><stop stop-color="#201821"/><stop offset=".3" stop-color="#795064"/><stop offset=".46" stop-color="#e4b6cb"/><stop offset=".62" stop-color="#744252"/><stop offset="1" stop-color="#19131c"/></linearGradient>
        <clipPath id="${id}-glass" clipPathUnits="userSpaceOnUse"><rect width="1000" height="700"/></clipPath>
        ${blades.map((_, i) => `<clipPath id="${id}-clear-${i}" clipPathUnits="userSpaceOnUse"><path data-wiper-clip="${i}"/></clipPath>`).join('')}
      </defs>
      <g clip-path="url(#${id}-glass)">
        <g clip-path="url(#${id}-clear-0)"><g clip-path="url(#${id}-clear-1)">
          <text data-wiper-word="" x="500" y="352" text-anchor="middle" dominant-baseline="middle" fill="#ffc0e6" stroke="#f65eaf" stroke-width=".7" style="font:700 58px 'Trebuchet MS',sans-serif;letter-spacing:3px"></text>
        </g></g>
        ${blades.map((blade, i) => `<path data-wiper-sheen="${i}" fill="#f78fc7" opacity="0"/>
          <g data-wiper-blade="${i}" transform="translate(${blade.x} ${blade.y}) rotate(${blade.rest})">${bladeMarkup(blade, id)}</g>`).join('')}
      </g>
    </svg>`;
    this.svg = this.layer.querySelector('svg')!;
    this.word = this.layer.querySelector('[data-wiper-word]')!;
    this.blades = Array.from(this.layer.querySelectorAll<SVGGElement>('[data-wiper-blade]'));
    this.masks = Array.from(this.layer.querySelectorAll<SVGPathElement>('[data-wiper-clip]'));
    this.sheens = Array.from(this.layer.querySelectorAll<SVGPathElement>('[data-wiper-sheen]'));
    canvas.parentNode?.appendChild(this.layer);
  }
  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    const logicalHeight = 1000 * height / width;
    if (Math.abs(this.height - logicalHeight) < .01) return;
    this.height = logicalHeight;
    this.layout = windshieldLayout(1000, this.height);
    this.svg.setAttribute('viewBox', `0 0 1000 ${this.height}`);
    this.svg.querySelector('clipPath rect')!.setAttribute('height', String(this.height));
    this.word.setAttribute('y', String(this.height / 2));
    this.word.style.fontSize = `${Math.min(58, this.height * .083)}px`;
    this.blades.forEach((blade, i) => { blade.innerHTML = bladeMarkup(this.layout[i], this.metalId); });
    if (this.lastFrame) this.update(this.lastFrame.frame, this.lastFrame.reduced);
  }
  update(frame: WiperFrame, reduced: boolean) {
    this.lastFrame = { frame, reduced };
    if (!frame.active && !frame.visible) {
      if (this.layer.style.display !== 'none') { this.layer.style.display = 'none'; this.word.textContent = ''; }
      return;
    }
    this.layer.style.display = 'block';
    this.layer.dataset.stroke = String(frame.stroke); this.layer.dataset.position = frame.x.toFixed(4);
    if (this.word.textContent !== frame.text) this.word.textContent = frame.text;
    windshieldPose(frame, this.layout).forEach((pose, i) => {
      this.blades[i].style.display = reduced ? 'none' : '';
      this.blades[i].setAttribute('transform', `translate(${pose.x} ${pose.y}) rotate(${pose.angle})`);
      this.masks[i].setAttribute('d', reduced ? `M0 0H1000V${this.height}H0Z` : pose.clip);
      this.sheens[i].setAttribute('d', pose.sheen);
      this.sheens[i].setAttribute('opacity', String(reduced ? 0 : frame.strength * .06));
    });
    this.word.style.opacity = String(reduced ? frame.remaining * .8 : 1);
    this.svg.dataset.motion = reduced ? 'reduced' : 'windshield';
  }
}
