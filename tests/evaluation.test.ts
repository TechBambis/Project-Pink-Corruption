// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationCases,englishConversationScenarios,assessConversation} from '../packages/ai/evaluation';
test('evaluation corpus has forty-eight unique neutral cases across eight dimensions',()=>{
 const cases=conversationCases();assert.equal(cases.length,48);assert.equal(new Set(cases.map(item=>item.id)).size,48);assert.equal(new Set(cases.map(item=>item.category)).size,8);
 assert.ok(cases.filter(item=>item.category==='preference updates').every(item=>item.turns.length>40));
 assert.equal(assessConversation(cases.find(item=>item.id==='correction-0')!,'green').passed,true);
 assert.equal(assessConversation(cases.find(item=>item.id==='correction-0')!,'blue').passed,false);
 assert.equal(assessConversation(cases.find(item=>item.id==='brief-0')!,'Pitch stays constant. Another sentence.').passed,false);
});

test('English evaluation includes follow-up objections, corrections, task changes and real limits with human-review rubrics',()=>{
 const scenarios=englishConversationScenarios();assert.equal(scenarios.length,8);assert.equal(new Set(scenarios.map(s=>s.id)).size,8);
 assert.ok(scenarios.every(s=>s.steps.length===4&&s.rubric.length>=2));
 assert.match(scenarios.find(s=>s.id==='objection')!.steps[2].request,/feedback is wrong/);
 assert.match(scenarios.find(s=>s.id==='control')!.steps[1].request,/Stop the roleplay/);
 assert.match(scenarios.find(s=>s.id==='recall')!.steps[2].request,/violet/);
 const step=scenarios.find(s=>s.id==='style')!.steps[3];
 const item={...step,id:'fixture',category:'style',turns:[],intent:'conversation' as const};
 assert.equal(assessConversation(item,'Begin with a five-minute break.').passed,true);
 assert.equal(assessConversation(item,'Begin with a break. Then continue.').passed,false);
 assert.equal(assessConversation(item,'Begin with a break.').requiresHumanReview,true);
});

test('English recall assessment rejects retaining the old lighting preference after an explicit correction',()=>{
 const step=englishConversationScenarios().find(s=>s.id==='recall')!.steps[3];
 const item={...step,id:'fixture',category:'recall',turns:[],intent:'conversation' as const};
 assert.equal(assessConversation(item,'Your lighting preference is blue, and no promise was made.').passed,false);
 assert.equal(assessConversation(item,'Your lighting preference is violet, and no promise was made.').passed,true);
});
