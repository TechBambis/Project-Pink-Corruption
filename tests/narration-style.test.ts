// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultNarrationStyle, migrateNarrationStyle} from '../apps/web/src/narration-style';

test('Legacy custom text is preserved independently for Chat and Guided', () => {
  const old={persona:'Calm and precise.', 'prompt-template':'bambisleep-classic', master:.41};
  const migrated=migrateNarrationStyle(old);
  assert.equal(migrated['guided-style'],old.persona);
  assert.equal(migrated.persona,old.persona);
  assert.equal(migrated.master,.41);
  assert.equal('guided-style' in old,false,'Migration does not mutate the saved source');
});

test('Separate Guided text survives later changes to Chat personality', () => {
  const migrated=migrateNarrationStyle({persona:'Playful.', 'guided-style':'Quiet and certain.'});
  assert.equal(migrated['guided-style'],'Quiet and certain.');
  assert.equal(migrateNarrationStyle({...migrated,persona:'Inquisitive.'})['guided-style'],'Quiet and certain.');
});

test('An intentionally empty Guided style stays empty across migration', () => {
  assert.equal(migrateNarrationStyle({persona:'Playful.', 'guided-style':''})['guided-style'],'');
  assert.equal(migrateNarrationStyle({persona:''})['guided-style'],'');
});

test('Fresh and invalid legacy values use the existing narration default', () => {
  assert.equal(migrateNarrationStyle({})['guided-style'],defaultNarrationStyle);
  assert.equal(migrateNarrationStyle({persona:false,'guided-style':17})['guided-style'],defaultNarrationStyle);
});
