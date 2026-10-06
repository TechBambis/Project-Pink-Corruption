// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCueSettings, synthesizeEventCue, type EventCueSound } from '../packages/audio/event-cues';
import { activeSoundRms } from '../packages/audio/sound-level';
import {giggleOffset} from '../packages/audio/giggle';

test('original event cues are finite deterministic tones with calibrated levels and smooth ends', () => {
  for (const [kind,spec] of Object.entries(eventCueSettings)) {
    const channels=synthesizeEventCue(kind as EventCueSound);
    assert.equal(channels[0].length,Math.round(spec.duration*48000));
    assert.deepEqual(channels[0],channels[1]);assert.deepEqual(channels,synthesizeEventCue(kind as EventCueSound));
    assert.equal(channels[0][0],0);assert.ok(Math.abs(channels[0].at(-1)!)<.0001);
    assert.ok(channels[0].every(x=>Number.isFinite(x)&&Math.abs(x)<.8));
    assert.ok(Math.abs(20*Math.log10(activeSoundRms(channels,48000))-spec.levelDb)<.01);
    const signal=channels[0].subarray(4800,14400);let crossings=0;for(let i=1;i<signal.length;i++)if(signal[i-1]<=0&&signal[i]>0)crossings++;
    assert.ok(Math.abs(crossings/.2-spec.frequency)<8);
  }
});
test('giggle cues use the spoken topic word and ignore negated instructions or missing timing',()=>{
  const words=[{word:'A',atMs:0},{word:'giggle.',atMs:350}];
  assert.equal(giggleOffset(words,'A giggle.'),350);
  assert.equal(giggleOffset(words,'Do not giggle.'),undefined);
  assert.equal(giggleOffset([],'A giggle.'),undefined);
  assert.equal(giggleOffset([{word:'chuckle',atMs:500}],'A quiet chuckle.'),500);
});
