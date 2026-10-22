// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

// Check the actual Git candidates without reading or printing credential contents.
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localSourceArea} from './desktop-windows-support.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
const candidates = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z'))]
  .filter(file => existsSync(join(root, file))).sort();
const issues = git('ls-files', '--cached', '--ignored', '--exclude-standard', '-z')
  .map(file => `${file}: tracked despite an ignore rule`);
const publicSounds = new Set(['tick-clicks.json', 'tick_main.wav', 'tick_sub.wav']);
const publicVoices = new Set(['.gitkeep', 'bambi_classic.npy', 'bambi_classic.json']);
let bytes = 0;
for (const file of candidates) {
  if (!localSourceArea(file)) issues.push(`${file}: outside the local application source owners`);
  const parts = file.split('/');
  const base = parts.at(-1);
  const localDirectory = /^(?:\.runtime|runtime|models|vendor|data)\//.test(file) && base !== '.gitkeep';
  const environment = /^\.env(?:\.|$)/.test(base) && !/^\.env(?:\.[\w-]+)?\.example$/.test(base);
  const key = /\.(?:key|pem|p12|pfx)$/i.test(base) || /^id_(?:rsa|ed25519)/.test(base);
  const privateSound = file.startsWith('assets/sounds/') && !publicSounds.has(file.slice('assets/sounds/'.length));
  const privateVoice = file.startsWith('voices/') && !publicVoices.has(file.slice('voices/'.length));
  if (localDirectory || environment || key || privateSound || privateVoice || file.startsWith('docs/reference-analysis/')) {
    issues.push(`${file}: private/local file in Git candidates`);
  }
  const stat = lstatSync(join(root, file));
  if (!stat.isFile()) issues.push(`${file}: expected a regular source file`);
  if (stat.size > 10 * 1024 * 1024) issues.push(`${file}: exceeds the 10 MiB source-file limit; review before committing`);
  bytes += stat.size;
}
if (issues.length) {
  console.error(issues.join('\n'));
  process.exit(1);
}
console.log(`Repository hygiene passed: ${candidates.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB. Secret scanning is a separate check.`);
if (process.argv.includes('--snapshot')) {
  // A fresh ignored directory; no staging, deletion or history rewrite.
  const localChecks = join(root, '.runtime');
  mkdirSync(localChecks, {recursive: true});
  const target = mkdtempSync(join(localChecks, 'repo-source-check-'));
  for (const file of candidates) {
    const destination = join(target, file);
    mkdirSync(dirname(destination), {recursive: true});
    copyFileSync(join(root, file), destination);
  }
  console.log(`Source snapshot: ${target}`);
}
