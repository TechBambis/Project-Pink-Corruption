// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localSoundCatalog } from '../packages/audio/local-sounds';

test('private sounds fail closed for missing, malformed, tampered and unconfirmed imports', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bambi-sounds-'));
  try {
    assert.deepEqual(localSoundCatalog(directory).assets, []);
    writeFileSync(join(directory, 'manifest.json'), '{bad');
    assert.deepEqual(localSoundCatalog(directory).assets, []);
    const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);
    wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);
    wav.writeUInt32LE(88200,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
    writeFileSync(join(directory, 'pop.wav'), wav);
    const sha256 = createHash('sha256').update(wav).digest('hex');
    const assets = [{ id: 'pop', file: 'pop.wav', status: 'available', sha256 },
      { id: 'snap', status: 'unconfirmed', url: 'https://example.com/fake.wav' },
      { id: '../../secret', file: '/etc/passwd', status: 'available' },
      { id: 'drone', file: '../pop.wav', status: 'available', sha256 },
      { id: 'bell', file: 'bell.wav', status: 'available', sha256 },
      { id: 'pop', file: 'pop.wav', status: 'available', sha256 }];
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: 1, assets }));
    let catalog = localSoundCatalog(directory);
    assert.equal(catalog.assets.length, 4);
    assert.equal(catalog.assets[0].url, '/api/local-sounds/pop.wav');
    assert.equal(catalog.assets[1].url, undefined);
    assert.equal(catalog.assets[2].status, 'unavailable');
    assert.equal(catalog.assets[3].status, 'unavailable');
    writeFileSync(join(directory, 'pop.wav'), Buffer.alloc(46));
    catalog = localSoundCatalog(directory);
    assert.equal(catalog.assets[0].status, 'unavailable');
    assert.equal(catalog.assets[0].url, undefined);
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: 2, assets }));
    assert.deepEqual(localSoundCatalog(directory).assets, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
