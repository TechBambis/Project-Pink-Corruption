// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {savedSessionDuration,durationTime} from '../apps/web/src/session-duration';

test('legacy playlist lengths cannot become an unbounded authored AI session',()=>{
 assert.equal(savedSessionDuration('16506.028709666665'),1200);
 for(const value of [undefined,null,'',-1,Infinity,'bad'])assert.equal(savedSessionDuration(value),1200);
 for(const duration of [60,300,600,1200,1800,3600,7200])assert.equal(savedSessionDuration(String(duration)),duration);
});
test('media duration labels express long and fractional recordings as readable time',()=>{
 assert.equal(durationTime(16506.028709666665),'4:35:06');
 assert.equal(durationTime(21.73),'00:21');
 assert.equal(durationTime(1200),'20:00');
});
