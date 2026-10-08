// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { buildStablePrompt, contentCatalog, contentRoot, prompts, triggerData } from '../packages/content';
import { AmbientAgent } from '../packages/session-director/ambient';

test('retained upstream content, including separately preserved overridden originals, matches its pinned manifest', () => {
  const manifest = JSON.parse(readFileSync(contentRoot + 'manifest.json', 'utf8'));
  const overrides = JSON.parse(readFileSync(new URL('../packages/content/local-overrides.json',import.meta.url),'utf8'));
  assert.equal(manifest.commit, '3f5e9b336382f1f49ac2edde3c0281845f74b0a3');
  // Detect unreviewed additions and missing entries, rather than requiring a full website archive.
  const collect=(directory:string,prefix=''):string[]=>readdirSync(directory,{withFileTypes:true})
    .flatMap(entry=>entry.isDirectory()?collect(directory+'/'+entry.name,prefix+entry.name+'/'):[prefix+entry.name]);
  assert.deepEqual(collect(contentRoot).filter(path=>path!=='manifest.json').sort(),
    manifest.files.map((entry:{path:string})=>entry.path).sort());
  for(const path of ['workers/triggers.json','workers/prompts/bambisleep-classic.json','workers/prompts/gentle-induction.json','workers/ollama.js','package.json'])
    assert.ok(manifest.files.some((entry:{path:string})=>entry.path===path),'Runtime and reference dependencies remain included: '+path);
  assert.equal(contentCatalog().docs.length,14);
  assert.ok(contentCatalog().docs.every((path:string)=>manifest.files.some((entry:{path:string})=>entry.path===path)));
  for (const entry of manifest.files) {
    const bytes = readFileSync(contentRoot + (overrides[entry.path]?.original ?? entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
  }
  for(const path of Object.keys(overrides)){
    assert.ok(manifest.files.some((entry:{path:string})=>entry.path===path),'Only explicitly identified local overrides use a preserved original');
    const local=JSON.parse(readFileSync(contentRoot+path,'utf8'));
    for(const key of ['main','collar_addon','strategy'])assert.ok(typeof local[key]==='string'||(Array.isArray(local[key])&&local[key].every((line:unknown)=>typeof line==='string')));
  }
});

test('ambient agent respects original idle threshold, cooldown, busy replies and session restarts', () => {
  const agent = new AmbientAgent();
  assert.equal(agent.next(299, true), null);
  assert.equal(agent.next(300, true), null); // The previous check schedules the next check 60 seconds later.
  assert.deepEqual(agent.next(360, true), { reason: 'idle', trigger: '' });
  agent.message(400, 'TECHNICAL MARKER');
  assert.equal(agent.next(500, true), null);
  assert.equal(agent.next(540, false), null);
  assert.deepEqual(agent.next(540, true), { reason: 'trigger', trigger: 'TECHNICAL MARKER' });
  agent.reset(1000);
  assert.equal(agent.next(1200, true), null);
  assert.deepEqual(agent.next(1300, true), { reason: 'idle', trigger: '' });
});

test('every snapshotted BambiCloud trigger is available offline without replacing the pinned archive',()=>{
  const cloud=JSON.parse(readFileSync('packages/content/bambicloud-triggers.json','utf8'));
  const names=contentCatalog().triggers.map(trigger=>trigger.name.toUpperCase());
  assert.equal(cloud.names.length,65);
  assert.equal(new Set(names).size,names.length);
  for(const name of cloud.names)assert.ok(names.includes(name.toUpperCase()),name);
  assert.ok(names.includes('BAMBI EYES LOCK'));
  assert.ok(names.includes('BAMBI VOICE BOX OFF'));
  assert.ok(names.includes("IT'S WHAT YOU'RE MADE FOR"));
  assert.deepEqual(contentCatalog().defaultTriggers,['BAMBI','BAMBI SLEEP','BAMBI RESET']);
});

test('both system prompts equal the original worker with selected, fallback and custom triggers and collar settings', async () => {
  const source = readFileSync(contentRoot + 'workers/ollama.js', 'utf8');
  // Execute the actual upstream prompt code, without booting its network worker.
  const manager = source.slice(source.indexOf('class PromptManager'), source.indexOf('// Initialize configuration'));
  const role = source.slice(source.indexOf('function getDefaultTriggers()'), source.indexOf('// Handle /prompt chat commands'));
  const context = {
    console: { log() {}, warn() {}, error() {} },
    promptDefinitions: Object.fromEntries(prompts.map(prompt => [prompt.id, prompt])),
    triggerData: Object.fromEntries(triggerData.triggers.map(trigger => [trigger.name.toUpperCase(), trigger])),
    collarText: '',
  };
  const reference = runInNewContext(manager + `
    const promptManager = new PromptManager('');
    promptManager.prompts = promptDefinitions;
    promptManager.defaultPromptId = 'bambisleep-classic';
    ${role}
    checkRole;
  `, context);
  for (const prompt of prompts) for (const selected of [[], ['good girl'], ['BAMBI SLEEP', 'Custom technical marker']]) {
    for (const collar of [false, true]) {
      context.collarText = collar ? 'My saved configuration $& {{username}}' : '';
      const expected = await reference(collar, 'Test $& User', selected, prompt.id);
      const actual = buildStablePrompt(prompt.id, 'Test $& User', selected, collar, context.collarText);
      assert.equal(actual, expected, `${prompt.id}, ${selected.length}, collar ${collar}`);
    }
  }
});
