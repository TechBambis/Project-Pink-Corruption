// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('CC0 click assets retain their pinned provenance, exact PCM lengths and -12 dBFS peak',()=>{
 const manifest=JSON.parse(readFileSync('assets/sounds/tick-clicks.json','utf8'));
 assert.equal(manifest.private,false);assert.equal(manifest.assets.length,2);
 for(const asset of manifest.assets){
  const wav=readFileSync('assets/sounds/'+asset.file);
  assert.equal(createHash('sha256').update(wav).digest('hex'),asset.sha256);
  assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt32LE(24),44100);assert.equal(wav.readUInt16LE(34),16);
  assert.equal(wav.readUInt32LE(40)/2,Math.round(44100*(asset.name==='tick_main'?.094:.056)));
  let peak=0;for(let i=44;i<wav.length;i+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(i))/32767);
  assert.ok(Math.abs(20*Math.log10(peak)+12)<.002);
  assert.equal(asset.license,'CC0-1.0');assert.equal(asset.creator,'Kenney');
  assert.ok(asset.sourceUrl.includes('56a1acad9a3eed08d077e8d8293a8afbb7454d05'));
 }
});
