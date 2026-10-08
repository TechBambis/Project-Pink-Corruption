# Desktop builds

Linux and Windows x64 share `scripts/desktop-release.mjs`, the source allowlist and `config/desktop-release.json`. **Smoke** packages test the shell/player; **alpha** packages add local AI and speech. macOS/ARM packaging is not implemented.

## Frozen source

Choose a fresh version and directory outside the checkout:

```sh
npm run desktop:release -- prepare alpha 0.1.0-alpha.N /absolute/private/release
cd /absolute/private/release/source
npm ci --ignore-scripts
node scripts/desktop-release.mjs check .
```

Use `smoke 0.1.0-smoke.N` for Smoke. Distribute the prepared source to each native build host. Do not edit the snapshot or reuse a version output. Canonical application identity normalizes checkout line endings; source digests retain exact bytes.

## Linux x64

For alpha, create `.runtime/alpha-freeze-env` with CPython 3.12.13, install `packages/speech/desktop-build.lock`, and supply the pinned Ollama 0.35.1 archive as `.runtime/ollama.tar.zst`. The builder verifies its checksum and freezes speech anew. Smoke needs no speech environment.

```sh
node scripts/desktop-release.mjs build . linux-x64
node scripts/desktop-release.mjs qualify . linux-x64 dist/desktop/0.1.0-alpha.N
```

Output: AppImage, tar fallback, matching source, runtime manifest and checksums. Qualification extracts the final AppImage and tests its launcher; recipient FUSE behavior remains separate. [Running the app](AI_ALPHA_TESTING.md).

## Windows x64

On native Windows, the bootstrap acquires pinned build tools without global installation:

```bat
scripts\desktop-windows-build.cmd alpha 0.1.0-alpha.N
```

Prefer the shared frozen-source controller when Node is available:

```sh
node scripts/desktop-release.mjs build . windows-x64
node scripts/desktop-release.mjs qualify . windows-x64 dist/desktop-windows/0.1.0-alpha.N
```

Alpha freezes the locked native speech environment and bundles the pinned llama runtime. Allow at least 6 GiB for build files, plus model-test data. Qualification tests the actual per-user NSIS installer, speech, reinstall/persistence, controls and owned-process cleanup. Tests run with an empty PATH and isolated profiles. Testers need no build tools.

For actual model tests, run `desktop-windows-ai-check.mjs EXE MODEL_DATA` using the bundled/build Node, then repeat with `--cpu`. Preserve full prompts and 24,576-token reference context. Check actual offloaded layers, not just detected GPU names. Physical audio and Windows 11 recipient behavior require observations.

## CI and evidence

**Manual desktop release** runs the Windows native workflow; Linux alpha currently uses an attended local build. Before private CI, verify account **337824705**, actual free allowance, storage and zero-spend controls. Use `upload_packages` within the recorded allowance; `transfer_packages` is the optional sequential-part receiver route.

Compare both targets with `node scripts/desktop-release.mjs status SOURCE TARGET_OUTPUT...`. Keep runtime/source manifests, qualification records and their unchanged payloads. Source checks are bound to source/version/host. A build with missing required gates stays `built-unqualified`; test results from older packages are not reused.

The controller rejects changed snapshots, mismatched package hashes and concurrent release work. Remove a stale lock only after its recorded process has stopped. Runtime ownership cleans only the app's processes; occupied ports and unrelated profiles are retained.

[Publication and verification](RELEASE-SECURITY.md).

## Optional update signing

`desktop:update` provides offline Ed25519 manifest/file verification for Linux/Windows Smoke and alpha packages. Automatic update delivery and trusted-key provisioning are not implemented.

```sh
npm run desktop:update -- create-key /absolute/private/keys
npm run desktop:update -- sign /absolute/private/packages /absolute/private/keys/update-private.pem
```

Keep keys outside Git. Clients need reviewed trusted keys; a key supplied by an untrusted update is insufficient.
