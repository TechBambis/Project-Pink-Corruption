// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** Immutable resources are independent of the launch directory. Writable paths
 * remain relative to the developer cwd, or the launcher's private user-data cwd. */
export const resourceRoot=fileURLToPath(new URL('../../',import.meta.url));
export const resourcePath=(...parts:string[])=>resolve(resourceRoot,...parts);
export const desktopSmoke=process.env.BAMBI_DESKTOP_SMOKE==='1';
export const desktopAlpha=process.env.BAMBI_DESKTOP_ALPHA==='1';
export const desktop=desktopSmoke||desktopAlpha;
