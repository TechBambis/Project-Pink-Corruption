# Development & contributing

Use English. Keep credentials, models, recordings, conversations and runtime data out of Git. Preserve upstream credits and pinned source bytes.

## Local setup

Node.js 22.13+ and npm:

```sh
npm ci --ignore-scripts
npm run setup
npm start
```

The app runs at `http://127.0.0.1:6969`; `/setup`, `/studio` and `/voice-lab` open the other pages. Media playback works without AI.

For native Linux AI and speech, install uv, Python 3, curl, Git, ripgrep and tar/zstd, then:

```sh
./scripts/setup.sh
./scripts/start.sh
./scripts/stop.sh
# Emergency stop: ./scripts/panic-stop.sh
```

The initial Ollama setup installs Qwen3.5 4B. Native 9B provisioning is separate: `python3 scripts/setup-community-models.py qwen35` after loading `scripts/env.sh`. Optional memory: `npm run setup:memory`. Optional recognition: `npm run setup:streaming-speech` or `./scripts/setup-speech.sh` for Whisper. These setup commands download dependencies/model data.

## Checks

```sh
npm run repo:check
npm run check
npm test
npm run build
```

For UI behavior, use `npm run test:integration`, `npm run test:navigation`, `npm run test:model-setup` or `npm run test:settings` as appropriate. Install Chromium with `npx playwright install chromium`, or set `BAMBI_BROWSER_BINARY`. Browser fixtures use simulated AI/audio; native packaging and real hardware checks are separate.

## Guides

| Task | Guide |
| --- | --- |
| Understand modules and timing | [Architecture](ARCHITECTURE.md), [runtime versions](VERSIONS.md) |
| Models and permissions | [Model setup](docs/MODEL_SETUP.md), [Privacy & access](docs/PRIVACY_ACCESS.md) |
| Voice, delivery and recognition | [Local audio](docs/LOCAL_AUDIO.md), [streaming speech](docs/STREAMING_SPEECH.md) |
| Settings files | [Settings & presets](docs/SETTINGS_BACKUP.md) |
| Devices | [Device setup](docs/DEVICES.md) |
| Cloud endpoints | [Cloud setup](docs/CLOUD_COMPUTE.md) |
| BambiCloud playback | [BambiCloud](docs/BAMBICLOUD.md) |
| Conversation behavior | [Situational conversation](docs/SITUATIONAL_CONVERSATION.md) |
| Packages and publication | [Desktop builds](docs/DESKTOP_RELEASE.md), [release process](docs/RELEASE-SECURITY.md) |
| Security and credits | [Local security](docs/LOCAL_SECURITY.md), [upstream content](docs/STABLE_CONTENT.md), [licenses](LICENSING.md) |

The Firefox extension needs pairing before its blocked connections can be enabled. Studio drafts need exporting before closing. Report security issues through [SECURITY.md](SECURITY.md).

## Code submissions

Bug reports need no CLA. Code contributions need explicit [CLA](CLA.md) acceptance or separately verified equivalent permissions before merging. A PR alone is not acceptance. The CLA allows commercial relicensing without royalties; contributors retain copyright. Identify employers, coauthors and copied material where applicable.

Maintainer verification uses the current CLA hash and exact PR head. Preserve assent/rights evidence privately, then post as account **337824705**:

```text
CLA-VERIFIED v1 sha256=<CLA SHA-256> head=<full PR head SHA>
```

A changed head or CLA needs re-verification. Require application checks, secret scanning and `cla/verified` before merging. On private GitHub Free, the maintainer checks these manually because branch-protection enforcement is unavailable.
