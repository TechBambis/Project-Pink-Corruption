// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('isolated TTS trials pin assets, reject path escapes and clean failed downloads', {skip:process.platform!=='linux'},()=>{
 const result=spawnSync('/usr/bin/python3',['tests/tts_nano_test.py'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
