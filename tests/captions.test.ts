// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenWordAt } from '../apps/web/src/captions';
import {speechTextAt} from '../packages/speech/reveal';

test('session captions use measured spoken word times and expire with audio', () => {
  const words = [{ word: 'Pink', atMs: 200 }, { word: 'Bambi', atMs: 700 }];
  assert.equal(spokenWordAt('Pink Bambi', 100, 1000, words), '');
  assert.equal(spokenWordAt('Pink Bambi', 200, 1000, words), 'Pink');
  assert.equal(spokenWordAt('Pink Bambi', 699, 1000, words), 'Pink');
  assert.equal(spokenWordAt('Pink Bambi', 700, 1000, words), 'Bambi');
  assert.equal(spokenWordAt('Pink Bambi', 1000, 1000, words), '');
});

test('already running servers without word timings still show only one word', () => {
  assert.equal(spokenWordAt('Pink Bambi', -1, 1000), '');
  assert.equal(spokenWordAt('Pink Bambi', 0, 1000), 'Pink');
  assert.equal(spokenWordAt('Pink Bambi', 500, 1000), 'Bambi');
  assert.equal(spokenWordAt('Pink Bambi', 1000, 1000), '');
  assert.equal(spokenWordAt('', 100, 1000), '');
});

test('multiword timing entries are displayed as individual words', () => {
  const words = [{ word: 'Pink Bambi', atMs: 0 }];
  assert.equal(spokenWordAt('Pink Bambi', 0, 1000, words), 'Pink');
  assert.equal(spokenWordAt('Pink Bambi', 500, 1000, words), 'Bambi');
});

test('cumulative reply and event captions expose the same latest word at every onset',()=>{
 const text='Pink Bambi, settle.',words=[{word:'Pink Bambi,',atMs:200},{word:'settle.',atMs:800}];
 for(const at of [0,199,200,499,500,799,800,999]){
  const prefix=speechTextAt(text,at,1000,words);
  assert.equal(prefix.trim().split(/\s+/).filter(Boolean).at(-1)??'',spokenWordAt(text,at,1000,words));
 }
 assert.equal(speechTextAt(text,1000,1000,words),text);
 assert.equal(speechTextAt(text,-1,1000,words),'');
});
