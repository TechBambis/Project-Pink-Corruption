// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { clamp } from '../safety/actions';

export interface TriggerEffect { flash: number; flashAlpha: number; impulse: number; impulseLevel: number; shake: number; darken?: number; flashToBlack?: number; eyeClose?: { closeMs: number; holdMs: number; openMs: number } }
const soft: TriggerEffect = { flash: 300, flashAlpha: .4, impulse: 200, impulseLevel: .15, shake: 0 };
const medium: TriggerEffect = { flash: 500, flashAlpha: .7, impulse: 350, impulseLevel: .35, shake: 0, darken: 100 };
const hard: TriggerEffect = { flash: 700, flashAlpha: 1, impulse: 500, impulseLevel: .65, shake: 3, flashToBlack: 200 };
export const TRIGGER_EFFECTS: Record<string, TriggerEffect> = {
  'SNAP': medium,
  'GOOD GIRL': soft, 'SAFE AND SECURE': soft,
  'BAMBI SLEEP': { flash: 0, flashAlpha: 0, impulse: 0, impulseLevel: 0, shake: 0, eyeClose: { closeMs: 900, holdMs: 5000, openMs: 2200 } },
  'BAMBI FREEZE': medium, 'BAMBI LIMP': medium, 'BAMBI LIMB': medium,
  'DROP FOR COCK': hard, 'BAMBI CUM AND COLLAPSE': hard, 'BAMBI YOU ARE NOTHING': hard,
  'COCK ZOMBIE NOW': hard, 'ZAP COCK DRAIN OBEY': hard,
};
export function triggerEffectFor(name: string): TriggerEffect {
  return TRIGGER_EFFECTS[name.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()] ?? soft;
}
export function strongestTriggerEffect(names: string[]): TriggerEffect {
  return names.map(triggerEffectFor).reduce((best, effect) => effect.eyeClose ? effect : best.eyeClose ? best : effect.flashAlpha > best.flashAlpha ? effect : best, soft);
}
export const emptyTriggerFrame = { flash: 0, pink: 0, black: 0, impulse: 0, x: 0, y: 0, eyeOpening: 1 };
const ease = (value: number) => { const p=clamp(value); return p*p*(3-2*p); };

/** Effects use session seconds; pausing freezes them and seeking clears them. */
export class TriggerVisualState {
  private active: { time: number; effect: TriggerEffect } | null = null;
  private pinkAt: number | null = null;
  private eye: { time: number; timing: NonNullable<TriggerEffect['eyeClose']>; immediate: boolean } | null = null;
  start(time: number, effect: TriggerEffect, reduced = false) {
    this.active = reduced ? null : { time, effect };
    if(effect.eyeClose)this.eye={time,timing:effect.eyeClose,immediate:reduced};
  }
  pinkPulse(time: number, reduced = false) { if(!reduced)this.pinkAt=time; }
  clear(preserveEye = false) { this.active = null; this.pinkAt=null; if(!preserveEye)this.eye=null; }
  frame(time: number, reduced = false) {
    const frame={...emptyTriggerFrame};
    if(this.pinkAt!==null){
      const elapsed=(time-this.pinkAt)*1000;
      if(reduced||elapsed>=180)this.pinkAt=null;
      else if(elapsed>=0)frame.pink=.5*Math.max(0,1-elapsed/180);
    }
    if(this.eye){
      const elapsed=(time-this.eye.time)*1000, {holdMs}=this.eye.timing;
      const closeMs=this.eye.immediate?0:this.eye.timing.closeMs, openMs=this.eye.immediate?0:this.eye.timing.openMs;
      if(elapsed>=closeMs+holdMs+openMs)this.eye=null;
      else if(elapsed>=0)frame.eyeOpening=elapsed<closeMs ? reduced?0:1-ease(elapsed/closeMs)
        : elapsed<closeMs+holdMs ? 0 : reduced?1:ease((elapsed-closeMs-holdMs)/openMs);
    }
    if (reduced) this.active=null;
    if (!this.active) return frame;
    const elapsed = (time - this.active.time) * 1000, effect = this.active.effect;
    if (elapsed < 0 || elapsed >= effect.flash + (effect.flashToBlack ?? 0)) { this.active=null; return frame; }
    const flash = elapsed < effect.flash ? effect.flashAlpha * Math.sin(Math.PI * clamp(elapsed / effect.flash)) : 0;
    const impulse = elapsed < effect.impulse ? effect.impulseLevel * Math.sin(Math.PI * clamp(elapsed / effect.impulse)) : 0;
    const black = effect.flashToBlack && elapsed >= effect.flash ? 1 : effect.darken && elapsed < effect.darken ? .45 : 0;
    const shaking = elapsed < effect.shake * 50;
    const x = shaking ? Math.sin(elapsed / 50 * Math.PI * 2) * 6 : 0;
    return { ...frame, flash, black, impulse, x, y: shaking ? -x * .5 : 0 };
  }
}
