# Checks and default-branch protection

## Current enforcement

This repository is public. The active **Protect main** ruleset (ID `24698466`)
requires pull requests, resolved review threads, squash merges and the four
checks below against the current base. It blocks branch deletion and force
pushes, and has no bypass actors. The checked-in JSON matches this configuration.

Reserve Write access for trusted contributors; public downloads need no account.

## Application checks

`.github/workflows/checks.yml` runs on pushes to `main`, pull requests and manual
dispatch. Feature-branch pushes are checked through their PR to avoid duplicate
push and PR runs consuming the Actions allowance.
Its stable check names are:

| Required check | What it checks |
| --- | --- |
| `checks (22)` | Locked dependency install, high-severity dependency audit, repository hygiene, TypeScript, tests, web and extension builds, conversation evaluation |
| `checks (24)` | The same checks plus the isolated Playwright browser integration fixture |
| `secrets` | Checksum-pinned Gitleaks scan of fetched Git history with redacted output |
| `cla/verified` | Explicit maintainer verification of contribution rights for the current PR head and CLA version |

The CLA status is published by `.github/workflows/cla.yml` on PR and verification
comment events. It deliberately fails until the designated maintainer completes
the procedure in [CONTRIBUTING.md](../CONTRIBUTING.md). A green CI run, draft PR,
maintainer-authored PR or zero required approving reviews does not waive that
procedure. A new head commit requires fresh verification.

The browser fixture uses simulated inference, speech and device transport with
temporary storage; it does not validate native Windows/macOS runtime behavior
or actual hardware. Failure diagnostics expire after one day. Manual desktop
builds are not required checks because they do not run for every PR.

To rerun application checks, open **Actions → Application checks → Run workflow**
and select the branch. The workflow must be merged into the default branch before
GitHub exposes this button there. To rerun CLA verification, use its separate
manual workflow with the PR number. Always inspect checks for the latest PR head.

## Review or restore the ruleset

1. Confirm that `checks (22)`, `checks (24)`, `secrets` and `cla/verified` are being
   published on a PR. Fix failing CI and complete rights verification first.
2. Open **Settings → Rules → Rulesets → Protect main**. Use
   [protect-main.json](rulesets/protect-main.json) to review or restore the configuration.
3. Update the existing ruleset rather than creating a duplicate. It targets the default branch, blocks
   deletion and force pushes, requires a PR with resolved review threads, allows
   only squash merges and requires all four checks against the current base.
4. Verify the active configuration on the repository's `/rules` page and in a
   PR merge box. Each required check is bound to GitHub Actions (app ID `15368`).

The bypass list is empty. Zero required approving reviews allows a sole
maintainer to merge after the checks and rights verification pass. When a second
reviewer is available, raise the approval count to one. Do not require an approval
from the PR author: GitHub does not count self-approval.

Keep squash merging enabled and merge/rebase merging disabled in repository
settings. Commit signatures, deployments, code scanning, code quality and
coverage gates are not required until their respective workflows are established.

References: [GitHub ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets),
[importing rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository#importing-a-ruleset).
