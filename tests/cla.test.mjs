// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {hasVerification, maintainerId, run} from '../scripts/cla-check.mjs';

const hash = createHash('sha256').update(readFileSync(new URL('../CLA.md', import.meta.url))).digest('hex');
const head = '1'.repeat(40);
const receipt = (id = maintainerId, versionHash = hash, commit = head) => ({
  user: {id}, body: `CLA-VERIFIED v1 sha256=${versionHash} head=${commit}`
});

test('CLA receipt rejects impersonation, stale work and stale agreement', () => {
  assert.equal(hasVerification([receipt()], hash, head), true);
  assert.equal(hasVerification([receipt(76081320)], hash, head), false);
  assert.equal(hasVerification([receipt(maintainerId, '0'.repeat(64))], hash, head), false);
  assert.equal(hasVerification([receipt(maintainerId, hash, '2'.repeat(40))], hash, head), false);
  assert.equal(hasVerification([{...receipt(), body: `${receipt().body}\nnot verified`}], hash, head), false);
  assert.equal(hasVerification([], hash, head), false);
});

async function simulate({comments = [], changedHead = false, commentsFail = false, pages = false} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bambi-cla-test-'));
  const path = join(directory, 'event.json');
  writeFileSync(path, JSON.stringify({pull_request: {number: 7}}));
  const statuses = [];
  let prReads = 0;
  const request = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    if (url.endsWith(`statuses/${head}`)) {
      statuses.push(JSON.parse(options.body));
      return Response.json({});
    }
    if (url.endsWith('pulls/7')) {
      prReads++;
      return Response.json({state: 'open', head: {sha: changedHead && prReads > 1 ? '2'.repeat(40) : head}});
    }
    assert.match(url, /issues\/7\/comments\?per_page=100&page=\d+$/);
    if (commentsFail) return new Response('', {status: 500});
    if (pages && url.endsWith('page=1')) return Response.json(Array.from({length: 100}, () => receipt(42)));
    return Response.json(comments);
  };
  try {
    let error;
    try {
      await run({env: {GITHUB_EVENT_PATH: path, GITHUB_REPOSITORY: 'fixture/project', GITHUB_TOKEN: 'fixture-token'}, request});
    } catch (caught) {error = caught;}
    return {statuses, error};
  } finally {rmSync(directory, {recursive: true, force: true});}
}

test('unverified fork contributions publish failure on the actual head', async () => {
  const {statuses, error} = await simulate({comments: [receipt(42)]});
  assert.equal(error, undefined);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'failure']);
  assert.ok(statuses.every(status => status.context === 'cla/verified'));
});

test('maintainer verification is found beyond the first comment page', async () => {
  const {statuses, error} = await simulate({comments: [receipt()], pages: true});
  assert.equal(error, undefined);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'success']);
});

test('a racing push cannot obtain success for the previous head', async () => {
  const {statuses, error} = await simulate({comments: [receipt()], changedHead: true});
  assert.equal(error, undefined);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'failure']);
});

test('GitHub API failure leaves a blocking error instead of success', async () => {
  const {statuses, error} = await simulate({commentsFail: true});
  assert.match(error.message, /500/);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'error']);
});
