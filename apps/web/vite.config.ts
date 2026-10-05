// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({build:{rollupOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),studio:fileURLToPath(new URL('./studio.html',import.meta.url)),setup:fileURLToPath(new URL('./setup.html',import.meta.url))}}}});
