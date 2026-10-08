# Verified desktop releases

The tag release pipeline produces **Linux x64 AppImage and Windows x64 per-user NSIS smoke installers together**. Smoke packages contain the offline sample and desktop shell; they do not contain local AI or speech services. Existing AI alpha builds and manual workflows remain separate until their additional release gates and native prerequisites are qualified.

## What happens on a release tag

`vX.Y.Z`, `vX.Y.Z-smoke.N`, `vX.Y.Z-beta.N` and `vX.Y.Z-rc.N` trigger `.github/workflows/release.yml`. Normal branch pushes and pull requests run application checks, without creating releases. Unsupported/malformed tags fail the release preflight; AI `alpha` tags are intentionally not accepted by this smoke publication workflow.

1. Verify the tag resolves to the exact checked-out commit, the configured maintainer initiated the push, package/lockfile base versions agree, and temporary artifact storage has room. An annotated or lightweight tag is supported.
2. Run the existing application check workflow: locked dependency installation, dependency audit, repository hygiene, TypeScript, tests, extension build, conversation evaluation, browser integration and the pinned history secret scan. There is no invented lint command.
3. Freeze that commit's reviewed source independently on standard `ubuntu-24.04` and `windows-2022` x64 runners. Install with `npm ci --ignore-scripts`, check the frozen source and build once using the existing native builders. Downloads outside npm already use the builders' pinned runtime checksums; no dependency/lockfile updates are performed.
4. Exercise the finished AppImage's extracted payload through its `AppRun`, and exercise the finished Windows installer through installation, application checks, uninstallation and reinstallation. Inspect bound runtime/source inventories and reject obvious sensitive/local paths in transferred source/notice archives. Original third-party notices are preserved.
5. Stage only one primary executable per platform, matching source, notices, native evidence, runtime manifests and a scoped npm CycloneDX SBOM. Transfer these exact bytes using official artifact actions with digest mismatch configured to fail.
6. Verify both targets have successful bound checks, matching canonical application source, unchanged downloads and the expected tag/commit/run. Assemble `BUILD-INFO.json` and `SHA256SUMS` deterministically from transferred records. No executable is rebuilt.
7. In public repositories, the pinned official `actions/attest` creates build provenance for **every final attached file**, including source/notice archives, metadata, SBOMs and `SHA256SUMS`. Private repositories skip this unsupported Free-plan operation.
8. The publication job independently assembles the same bytes, verifies public build attestations against repository/workflow/tag/commit, confirms the remote tag, creates a draft with GitHub CLI, uploads all assets, checks GitHub's uploaded SHA-256 digests and sizes, rechecks the tag and publishes last. A failed platform or required verification prevents publication. Existing releases are never overwritten.
9. Remove only the current successful run's two temporary transfer artifacts. Failed-run artifacts expire after one day; their retention is not permanent distribution storage.

## Downloadable files

Each release includes:

- `bambi-local-VERSION-x86_64.AppImage` and `bambi-local-VERSION-x64.exe`.
- `SHA256SUMS` and aggregate `BUILD-INFO.json`.
- Per-platform `linux-x64-` / `windows-x64-` `BUILD-INFO.json`, `RUNTIME-MANIFEST.json`, `SOURCE-CHECKS.json`, `DESKTOP-QUALIFICATION.json`, `PACKAGING-CHECK.json`, `SBOM.cdx.json` and `NOTICES.tar.gz`; Windows also includes `INSTALLER-CHECK.json`.
- `bambi-local-VERSION-linux-x64-source.tar.gz` and `bambi-local-VERSION-windows-x64-source.tar.gz`. These are the exact matching application source retained by the native builders. Separate archives preserve each native source-byte identity; canonical identity must agree even when checkouts differ in line endings.

The extra runtime tar, unpacked runtime, caches, local databases, logs and working directories are not uploaded. GitHub's automatic source archives also remain available, but do not replace matching source and bundled third-party license/source records. Generated source archives cannot be verified as release assets using `gh release verify-asset`; the attached matching-source archives can.

## One-time maintainer setup

No GitHub settings or billing changes are made by the repository scripts.

1. Review and commit the intended repository changes, including the workflows and release helpers. Uncommitted work is not part of a Git tag. Confirm the active GitHub account is the intended maintainer, numeric ID **337824705**, before pushing. That ID is also the initial release allowlist in `config/release-pipeline.json`; future maintainers must be explicitly reviewed and added there.
2. Ensure repository Actions can use standard Linux/Windows GitHub-hosted runners and the official pinned actions. Existing organization policy may restrict them. The automatic `GITHUB_TOKEN` receives job-specific permissions; no personal access token, registry, signing key or new service is required.
3. For private releases, review the repository owner's remaining **account-wide** Actions/Packages allowance and zero paid-usage controls. Without a payment method, GitHub blocks over-quota use; otherwise use an applicable zero-dollar Actions budget with **Stop usage when budget limit is reached**. An alert-only budget does not stop usage. After actually checking this, set repository Actions variable `RELEASE_FREE_ALLOWANCE_CONFIRMED` to `true`. Until then, private preflight fails before installation/build work. Clear it if the allowance/billing assumptions stop being true.
4. Recommended: repository **Settings → Releases → Enable release immutability**. This one-time setting protects future releases. It cannot be enabled by committing YAML. The workflow already uploads a complete draft before publication and works with immutability enabled. If left disabled, ordinary Releases still work, but do not have immutable-release protection or release attestations.
5. Ensure the default branch contains this reviewed setup before the first tag. No local compilation is necessary.

To inspect the currently authenticated account without changing it:

```sh
gh api user --jq '{login: .login, id: .id}'
```

The release automation runs as GitHub's repository-scoped Actions token, not as a second connected personal account. It checks the initiating maintainer's numeric actor ID.

## First beta release

After reviewing and committing the release setup and completing the one-time private allowance check:

```sh
git checkout main
git pull --ff-only
git status --short
gh api user --jq '{login: .login, id: .id}'
# Confirm there are no intended uncommitted release changes and the ID is 337824705.
# This example assumes package.json and package-lock.json both declare 0.1.0.
git tag -a v0.1.0-beta.1 -m "v0.1.0-beta.1"
git push origin v0.1.0-beta.1
```

Use a fresh tag. To release a different base version, update and commit `package.json` and both lockfile root version fields first, following the existing versioning policy; never update a lockfile in the release job. `beta`, `rc` and `smoke` tags automatically create prereleases and do not become the latest stable release. A stable tag is handled as a regular release, but the current workflow still explicitly labels its packages **smoke**. Do not present them as a feature-complete application. General AI-alpha publication requires a separate reviewed scope change.

If any job fails, inspect its logs. If upload verification fails after draft creation, the draft remains unpublished. Review and remove that failed draft explicitly before retrying; this pipeline refuses to replace existing release assets. Never silently move a published version tag. With immutability enabled, publish a new version to correct a release.

Optional defense in depth: configure free SSH/GPG Git tag signing and use `git tag -s` instead of `git tag -a`. Key provisioning is not part of this pipeline; signed tags do not replace build or release attestations.

## Verify a download

Replace `OWNER/REPO` with the actual repository from the release page / `BUILD-INFO.json`; currently the origin is `TechBambis/Project-Pink-Corruption`. Do not blindly trust a different repository identifier supplied with an unsolicited binary. Private beta downloads require authenticated access to the private repository. GitHub Release links do not make private binaries publicly downloadable.

Linux example, using a recent GitHub CLI:

```sh
gh release download v0.1.0-beta.1 --repo TechBambis/Project-Pink-Corruption --dir bambi-release
cd bambi-release
sha256sum -c SHA256SUMS
```

macOS provides `shasum -a 256 -c SHA256SUMS`. Windows PowerShell can verify an individual file with:

```powershell
Get-FileHash .\bambi-local-0.1.0-beta.1-x64.exe -Algorithm SHA256
# Compare with its exact entry in SHA256SUMS.
```

When release immutability is enabled:

```sh
gh release verify v0.1.0-beta.1 --repo TechBambis/Project-Pink-Corruption
gh release verify-asset v0.1.0-beta.1 ./bambi-local-0.1.0-beta.1-x86_64.AppImage --repo TechBambis/Project-Pink-Corruption
```

For a **public** release with an Actions build attestation:

```sh
gh attestation verify ./bambi-local-0.1.0-beta.1-x86_64.AppImage \
  --repo TechBambis/Project-Pink-Corruption \
  --signer-workflow TechBambis/Project-Pink-Corruption/.github/workflows/release.yml \
  --source-ref refs/tags/v0.1.0-beta.1 \
  --source-digest FULL_EXPECTED_COMMIT_SHA
```

Obtain the expected commit independently from the trusted tag/source view. Substitute the Windows installer filename to verify that download. Checksums cover every attached file except `SHA256SUMS` itself; the public build attestation covers the checksum file too. Verification does not require disabling any operating-system security controls.

## Private beta and public protection

GitHub Free, Pro and Team support Actions artifact attestations for **public** repositories; private/internal repositories require Enterprise Cloud. A private Free beta therefore uses locked dependencies, native runner checks, exact commit/run metadata, matched source, digest-verified transfers, checksums and automated draft publication. SHA-256 alone does **not** prove provenance.

On changing visibility to public, the attestation job activates from the actual event visibility automatically. Public publication additionally checks current API visibility and requires successful attestation verification, so a visibility change during a run cannot bypass it. Release immutability and its automatically created **release attestation** are a separate feature controlled by the maintainer setting; they are not the public-only Actions build-attestation operation.

## Permissions and dependencies

| Job | Token permissions |
| --- | --- |
| Preflight | `contents: read`, `actions: read` for storage inventory |
| Existing application checks and native builds | `contents: read` |
| Public build attestation only | `contents: read`, `id-token: write`, `attestations: write` |
| Release publication only | `contents: write` |
| Successful temporary transfer cleanup only | `actions: write` |

Write permissions are not available to the build/test jobs. No `write-all`, long-lived publishing secrets, third-party release action or paid runner is used. Official actions are pinned to immutable commits with version comments. Existing weekly npm and GitHub Actions Dependabot configuration maintains dependencies; it does not update them inside a release build. Source/event fields are passed through environment variables or structured command arguments, rather than interpolated into executable shell text. Dependency caching uses official setup-node npm support, never cached release binaries.

## Cost and remaining limits

Recent smoke executables total roughly 320 MiB. The transfer policy caps each platform at 200 MiB and the combined transfers at 400 MiB, uses one-day retention and deletes successful current-run transfers. Preflight checks existing repository Actions artifacts against 500 MB before expensive work; it cannot inspect every other repository's usage or all account-wide Packages storage. The owner's checked free allowance and spending controls remain essential.

GitHub Free currently includes 2,000 Actions minutes/month and 500 MB artifact storage, shared as documented with Packages. Standard public runner time is free; private Linux/Windows jobs consume allowance. No larger runners are used. Plan approximately **30–75 summed runner minutes per smoke release**, pending measurement of this exact new workflow; Windows and Linux have different billing rates/allowance accounting. Job timeouts bound failures (preflight 5, existing checks 20 per Node version plus secret scan 10, native 45 per platform, attestation 10, publication 10, cleanup 5). Queued time is separate from runner execution. The private confirmation check may prevent a run; a workflow file alone cannot guarantee a zero bill if account paid overage is permitted.

These controls distinguish three claims:

- **Integrity:** the downloaded file matches a specific digest.
- **Provenance:** signed evidence links that digest to the identified release or workflow/source commit. The aggregation job attests the verified native outputs from the same workflow; this is not an independent execution audit of every command or a claim of SLSA level certification.
- **Code security:** source review, dependency inspection and meaningful tests address application behavior. Attestations do not prove the absence of malicious logic or vulnerabilities.

No Windows Authenticode signing or macOS notarization is provided by GitHub attestations. Windows download reputation/SmartScreen/Smart App Control, Linux FUSE/direct mounting, recipient hardware, physical audio/microphone and macOS distribution remain separate qualification work. The Linux CI path exercises the exact AppImage payload and launcher using extraction, so it does not pretend to certify every recipient's FUSE setup.

These builds are source-traceable, **not claimed byte-for-byte reproducible across independent builds**. Runtime manifests contain build times; npm SBOMs and package tools can contain timestamps/identifiers. The exact already-built files are retained and published without rebuilding.

The npm SBOM describes the committed npm dependency tree, including build dependencies. It is not an exhaustive inventory of external Electron/Node/native binaries. Runtime manifests and original notices supplement that scope; shipping an npm-only SBOM does not claim complete native coverage.

## Sources

[Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases), [enable immutability](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes), [release verification](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity), [Actions attestations and availability](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations), [official attest action](https://github.com/actions/attest), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets), [npm SBOM](https://docs.npmjs.com/cli/v11/commands/npm-sbom/), [Microsoft signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).
