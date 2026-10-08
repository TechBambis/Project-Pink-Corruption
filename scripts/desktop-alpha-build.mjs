// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
const version=process.argv[2];
if(!/^0\.1\.0-alpha\.[0-9]+(?:-dev\.[0-9]+)?$/.test(version||''))throw Error('Usage: node scripts/desktop-alpha-build.mjs 0.1.0-alpha.N[-dev.N]');
process.env.BAMBI_ALPHA_VERSION=version;
await import('./desktop-build.mjs');
