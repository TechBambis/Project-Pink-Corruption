// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {activeSoundRms} from '../packages/audio/sound-level';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { findTriggers, soundForTrigger, triggerSoundSettings, type TriggerSound } from '../config/trigger-sounds';
import { synthesizeTriggerSound } from '../packages/audio/trigger-synthesis';

test('specific trigger associations and aliases retain full names without partial duplicates', () => {
  assert.equal(soundForTrigger('SNAP AND FORGET'), 'bell');
  assert.equal(soundForTrigger('snap_and_forget'), 'bell');
  for (const name of ['Braindead Bobblehead', 'Windshield Wipers', 'Wipers']) assert.equal(soundForTrigger(name), 'wiper');
  assert.equal(soundForTrigger('Bambi Sleep'), 'snap');
  assert.deepEqual(findTriggers('Bambi Sleep, then SNAP AND FORGET. Wipers. Not forgetful.',
    ['Bambi', 'Bambi Sleep', 'Snap and Forget', 'Forget', 'Wipers']).map(item => item.name),
  ['Bambi Sleep', 'Snap and Forget', 'Wipers']);
});

test('bundled CC0 sounds are deterministic finite stereo audio with verified WAV hashes', () => {
  const manifest = JSON.parse(readFileSync('apps/web/public/sounds/manifest.json', 'utf8'));
  assert.equal(manifest.assets.length, 8);
  assert.deepEqual(manifest.mappings, triggerSoundSettings.mappings);
  for (const [kind, settings] of Object.entries(triggerSoundSettings.sounds)) {
    const channels = synthesizeTriggerSound(kind as TriggerSound), repeated = synthesizeTriggerSound(kind as TriggerSound);
    assert.equal(channels[0].length, Math.round(settings.duration * 48000));
    if(kind!=='beep')assert.ok(Math.abs(20*Math.log10(activeSoundRms(channels,48000))+24)<.01,'Fallback effects share the calibrated active level');
    assert.deepEqual(channels, repeated);
    assert.ok(channels.every(channel => channel.every(sample => Number.isFinite(sample) && Math.abs(sample) <= .800001)));
    const file = readFileSync('apps/web/public/sounds/' + settings.file);
    assert.equal(file.toString('ascii', 0, 4), 'RIFF'); assert.equal(file.readUInt16LE(22), 2);
    assert.equal(file.readUInt32LE(24), 48000); assert.equal(file.readUInt32LE(40), channels[0].length * 4);
    const entry = manifest.assets.find((item: {id: string}) => item.id === kind);
    assert.equal(entry.sha256, createHash('sha256').update(file).digest('hex'));
    assert.equal(entry.license, 'CC0-1.0');
    assert.equal(entry.gainDb, settings.gainDb);
    for (let i = 0; i < channels[0].length; i++) for (let channel = 0; channel < 2; channel++)
      assert.equal(file.readInt16LE(44 + i * 4 + channel * 2), Math.round(channels[channel][i] * 32767) || 0, 'Preview WAV must match runtime synthesis');
    if (kind === 'wiper') assert.notDeepEqual(channels[0], channels[1]);
    else assert.deepEqual(channels[0], channels[1]);
  }
});
