// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {matchSoundLevel} from './sound-level';
import { triggerSoundSettings, type TriggerSound } from '../../config/trigger-sounds';

/** Original deterministic Foley-like synthesis; shared by runtime and WAV export. */
export function synthesizeTriggerSound(kind: TriggerSound, rate = 48000): [Float32Array, Float32Array] {
  const frames = Math.round(triggerSoundSettings.sounds[kind].duration * rate);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let seed = 0x5baf3921, previous = 0, phase = 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x80000000 - 1; };
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    if (kind === 'beep') {
      left[i] = right[i] = .1 * Math.exp(-Math.log(10) * t / .1) * Math.sin(2 * Math.PI * 800 * t);
    } else if (kind === 'snap') {
      const white = random(), bright = white - .72 * previous; previous = white;
      const attack = Math.min(1, t / .0008);
      const click = .7 * bright * Math.exp(-t / .009);
      const body = (.4 * Math.sin(2 * Math.PI * 1800 * t) + .25 * Math.sin(2 * Math.PI * 850 * t)) * Math.exp(-t / .023);
      left[i] = right[i] = attack * (click + body);
    } else if(kind==='pop'){
      const white=random();left[i]=right[i]=Math.min(1,t/.0007)*Math.exp(-t/.016)*(white+.25*Math.sin(2*Math.PI*110*t));
    } else if(kind==='inflate'){
      const white=random(),air=white-.55*previous;previous=white;
      const envelope=Math.sin(Math.PI*t/triggerSoundSettings.sounds.inflate.duration)**.8;
      left[i]=right[i]=envelope*(.22*air+.015*Math.sin(2*Math.PI*(250+120*t)*t));
    } else if(kind==='squeak'){
      const p=t/triggerSoundSettings.sounds.squeak.duration;
      phase+=2*Math.PI*(650+850*Math.sin(Math.PI*p)+180*Math.sin(2*Math.PI*21*t))/rate;
      left[i]=right[i]=Math.sin(Math.PI*p)**1.5*(.3*Math.sin(phase)+.09*Math.sin(2.13*phase));
    } else if(kind==='tick'){
      left[i]=right[i]=Math.min(1,t/.0004)*Math.exp(-t/.008)*(random()+.4*Math.sin(2*Math.PI*2300*t));
    } else if(kind==='bell'){
      const attack=Math.min(1,t/.002);left[i]=right[i]=attack*(Math.sin(2*Math.PI*1320*t)+.35*Math.sin(2*Math.PI*2755*t)+.12*Math.sin(2*Math.PI*4080*t))*Math.exp(-t/.25);
    } else {
      const stroke = Math.floor(t/.68), local = t - stroke * .68, duration = .58;
      if (local >= duration) continue;
      const progress = local / duration;
      const envelope = Math.sin(Math.PI * progress) ** 1.5;
      const frequency = 380 + 620 * Math.sin(Math.PI * progress) + (stroke ? 90 : 0);
      phase += 2 * Math.PI * frequency / rate;
      const white = random(), friction = white - .65 * previous; previous = white;
      const chatter = .72 + .28 * Math.sin(2 * Math.PI * (28 + 4 * stroke) * local);
      const rubber = (.4 * Math.sin(phase) + .12 * Math.sin(2.02 * phase)) * chatter;
      const sample = envelope * (.32 * friction + rubber);
      const pan = stroke%2 ? .65 - 1.3 * progress : -.65 + 1.3 * progress;
      left[i] = sample * (1 - Math.max(0, pan)); right[i] = sample * (1 + Math.min(0, pan));
    }
  }
  if(kind!=='beep')matchSoundLevel([left,right],rate);
  return [left, right];
}
