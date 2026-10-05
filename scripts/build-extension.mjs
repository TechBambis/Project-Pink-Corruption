// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import{build}from'esbuild';import{mkdirSync,copyFileSync}from'node:fs';
mkdirSync('dist/extension',{recursive:true});await build({entryPoints:['apps/extension/content.ts'],outfile:'dist/extension/content.js',bundle:true,format:'iife',target:'firefox115'});for(const file of ['manifest.json','background.js'])copyFileSync('apps/extension/'+file,'dist/extension/'+file);console.log('Firefox extension: dist/extension/manifest.json');
