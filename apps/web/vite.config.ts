// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{rollupOptions:{input:{comparison:fileURLToPath(new URL('./comparison.html',import.meta.url)),main:fileURLToPath(new URL('./index.html',import.meta.url)),studio:fileURLToPath(new URL('./studio.html',import.meta.url)),setup:fileURLToPath(new URL('./setup.html',import.meta.url))}}}});
