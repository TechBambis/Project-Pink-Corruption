// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('speculative benchmark guards use only offline streams, temporary files and isolated fake children', {skip:process.platform!=='linux'},()=>{
 const result=spawnSync('python3',['tests/speculative_benchmark_test.py'],{encoding:'utf8',timeout:25000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
