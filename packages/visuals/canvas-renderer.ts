// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { clamp, SPIRAL_COMPLEXITY_MAX } from '../safety/actions';
import type { Scene } from './index';
import type { StableSpiralSettings } from './stable';

/** Local Canvas rendering when a browser cannot create or keep its WebGL context. */
export class CanvasRenderer {
  readonly context: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw Error('The alternative visual renderer is also unavailable.');
    this.context = context;
  }
  clear() {
    const c = this.context;
    c.resetTransform(); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#140c1d'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  render(scene: Scene, time: number, settings: StableSpiralSettings, reduced: boolean, density: number, pulse: number, audio: number, reaction = 0) {
    this.clear();
    if (settings.complexity > SPIRAL_COMPLEXITY_MAX) settings = {...settings, complexity:SPIRAL_COMPLEXITY_MAX};
    const c = this.context, w = this.canvas.width, h = this.canvas.height, size = Math.min(w, h);
    const t = reduced ? 0 : time;
    if (scene === 'Audio Only') return;
    if (scene === 'Deep Tunnel') { this.immersive(t, { ...settings, style: 'tunnel' }, reduced, reaction, density); return; }
    if (scene === 'Spiral Focus' && settings.style && settings.style !== 'original') { this.immersive(t, settings, reduced, reaction, density); return; }
    if (scene === 'Spiral Focus') { this.spiral(t + pulse * .5, settings, reduced, reaction); return; }
    const glow = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, size * .7);
    glow.addColorStop(0, scene === 'Soft Pink' ? '#61314e' : '#22162d');
    glow.addColorStop(1, '#140c1d'); c.fillStyle = glow; c.fillRect(0, 0, w, h);
    if (['Soft Pink', 'Particle Drift'].includes(scene) && !reduced) {
      for (let i = 0; i < Math.round(clamp(density) * 40); i++) {
        const x = ((Math.sin(i * 127.1) * 43758.5 % 1 + 1) % 1) * w;
        const y = (((Math.cos(i * 311.7) * 43758.5 % 1 + 1) % 1) + t * .006 * (1 + i % 3)) % 1 * h;
        c.globalAlpha = .2 + .25 * (1 + Math.sin(t * .2 + i)) / 2;
        c.fillStyle = i % 2 ? '#dc79c9' : '#62cec7'; c.beginPath(); c.arc(x, y, Math.max(1, size * .003), 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = 1;
    if (pulse || audio) {
      c.fillStyle = '#dc79c9'; c.globalAlpha = clamp(pulse * .12 + audio * .08);
      c.beginPath(); c.arc(w / 2, h / 2, size * .15, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    }
  }
  private immersive(time: number, settings: StableSpiralSettings, reduced: boolean, reaction: number, quality: number) {
    const c = this.context, w = this.canvas.width, h = this.canvas.height, size = Math.min(w, h);
    const t = reduced ? 0 : time * settings.speed, depth = settings.depth ?? .75;
    const amount = reduced ? 0 : reaction;
    const alpha = clamp(settings.alpha) * (!reduced && settings.mode === 'strobe' ? .65 + .35 * Math.sin(time * Math.PI * Math.min(2, settings.pulseHz ?? .7)) ** 2 : 1);
    c.save(); c.translate(w / 2, h / 2); c.scale(1 + amount * .16, 1 + amount * .16);
    c.globalAlpha = alpha;
    if (['tunnel', 'loop', 'fractal'].includes(settings.style ?? '')) {
      const count = 18, folds = 6 + 2 * Math.floor(settings.complexity);
      for (let i = count - 1; i >= 0; i--) {
        const progress = ((i / count + t * .065) % 1 + 1) % 1, radius = size * .018 * Math.pow(65, progress);
        c.save(); c.rotate(t * .1 + progress * .3);
        c.lineWidth = Math.max(1, radius * .035); c.strokeStyle = i % 2 ? settings.colorA : settings.colorB;
        c.globalAlpha = alpha * Math.min(1, progress * 5);
        c.beginPath();
        if (settings.style === 'loop') {
          const box = radius * 1.6; c.roundRect(-box / 2, -box / 2, box, box, box * .14);
        } else if (settings.style === 'fractal') {
          for (let j = 0; j <= 96; j++) {
            const a = j / 96 * Math.PI * 2, r = radius * (1 + .18 * Math.cos(a * folds) + .07 * Math.cos(a * folds * 2 + t * .12));
            j ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          c.closePath();
        } else c.arc(0, 0, radius, 0, Math.PI * 2);
        c.stroke(); c.strokeStyle = '#fff1fa'; c.lineWidth = Math.max(1, radius * .009); c.stroke(); c.restore();
      }
    } else if (settings.style === 'orb') {
      const radius = size * (.30 + amount * .035 + Math.sin(t * .6) * .007);
      const glow = c.createRadialGradient(0, 0, radius * .75, 0, 0, radius * 1.2);
      glow.addColorStop(0, '#140c1d'); glow.addColorStop(.45, settings.colorA); glow.addColorStop(.56, '#fff5fb');
      glow.addColorStop(.64, settings.colorB); glow.addColorStop(1, '#140c1d');
      c.fillStyle = glow; c.beginPath(); c.arc(0, 0, radius * 1.2, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#fff1fa'; c.lineWidth = Math.max(1, size * .004); c.beginPath();
      c.ellipse(0, 0, radius * (.79 - .21 * Math.sin(t * .55)), radius, 0, 0, Math.PI * 2); c.stroke();
    } else if (settings.style === 'infinity') {
      const n = Math.round((80 + settings.complexity * 26) * Math.max(.5, quality)), radius = size * (.29 + amount * .025), box = radius * (.48 + depth * .25);
      c.lineWidth = Math.max(1, size * .002);
      const paint = (i: number) => {
        const f = i / n, angle = f * Math.PI * 2;
        c.save(); c.translate(Math.sin(angle) * radius, -Math.cos(angle) * radius); c.rotate(-f * Math.PI - t * .6);
        c.fillStyle = '#06020b'; c.fillRect(-box / 2, -box / 2, box, box);
        c.strokeStyle = i < n / 2 ? settings.colorA : settings.colorB; c.strokeRect(-box / 2, -box / 2, box, box); c.restore();
      };
      for (let i = n - 1; i >= 0; i--) paint(i);
      c.save(); c.beginPath();
      const rotation = -t * .6, cos = Math.cos(rotation), sin = Math.sin(rotation);
      for (const [i, [x, y]] of [[-box / 2, -box / 2], [box / 2, -box / 2], [box / 2, box / 2], [-box / 2, box / 2]].entries()) {
        const u = x * cos - y * sin, v = -radius + x * sin + y * cos; i ? c.lineTo(u, v) : c.moveTo(u, v);
      }
      c.closePath(); c.clip();
      for (let i = n - 1; i >= n - Math.round(n * .1); i--) paint(i);
      c.restore();
    } else {
      c.scale(1.8, 1.8);
      const folds = settings.style === 'prism' ? 6 + 2 * Math.floor(settings.complexity * 2) : 3 + Math.floor(settings.complexity * 2);
      const count = Math.round(24 + depth * 20);
      for (let i = count; i >= 0; i--) {
        const p = ((i / count - t * .035) % 1 + 1) % 1, radius = size * .018 * Math.pow(Math.max(55, Math.hypot(w,h)/size*42), p), twist = t * .3 + Math.log(radius / size + .025) * (1 + depth);
        c.beginPath();
        for (let j = 0; j <= 160; j++) {
          const a = j / 160 * Math.PI * 2, ripple = 1 + Math.sin(a * folds + twist) * (settings.style === 'prism' ? .23 : .12);
          const r = radius * ripple; j ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        c.closePath(); c.lineWidth = Math.max(1, radius * .065); c.strokeStyle = i % 2 ? settings.colorA : settings.colorB;
        c.stroke(); c.lineWidth = Math.max(1, radius * .012); c.strokeStyle = '#ffe0f6'; c.stroke();
      }
    }
    c.restore();
  }
  private spiral(time: number, settings: StableSpiralSettings, reduced: boolean, reaction: number) {
    const c = this.context, w = this.canvas.width, h = this.canvas.height;
    const t = time * settings.speed, modeTime = t * 1.2, size = Math.min(w,h);
    const drift = !reduced && settings.mode === 'drift' ? Math.sin(modeTime*.5)*2 : 1;
    const breathe = !reduced && settings.mode === 'breathe' ? Math.sin(modeTime)*1.6 : 0;
    const pitch = 26 + settings.complexity * 10 + breathe, radius = Math.hypot(w,h)*.7;
    const alpha = clamp(settings.alpha) * (!reduced && settings.mode === 'strobe' ? .3 + .7 * Math.abs(Math.sin(time * Math.PI * (settings.pulseHz ?? 18/Math.PI))) : 1);
    c.save();c.translate(w/2,h/2);c.rotate(t*.25*drift);c.scale(1+reaction*.18,1+reaction*.18);c.globalAlpha=alpha;
    c.lineCap='round'; c.lineJoin='round';
    for(let arm=0;arm<2;arm++) {
      c.beginPath();
      for(let i=0;i<=360;i++) {
        const r=i/360*radius, a=-r/size*pitch/2+arm*Math.PI;
        i?c.lineTo(Math.cos(a)*r,Math.sin(a)*r):c.moveTo(0,0);
      }
      c.strokeStyle=!reduced&&settings.mode==='colorCycle'?`hsl(${(time*18+arm*100)%360} 75% 65%)`:settings.colorA;
      c.lineWidth=size*Math.PI/pitch*.9;c.stroke();
      c.strokeStyle=settings.colorB;c.lineWidth=size*Math.PI/pitch*.38;c.stroke();
    }
    c.restore();
  }
}
