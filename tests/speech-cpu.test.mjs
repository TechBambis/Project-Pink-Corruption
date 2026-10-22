// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('speech CPU profiles match the host and model and validate explicit overrides', {skip:process.platform!=='linux'},()=>{
 const result=spawnSync('/usr/bin/python3',['tests/speech_cpu_test.py'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
