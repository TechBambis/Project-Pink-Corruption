# Release process

## Automatic Smoke releases

`vX.Y.Z`, `vX.Y.Z-beta.N`, `vX.Y.Z-rc.N` and `vX.Y.Z-smoke.N` run `.github/workflows/release.yml`. Branch pushes do not release packages. Alpha tags use the separate process below.

The pipeline checks the tagged commit, installs locked dependencies, runs application/security checks, builds Linux/Windows packages, tests the finished files, then hashes and publishes those exact bytes. It never replaces existing assets.

Before a private run, verify remaining account-wide Actions/storage allowance and enforced zero-spend controls; set `RELEASE_FREE_ALLOWANCE_CONFIRMED=true` only after checking. Use standard runners. Budget roughly 20–35 summed runner minutes for Smoke, with additional Windows allowance accounting. Enable repository release immutability.

```sh
git checkout main
git pull --ff-only
git status --short
# Choose a fresh tag matching package.json's base version.
git tag -a vX.Y.Z-beta.N -m "vX.Y.Z-beta.N"
git push origin vX.Y.Z-beta.N
```

Verify the authenticated account is **337824705** before writes. Optional SSH/GPG-signed tags use `git tag -s`.

## AI alpha releases

1. Commit/check the source; [build and qualify](DESKTOP_RELEASE.md) both native targets using a fresh version.
2. Compare application identities and verify unchanged package hashes. Retain matching source/notices and record pending hardware checks accurately.
3. Create the source tag and a draft prerelease. Attach one EXE, one AppImage, an optional technical/source ZIP and `SHA256SUMS`.
4. Verify uploaded digests and download the files back for checksum comparison. Publish last; confirm `immutable: true`.

Alpha source/packaging acceptance and Windows installer/speech acceptance permit accompanied tests. Full-model, offline and physical-device qualification remain separate gates. Identify local Linux builds as local; Windows CI results do not establish Linux build provenance.

## Downloads and verification

Users need only their platform's executable. The optional ZIP contains build metadata, source/notices, native records and a scoped npm SBOM.

```sh
gh release download TAG --repo TechBambis/Project-Pink-Corruption --dir bambi-release
cd bambi-release
sha256sum -c SHA256SUMS
```

For a single Windows download, compare `Get-FileHash FILE.exe -Algorithm SHA256` with its checksum entry. Private downloads require repository access.

Public automatic releases also enable GitHub build attestations:

```sh
gh attestation verify FILE --repo TechBambis/Project-Pink-Corruption
```

Private Free-plan builds skip those attestations. Immutable release attestations are separate. Checksums check integrity; signed provenance identifies the release/build source. Neither proves code safety or supplies OS publisher signing.

## Pipeline controls

Official actions are SHA-pinned. Build/test jobs have `contents: read`; attestation uses `id-token: write` and `attestations: write`; publication uses `contents: write`; temporary artifact cleanup uses `actions: write`. Write permissions stay outside build jobs.

Archive allowlists exclude credentials/user data. Transfers enforce storage limits, one-day retention and digest checks; successful current-run transfers are removed. npm installs use the committed lockfile; SBOMs cover npm build dependencies, while runtime manifests/notices cover external runtimes. Cached dependencies do not replace release binaries.

Packages are not claimed byte-for-byte reproducible across independent builds. Published payloads retain the exact tested bytes. Windows download reputation, Linux FUSE compatibility and physical hardware are tester checks.

[GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) · [Build attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
