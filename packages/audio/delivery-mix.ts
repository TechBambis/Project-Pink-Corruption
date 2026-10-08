// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { deliveryProfiles, type DeliveryMode } from '../session-director/delivery';

const mixedBuses = ['drone', 'noise', 'left_voice', 'right_voice', 'echo_voice', 'EFFECTS'] as const;
export function deliveryGains(mode?: DeliveryMode): Record<typeof mixedBuses[number], number> {
  const mix = mode ? deliveryProfiles[mode].mix : { drone: 1, noise: 1, support: 1, effects: 1 };
  return { drone: mix.drone, noise: mix.noise, left_voice: mix.support, right_voice: mix.support, echo_voice: mix.support, EFFECTS: mix.effects };
}

/** Generated sound only: user faders and native-event gates remain independent. */
export class DeliveryMix {
  private nodes = new Map<string, GainNode>();
  private mode: DeliveryMode | undefined;
  constructor(private context: AudioContext) {}
  input(bus: string, output: AudioNode): AudioNode {
    if (!mixedBuses.includes(bus as typeof mixedBuses[number])) return output;
    const node = this.context.createGain(); node.connect(output); this.nodes.set(bus, node); return node;
  }
  set(mode?: DeliveryMode, at = this.context.currentTime) {
    if (this.mode === mode) return;
    this.mode = mode;
    const gains = deliveryGains(mode), now = this.context.currentTime;
    for (const [bus, node] of this.nodes) {
      const param = node.gain;
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
      else { const held = param.value; param.cancelScheduledValues(now); param.setValueAtTime(held, now); }
      param.setTargetAtTime(gains[bus as keyof typeof gains], Math.max(now, at), .15);
    }
  }
}
