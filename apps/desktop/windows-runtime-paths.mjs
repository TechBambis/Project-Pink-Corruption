// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import {fileURLToPath} from 'node:url';

export function backendArguments(supervisorURL){
 // --import takes an ESM specifier. A Windows drive path would be interpreted
 // as a c: URL scheme; keep this argument as an encoded file URL.
 return ['--import',new URL('../../node_modules/tsx/dist/loader.mjs',supervisorURL).href,fileURLToPath(new URL('../../apps/server/index.ts',supervisorURL))];
}
