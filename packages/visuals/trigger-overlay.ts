// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import type { emptyTriggerFrame } from './trigger-effects';

/** Pointer-transparent layers; the host owns timing and motion preferences. */
export class TriggerOverlay {
  private flash = document.createElement('div');
  private black = document.createElement('div');
  private pink = document.createElement('div');
  private eye = document.createElement('div');
  constructor(private canvas: HTMLCanvasElement, private host?: HTMLElement) {
    for (const [layer, color, name] of [[this.flash, '#ff1744', 'flash'], [this.black, '#000000', 'black'], [this.pink, '#ff80c0', 'pink']] as const) {
      layer.setAttribute('aria-hidden', 'true');
      layer.dataset.triggerLayer = name;
      layer.style.cssText = `position:absolute;inset:0;background:${color};opacity:0;pointer-events:none;z-index:2;`;
      canvas.parentNode?.appendChild(layer);
    }
    this.eye.setAttribute('aria-hidden','true');this.eye.dataset.triggerLayer='eye';
    this.eye.style.cssText='position:absolute;inset:0;background:#000;pointer-events:none;z-index:3;display:none;';
    canvas.parentNode?.appendChild(this.eye);
  }
  update(frame: typeof emptyTriggerFrame) {
    this.flash.style.opacity = String(frame.flash);
    this.pink.style.opacity = String(frame.pink);
    this.black.style.opacity = String(frame.black);
    const opening=frame.eyeOpening??1;
    this.eye.style.display=opening>=1?'none':'block';this.eye.dataset.opening=String(opening);
    // A soft elliptical aperture becomes a broad horizontal slit before closing.
    // At zero the whole presentation is black; playback controls remain above it.
    const mask=opening<=0?'none':`radial-gradient(ellipse ${35+55*opening}% ${100*opening}% at 50% 50%,transparent 85%,#000 100%)`;
    this.eye.style.maskImage=mask;this.eye.style.setProperty('-webkit-mask-image',mask);
    if (this.host) {
      this.host.style.setProperty('--trigger-x', `${frame.x}px`);
      this.host.style.setProperty('--trigger-y', `${frame.y}px`);
      this.host.style.setProperty('--trigger-scale', String(1 + frame.impulse * .3));
    } else this.canvas.style.transform = `translate(${frame.x}px,${frame.y}px) scale(${1 + frame.impulse * .3})`;
  }
  setCanvas(canvas: HTMLCanvasElement) { this.canvas = canvas; }
}
