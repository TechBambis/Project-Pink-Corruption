# Contributing

Bug reports and suggestions are welcome without signing a CLA. Please keep personal data, credentials, recordings and private conversation history out of issues and PRs.

## Licensing before submitting code

Read [LICENSING.md](LICENSING.md) and the [Contributor License Agreement](CLA.md). Contributions need explicit acceptance of the CLA, or separately verified permissions sufficient for the same licensing model, before merging. A PR alone is not acceptance. The CLA permits proprietary/commercial relicensing without royalties; you retain copyright. If that does not work for you, do not submit work for inclusion.

The maintainer provides an immutable `CLA.md` link and its SHA-256. Follow the acceptance text in that document for the work you authored. Identify any employer rights, coauthors, copied code, assets and their licenses. Never change third-party attribution to claim it as your own. Preserve existing notices and pinned upstream files.

## Checks

```sh
npm ci --ignore-scripts
npm run repo:check
npm run check
npm test
npm run build
```

Keep runtime data, model downloads and private assets out of Git. Describe the behavior changed and relevant validation in the PR. Native setup currently targets Linux; do not infer Windows or macOS support from browser-only checks.

For the optional browser integration check, install Playwright's Chromium with `npx playwright install chromium`, then run `npm run test:integration` after building. You can instead set `BAMBI_BROWSER_BINARY` to an existing Chromium-compatible browser. The check uses temporary storage, simulated inference/speech and simulated device transport.

## Maintainer CLA verification

The `cla/verified` commit status starts failing until the designated maintainer verifies all necessary rights holders for the current PR head and current CLA. The check runs trusted default-branch code and never executes code from a PR. It does not automatically infer assent from submitting a PR or from a label.

1. Provide contributors with the immutable CLA link and its SHA-256; verify account IDs, authority, contribution scope and assent for all relevant authors. The hash can be calculated with `sha256sum CLA.md`.
2. Preserve the accepted document and the assent evidence, contributor IDs, timestamp and covered commit SHA in a private durable record. Do not put private contractual identity details in the public repository.
3. Post a standalone comment as the designated maintainer (GitHub account ID `337824705`):

   ```text
   CLA-VERIFIED v1 sha256=<64 lowercase hex characters> head=<40 lowercase hex characters>
   ```

4. A new head commit, CLA change, deleted verification or edited verification requires a fresh check. Use the workflow's manual recheck after updating the default-branch CLA. Reviewers must not waive consent solely because another test passed.

The workflow publishes a status; **it blocks merging only after a repository ruleset or branch protection requires `cla/verified` from GitHub Actions**. Once the GitHub repository exists, enable that required status, prevent direct pushes and review bypass permissions before accepting external contributions. The local files cannot configure a remote repository that does not exist yet.
