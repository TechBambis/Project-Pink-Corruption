// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BAMBISLEEP_SAMPLING } from '../../config/sampling';
const run = promisify(execFile);
export async function prepareNativeModel(model: string, context: number = BAMBISLEEP_SAMPLING.context) {
  await run('/usr/bin/python3', ['scripts/llama-runtime.py', 'start', '--model', model, '--context', String(context)], { timeout: 120000 });
}
export async function stopNativeModel() {
  await run('/usr/bin/python3', ['scripts/llama-runtime.py', 'stop'], { timeout: 15000 });
}
