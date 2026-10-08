# Shared native desktop releases

The release controller freezes the current reviewed application source before a native build. Linux and Windows use the same source allowlist and feature requirements in `config/desktop-release.json`. Application identity ignores Git checkout line endings; the separate source inventory still records the exact distributed bytes. Original third-party notices are copied unchanged.

An artifact is bound to its version, application identity, native runtime and tested package hashes. A build is `built-unqualified` until the required gates pass. Speech acceptance alone does not certify local conversation, offline use, physical audio or installation on a recipient's computer. macOS arm64 is explicitly `not-implemented`.

## Prepare once, build natively

Use a new immutable version and a fresh directory outside the repository. No command here publishes packages or starts paid remote jobs.

```sh
npm run desktop:release -- prepare smoke 0.1.0-smoke.3 /absolute/private/release-smoke-3
```

The output contains `source/`, a source archive, `SHA256SUMS` and an initial `RELEASE-STATUS.json`. For an alpha, use `prepare alpha 0.1.0-alpha.8 ...` instead. Choose a new version when the reviewed source changes. Distribute the same prepared source archive to each build host rather than preparing again from an edited checkout.

On each native x64 host, install locked build dependencies inside the extracted source:

```sh
cd /absolute/private/release-smoke-3/source
npm ci --ignore-scripts
node scripts/desktop-release.mjs check .
node scripts/desktop-release.mjs build . linux-x64
node scripts/desktop-release.mjs qualify . linux-x64 dist/desktop/0.1.0-smoke.3
node scripts/desktop-release.mjs status . dist/desktop/0.1.0-smoke.3
```

On Windows, select `windows-x64` and use `dist/desktop-windows/VERSION` as the output directory. The qualifier runs installed NSIS acceptance and, for alpha, the installed speech checks. Each Windows run gets a fresh evidence directory. Linux qualification extracts the finished tar package into a fresh temporary directory outside the source snapshot; received-download/AppImage behavior remains a separate recipient test. A Linux alpha additionally needs the existing attended speech-freeze environment and reviewed runtime archives inside its snapshot; the smoke workflow does not create those prerequisites.

The controller rejects modified snapshot inputs, unsupported targets, concurrent release work, mismatched application identities and changed qualified package bytes. Do not remove an active `.runtime/desktop-release.lock`. A crashed process can leave a stale lock; verify its recorded PID is no longer running before removing it.

`check` records TypeScript and the full automated suite in `SOURCE-CHECKS.json`, bound to the exact source and native host. `build` runs these checks if no matching successful record exists. Failed source checks block a new build and remain a failed readiness gate even if packaging checks passed. A record from another host or source is not reused.

To compare target packages, copy their public output files into separate directories and supply both to `status`. Preserve `RUNTIME-MANIFEST.json`, `DESKTOP-QUALIFICATION.json` and every payload named by the qualification record. The report keeps missing and unperformed gates pending. It does not infer success from the presence of files.

## Native workflow

For a functional AI candidate, dispatch **Manual desktop release** (`desktop-release.yml`) with `phase=alpha`, a fresh `0.1.0-alpha.N` version, and `target=windows-x64`. Record the live free-tier allowance and enforced zero-spend budgets. Select both `upload_packages` and `transfer_packages` for the bounded private receiver route; keep the receiver running until it verifies every part. For Linux, use the same reviewed commit and version with the local frozen-source commands above and the pinned native freeze environment. Compare both runtime manifests' `release.applicationDigest` before handoff. These candidates keep unperformed reference gates pending.

An ordinary beta/stable tag still selects the Smoke route. AI alpha tags are rejected by tag preflight; they do not silently produce an AI package. Use the explicit alpha path above and retain its exact qualified bytes for the accompanied reference test.

`.github/workflows/desktop-release.yml` calls one reusable native workflow. The earlier Windows entry point uses the same workflow. Jobs remain manual, require an actual recorded allowance check and only upload packages when explicitly requested within the recorded storage allowance. Linux alpha CI is deliberately unavailable until its freeze prerequisites have a qualified native adapter. The workflow itself needs a new native execution before its generated packages can be handed to testers.

## Model ownership

For an explicitly requested Windows alpha upload, `transfer_packages` uses sequential private parts: verify and flush each received part locally before removing only that new temporary artifact. A fresh live storage check and the predecessor's receipt gate every subsequent upload. The matching source checks, qualification report, readiness report and notices travel with the installer. This does not change the full-model or physical-device qualification requirements.

`ServiceLifecycle` serializes service ownership. Concurrent requests for different models prepare in order; a ready instance of the requested model is reused. Stop invalidates active and already queued preparation. Canceled or failed starts are cleaned before the next request, and a dead resident service loses its ready state. Existing GPU selection, full-context checks, bounded child termination and CPU retry policy remain in the native adapter.

## Signed update foundation

The offline Ed25519 verifier rejects unknown keys, modified metadata, wrong targets/channels, expired validity intervals and non-increasing smoke/alpha revisions. The file verifier checks regular-file status, byte count and SHA-256. This is a verification foundation: there is no automatic update polling, download, installation, key provisioning, rotation or migration/rollback implementation yet. It does not provide Windows publisher signing or macOS signing/notarization.

Create a publisher key only in a fresh protected directory outside the repository, then sign the package from the shared pipeline:

```sh
npm run desktop:update -- create-key /absolute/private/publisher-keys
npm run desktop:update -- sign /absolute/private/packages /absolute/private/publisher-keys/update-private.pem
```

Signing produces `SIGNED-UPDATE.json` without uploading or installing anything. Keep the private key private and backed up. The client must eventually receive its trusted public keys through a reviewed release; a public key delivered alongside an untrusted update does not establish trust. The current tool supports Linux x64 AppImage and Windows x64 NSIS smoke/alpha packages only.

## Experimental private turn grammar

`BAMBI_SITUATIONAL_GRAMMAR=1` opts into the llama.cpp action-header grammar for situational interaction. It constrains only the first streaming batch to a permitted private action, with `close` reserved for the session's closing passage. The body remains free text and assistant-prefill continuations do not start a second header. Unsupported backends and the default configuration retain the tolerant header parser and delivered-question fallback. No additional planning request is made.

The request wiring and continuation boundary have automated tests. The experiment remains off until the exact bundled runtime/model has passed grammar acceptance, streaming/closing checks and a measured latency comparison. Format validity does not establish a sensible choice of action or higher conversation quality.

## Verified tag releases

The automatic tag workflow builds and qualifies Linux x64 and Windows x64 smoke packages together, verifies the exact final bytes, and publishes them only after all required checks pass. See [release security and maintainer setup](RELEASE-SECURITY.md) for private free-tier setup, immutable releases, provenance verification and the first beta tag. AI alphas remain a separate qualification scope.

## Accompanied AI alpha publication

Tags ending in `-alpha.N` are excluded from the automatic Smoke workflow. They identify the exact source of separately prepared native AI candidates; a tag by itself does not build or qualify AI. See [the alpha download guide](AI_ALPHA_TESTING.md).

Build Linux locally using the pinned native speech-freeze environment and Windows using the manual native workflow. Run source and native acceptance, and keep each qualification bound to the exact final package hashes. Before publishing an accompanied alpha, validate the shared application identity and unchanged tested payloads, inspect corresponding-source/notices archives, and package supplementary evidence separately. Upload the exact existing AppImage and EXE to a draft prerelease, download them back and verify every SHA-256/size and the tag's full source commit before publishing. Never rebuild after these checks or replace an old version's assets.

The alpha's minimum accompanied-test evidence is source and packaging acceptance on both targets plus installed Windows speech/installer acceptance. Full-model, offline and physical-device results remain individually reported. Do not mark the strict readiness report qualified while any required gate is pending. Linux locally produced artifacts are described as local native builds; neither CI checks nor Windows build evidence imply GitHub-hosted Linux provenance. This private Free repository has no GitHub Artifact Attestations for these candidates. Checksums and matching source provide traceability, not publisher signing or a code-security audit.
