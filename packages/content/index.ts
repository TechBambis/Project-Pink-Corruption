// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {fileURLToPath} from 'node:url';
export * from './portable';
/** Server-only path; shared prompt composition lives in portable.ts. */
export const contentRoot=fileURLToPath(new URL('./stable-2.0/',import.meta.url));
