// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {cueTimelinePoints,nearestCue} from '../packages/media/cue-timeline';
import {parseBambiCloudCues} from '../packages/media/bambicloud';

test('timeline uses source milliseconds and actual recording duration, omitting out-of-range events',()=>{
 const cues=parseBambiCloudCues([{start:1000,trigger:'Good girl'},{start:4000,trigger:'Bambi eyes lock'},{start:12000,trigger:'Other'}]);
 const points=cueTimelinePoints(cues,10);
 assert.deepEqual(points.map(p=>[p.seconds,p.position,p.name]),[[1,.1,'Good girl'],[4,.4,'Bambi eyes lock']]);
 assert.equal(cueTimelinePoints(cues,NaN).length,0);
 assert.equal(cueTimelinePoints(cues,0).length,0);
 assert.equal(cueTimelinePoints(cues,20)[0].position,.05);
});
test('hover handles timeline ends, empty recordings and repeated cues without executing or advancing them',()=>{
 const points=cueTimelinePoints(parseBambiCloudCues([{start:0,trigger:'First'},{start:2000,trigger:'Middle'},{start:8000,trigger:'Last'}]),10);
 assert.equal(nearestCue(points,0)?.name,'First');
 assert.equal(nearestCue(points,1.8)?.name,'Middle');
 assert.equal(nearestCue(points,10)?.name,'Last');
 assert.equal(nearestCue([],3),undefined);
 assert.equal(nearestCue(points,NaN),undefined);
 assert.deepEqual(points.map(p=>p.seconds),[0,2,8]);
});
