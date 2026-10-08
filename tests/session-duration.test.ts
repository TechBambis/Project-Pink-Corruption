// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {savedSessionDuration,durationTime,migrateSessionDuration} from '../apps/web/src/session-duration';

test('Unlimited is the default, while saved finite durations remain bounded session choices',()=>{
 assert.equal(savedSessionDuration('unlimited'),null);
 assert.equal(savedSessionDuration('16506.028709666665'),null);
 for(const value of [undefined,null,'',-1,Infinity,'bad'])assert.equal(savedSessionDuration(value),null);
 for(const duration of [60,300,600,1200,1800,3600,7200])assert.equal(savedSessionDuration(String(duration)),duration);
});
test('old 20-minute defaults migrate once; deliberately saved durations and other preferences survive',()=>{
 assert.deepEqual(migrateSessionDuration({duration:'1200',voice:'af_sarah'}),{duration:'unlimited',voice:'af_sarah'});
 assert.deepEqual(migrateSessionDuration({voice:'af_sarah'}),{duration:'unlimited',voice:'af_sarah'});
 for(const duration of ['300','600','1800','3600'])assert.equal(migrateSessionDuration({duration}).duration,duration);
 assert.equal(migrateSessionDuration({duration:'1200','duration-version':1}).duration,'1200');
});
test('media duration labels express long and fractional recordings as readable time',()=>{
 assert.equal(durationTime(16506.028709666665),'4:35:06');
 assert.equal(durationTime(21.73),'00:21');
 assert.equal(durationTime(1200),'20:00');
});
