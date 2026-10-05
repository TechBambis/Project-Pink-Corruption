// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationCases,assessConversation} from '../packages/ai/evaluation';
test('evaluation corpus has forty-eight unique neutral cases across eight dimensions',()=>{
 const cases=conversationCases();assert.equal(cases.length,48);assert.equal(new Set(cases.map(item=>item.id)).size,48);assert.equal(new Set(cases.map(item=>item.category)).size,8);
 assert.ok(cases.filter(item=>item.category==='preference updates').every(item=>item.turns.length>40));
 assert.equal(assessConversation(cases.find(item=>item.id==='correction-0')!,'green').passed,true);
 assert.equal(assessConversation(cases.find(item=>item.id==='correction-0')!,'blue').passed,false);
 assert.equal(assessConversation(cases.find(item=>item.id==='brief-0')!,'Pitch stays constant. Another sentence.').passed,false);
});
