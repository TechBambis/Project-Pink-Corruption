// SPDX-FileCopyrightText: 2026 BambiOS
// SPDX-License-Identifier: AGPL-3.0-only
// Separate commercial permissions: see LICENSING.md.

import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Numeric identity survives a login rename. No author, bot or label bypass.
export const maintainerId = 337824705;
export function hasVerification(comments, hash, head) {
  const receipt = `CLA-VERIFIED v1 sha256=${hash} head=${head}`;
  return comments.some(comment => comment.user?.id === maintainerId && comment.body?.trim() === receipt);
}

export async function run({env = process.env, request = fetch} = {}) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const number = String(event.pull_request?.number ?? event.issue?.number ?? env.CLA_PR_NUMBER ?? '');
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[1-9]\d*$/.test(number) || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !env.GITHUB_TOKEN) {
    throw new Error('Missing or invalid CLA check configuration.');
  }
  const api = async (path, body) => {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? {'Content-Type': 'application/json'} : {})
      },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) throw new Error(`GitHub API request failed (${response.status}).`);
    return response.json();
  };
  const pr = await api(`pulls/${number}`);
  if (pr.state !== 'open') return;
  const head = pr.head.sha;
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid PR head.');
  const status = (state, description) => api(`statuses/${head}`, {
    state, context: 'cla/verified', description,
    target_url: `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository}/pull/${number}`
  });
  await status('pending', 'Checking maintainer verification of contributor permissions.');
  try {
    const hash = createHash('sha256').update(readFileSync(new URL('../CLA.md', import.meta.url))).digest('hex');
    const comments = [];
    for (let page = 1; ; page++) {
      if (page > 50) throw new Error('Comment limit reached; manual review required.');
      const batch = await api(`issues/${number}/comments?per_page=100&page=${page}`);
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    // A head change during the check leaves this older head without success.
    const current = await api(`pulls/${number}`);
    if (current.head.sha !== head || current.state !== 'open') {
      await status('failure', 'PR changed during verification; recheck required.');
      return;
    }
    const verified = hasVerification(comments, hash, head);
    await status(verified ? 'success' : 'failure', verified
      ? 'Maintainer verified permissions for this head and CLA version.'
      : 'Explicit contributor assent and maintainer verification required.');
    console.log(`CLA ${verified ? 'verified' : 'verification required'} for PR #${number}. CLA SHA-256: ${hash}`);
  } catch (error) {
    await status('error', 'CLA verification could not be completed; review required.');
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(error => {console.error(error.message); process.exitCode = 1;});
}
