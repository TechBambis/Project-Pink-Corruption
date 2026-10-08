// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceSettings, selectedExperience, needsExperienceChange, sectionScrollTarget} from '../apps/web/src/experience';

const chat = {mode: 'conversation', narration: false, events: false, aiMode: 'voice'};

test('saved narration profiles remain guided without changing their engine preferences', () => {
  assert.equal(selectedExperience(chat), 'conversation');
  assert.equal(selectedExperience({...chat, narration: true}), 'guided');
  assert.equal(selectedExperience({...chat, events: true}), 'guided');
  for (const mode of ['local', 'hybrid', 'official']) assert.equal(selectedExperience({...chat, mode, narration: true, events: true}), 'files');
});

test('guided entry enables speech and the director; chat entry restores room for replies', () => {
  for (const aiMode of ['off', 'text', 'voice', 'interactive']) {
    const guided = experienceSettings('guided', {...chat, aiMode}, false);
    assert.equal(guided.mode, 'conversation');
    assert.equal(guided['narration-enabled'], true);
    assert.equal(guided['session-events'], true);
    assert.equal(guided['conversation-style'], 'reactive');
    assert.equal(guided['ai-mode'], ['off', 'text'].includes(aiMode) ? 'voice' : undefined);
    for (const id of ['model', 'voice', 'speed', 'audio-preset', 'background-drone', 'master', 'device-enabled']) assert.equal(id in guided, false);
  }
  assert.deepEqual(experienceSettings('conversation', {...chat, narration: true, events: true, aiMode: 'text'}, false), {
    mode: 'conversation', 'narration-enabled': false, 'session-events': false, 'conversation-style': 'situational',
  });
});

test('recording selection preserves sound and narration preferences for future AI sessions', () => {
  assert.deepEqual(experienceSettings('files', chat, false), {mode: 'local'});
  assert.deepEqual(experienceSettings('files', chat, true), {mode: 'hybrid'});
});

test('explicit Guided entry upgrades legacy narration, while fully configured choices are idempotent', () => {
  assert.equal(needsExperienceChange('guided', {...chat, narration: true}), true);
  assert.equal(needsExperienceChange('guided', {...chat, narration: true, events: true}), false);
  for (const aiMode of ['off', 'text']) assert.equal(needsExperienceChange('guided', {...chat, narration: true, events: true, aiMode}), true);
  assert.equal(needsExperienceChange('conversation', chat), false);
  assert.equal(needsExperienceChange('conversation', {...chat, aiMode: 'off'}), true);
  assert.equal(needsExperienceChange('files', {...chat, mode: 'local'}), false);
  assert.equal(needsExperienceChange('files', {...chat, mode: 'official'}), true);
});

test('settings destinations below the picture or above the viewport are revealed', () => {
  assert.equal(sectionScrollTarget(0, 960, 1000, 50, 900), 894);
  assert.equal(sectionScrollTarget(500, 200, 240, 50, 900), 500);
  assert.equal(sectionScrollTarget(1000, -200, -160, 50, 900), 734);
  assert.equal(sectionScrollTarget(0, 0, 40, 50, 900), 0);
  assert.equal(sectionScrollTarget(0, 900, 940, 100, 844), 784);
});
