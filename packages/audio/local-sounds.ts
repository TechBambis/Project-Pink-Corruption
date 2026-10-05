// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

/** Private recordings stay under ignored runtime/, outside the distributable assets. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const localSoundFiles = {
  giggle: 'giggle_short.wav', giggle_alt: 'giggle_alt_short.wav',
  snap: 'finger_snap.wav', tick:'tick.wav', moan: 'moan_short.wav', moan_alt: 'moan_alt.wav', moan_third: 'moan_third.wav', wiper: 'wipers.wav',
  pop: 'pop.wav', pop_alt: 'pop_alt.wav', pop_smack:'pop_smack.wav',pop_ccp:'pop_ccp.wav',pop_ccp_alt:'pop_ccp_alt.wav',pop_ccp_soft:'pop_ccp_soft.wav',inflate:'balloon_inflate.wav',squeak:'balloon_squeak.wav',wiper_alt: 'wipers_alt.wav', wiper_rain: 'wipers_rain.wav', bell: 'bell.wav', drone: 'drone_loop.wav',
} as const;
export type LocalSoundId = keyof typeof localSoundFiles;
const soundLabels:Record<LocalSoundId,string>={
 giggle:'Playful giggle · short',giggle_alt:'Soft giggle · short variation',
 snap:'Finger snap',tick:'Single clock tick',moan:'Soft moan · variation 1',moan_alt:'Soft moan · variation 2',moan_third:'Soft moan · variation 3',
 wiper:'Wipers · 5 seconds',wiper_alt:'Car wipers · 5 seconds',wiper_rain:'Rain and wipers · 5 seconds',
 pop:'Balloon pop',pop_alt:'Balloon burst',pop_smack:'Bubble pop · cartoon smack',
 pop_ccp:'Bubble pop · CCP 1',pop_ccp_alt:'Bubble pop · CCP 2',pop_ccp_soft:'Bubble pop · CCP 3',
 inflate:'Bubble inflation',squeak:'Soft rubber squeaks',bell:'Bell',drone:'Stereo drone',
};
export interface LocalSoundAsset {
  id: LocalSoundId; label: string; status: string; file?: string; url?: string;
  duration?: number; channels?: number; gainDb?: number; sha256?: string;
  source?: string; start?: number; evidence?: string; reason?: string;
  license?:string;creator?:string;sourceUrl?:string;licenseUrl?:string;attribution?:string;
}
export function localSoundCatalog(directory = resolve('runtime/imported-sounds')) {
  const empty = { version: 1, private: true, note: 'No private sound clips imported yet.', assets: [] as LocalSoundAsset[] };
  try {
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.assets)) return empty;
    const seen = new Set<string>();
    const assets: LocalSoundAsset[] = [];
    for (const asset of manifest.assets) {
      if (!Object.hasOwn(localSoundFiles, asset.id) || seen.has(asset.id)) continue;
      seen.add(asset.id);
      const record = { ...asset } as LocalSoundAsset;
      record.label=soundLabels[record.id];
      delete record.url;
      if (record.status === 'available') {
        const file = localSoundFiles[record.id], path = resolve(directory, file);
        let valid = record.file === file && existsSync(path);
        if (valid) {
          const bytes = readFileSync(path);
          valid = bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 16) === 'WAVEfmt '
            && bytes.readUInt32LE(4) === bytes.length - 8 && bytes.readUInt32LE(16) === 16 && bytes.readUInt16LE(20) === 1
            && bytes.readUInt16LE(22) === (record.id === 'drone' ? 2 : 1) && bytes.readUInt32LE(24) === 44100
            && bytes.readUInt16LE(34) === 16 && bytes.toString('ascii', 36, 40) === 'data' && bytes.readUInt32LE(40) === bytes.length - 44
            && bytes.length - 44 <= 44100 * bytes.readUInt16LE(22) * 2 * (record.id === 'drone' ? 120 : record.id.startsWith('wiper') ? 20 : 3)
            && createHash('sha256').update(bytes).digest('hex') === record.sha256;
        }
        if (valid) record.url = '/api/local-sounds/' + record.id + '.wav';
        else { record.status = 'unavailable'; record.reason = 'Private WAV missing or does not match its manifest.'; }
      }
      assets.push(record);
    }
    return { version: 1, private: true, note: 'Your private sound collection. Files stay on this device.', assets };
  } catch { return empty; }
}
