// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

export const emptyDescentFrame = { opacity: 0, black: 0, scale: 1, y: 0, x: 0 };

/** Original six-second tunnel beat, timed to the audio output rather than wall time. */
export class DescentVisualState {
  private active: { start: number; duration: number } | null = null;
  start(start: number, duration = 6) {
    this.active = Number.isFinite(start) && Number.isFinite(duration) && duration > 0 ? { start, duration } : null;
  }
  clear() { this.active = null; }
  frame(time: number, reduced = false) {
    if (reduced) this.clear();
    if (!this.active) return { ...emptyDescentFrame };
    const elapsed = time - this.active.start;
    if (elapsed < 0) return { ...emptyDescentFrame };
    if (elapsed >= this.active.duration) { this.clear(); return { ...emptyDescentFrame }; }
    const p = elapsed / this.active.duration;
    const smooth = (n: number) => n * n * (3 - 2 * n);
    const envelope = smooth(Math.min(1, p / .12)) * (1 - smooth(Math.max(0, (p - .88) / .12)));
    const dark = smooth(Math.min(1, Math.max(0, (p - .35) / .5)));
    const shake = Math.sin(Math.floor(elapsed * 30) * 2.4) * 2 * envelope * (1 - dark);
    return { opacity: envelope * .65, black: dark * envelope, scale: 1 + p * 1.8, y: p * 14, x: shake };
  }
}

export class DescentOverlay {
  private layer = document.createElement('div');
  private tunnel = document.createElement('div');
  private black = document.createElement('div');
  constructor(canvas: HTMLCanvasElement) {
    this.layer.dataset.descentLayer = 'tunnel';
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;opacity:0;visibility:hidden;background:#12081a;';
    this.tunnel.style.cssText = 'position:absolute;inset:-40%;background:repeating-radial-gradient(ellipse at center,transparent 0 7%,#ff69b440 8%,#ff149370 9%,transparent 11% 16%),radial-gradient(ellipse at center,#0a0a0a 3%,#2a1030 45%,#12081a 75%);';
    this.black.style.cssText = 'position:absolute;inset:0;background:#0a0a0a;opacity:0;';
    this.layer.append(this.tunnel, this.black);
    canvas.parentNode?.appendChild(this.layer);
  }
  update(frame: typeof emptyDescentFrame) {
    this.layer.style.opacity = String(frame.opacity);
    this.layer.style.visibility = frame.opacity > 0 ? 'visible' : 'hidden';
    this.black.style.opacity = String(frame.black);
    this.tunnel.style.transform = `translate(${frame.x}px,${frame.y}%) scale(${frame.scale})`;
  }
}
