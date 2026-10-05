# Bambi Local

A local Bambi companion for chatting, playing your own media and running synchronized voice, visuals and sound. Pink on the outside, quite a bit of timing machinery underneath 🦌💕

Bambi Local has its own TypeScript server, browser UI and local storage. It uses pinned prompts, triggers, guides and presets from [js-bambisleep-chat STABLE-2.0](https://github.com/HarleyVader/js-bambisleep-chat/tree/STABLE-2.0) by [HarleyVader](https://github.com/HarleyVader); see [source provenance](docs/STABLE_CONTENT.md).

## Joining the private beta

This is the application code for **Project Pink Corruption**. After receiving repository access, clone the repository and follow the application setup below. Only run native provisioning on the documented Linux environment; Windows and macOS testers should wait for a verified platform setup.

Keep your checkout up to date with `git pull --ff-only`. Use **Issues → Beta bug report** for problems and include the tested commit (`git rev-parse --short HEAD`), platform and reproduction steps. Remove private data from logs and screenshots. Bug reports and suggestions do not need a CLA; code contributions follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Current platform support

The native setup currently targets the documented Fedora/Linux x64 environment. Windows and Apple Silicon macOS installation and service lifecycle have not been verified. The web frontend building successfully does not establish native AI/audio support on those platforms.

You need Node.js **22.13+** and npm for the application. Native local services need their separate setup below. The source checkout contains no model weights, installed environments, private recordings or credentials.

## Application setup

From the repository root:

```sh
npm run setup
npm start
```

Open **http://127.0.0.1:6969/setup** for readiness, **/** for the companion, **/studio** for Session Studio and **/voice-lab** for local voice rendering.

Media and timelines can work without an AI model. For chat, select an available local model or configure your own cloud endpoint. Voice needs Kokoro; microphone transcription needs Whisper.

## Local services on Linux

These setup commands explicitly download dependencies/model files and may take time and disk space. Run the services you need:

Install uv, Python 3, curl, Git, ripgrep, tar/zstd and checksum utilities before native provisioning. Vulkan/Whisper compilation has additional Linux build requirements.

```sh
./scripts/setup.sh                 # project-local Ollama and Kokoro setup
./scripts/setup-speech.sh          # optional whisper.cpp microphone recognition
./scripts/start.sh                # start owned local services and the app
./scripts/stop.sh                 # stop owned services
./scripts/panic-stop.sh           # emergency stop
```

The initial Ollama setup provisions Qwen3.5 4B. Choose an installed model in the app; the configured native 9B default needs separate provisioning. To import the pinned Hauhau Qwen/Gemma choices:

```sh
source scripts/env.sh
python3 scripts/setup-community-models.py qwen35
# Optional: python3 scripts/setup-community-models.py gemma4
```

Model revisions, hashes and licenses are recorded in [community-models.json](docs/community-models.json). Additional pinned native models have separate setup scripts and manifests. Choose according to available RAM/VRAM; the setup recommendation is a memory estimate, not a successful load or performance test.

See [local audio setup](docs/LOCAL_AUDIO.md) for Kokoro, presets and voice exports. [Device setup](docs/DEVICES.md) covers the optional BLE bridge and its activation limits.

## Optional cloud text inference

Use your own server and credentials:

```sh
npm run setup -- --cloud
# Edit the ignored .env.cloud file, then restart the app:
npm start
```

Choose Cydonia in the app after the endpoint is ready. API keys stay on the local server. Selected conversation context and memories are sent to that configured endpoint; audio, media and SQLite storage remain local. Setup does not create or pay for GPU resources.

[Cloud setup](docs/CLOUD_COMPUTE.md) describes the connection and optional remote provisioning. Close paid resources through your provider when finished.

## Using the companion

- Chat by typing or using the microphone after Whisper setup. Listen & adapt and immediate interruption are separate choices; headphones are preferable for overlapping capture and playback.
- Play your own audio/video, import VTT captions or JSON timelines, and use Pause/Stop to control the session.
- Choose voice presets, trigger sounds, background audio and visuals. Public synthesized effects work without private recordings.
- Manage stored preferences and conversation memories in **Memories**. A fresh chat retains preferences; clearing chat memories removes stored chat data.
- Use **Session Studio** for voice passages, caption/timeline preview and portable package import/export. It does not render a video.
- Connected-device control starts disarmed and needs explicit activation. Software tests do not establish physical behavior on every device.

## Firefox overlay

The extension source is retained, but server access controls currently block extension connections. A pairing flow and further verification are required before enabling it for beta testers.

## Checks and repository contents

```sh
npm run repo:check
npm run check
npm test
npm run build
```

The repository contains application code, setup/lifecycle scripts, runtime assets, pinned model manifests, tests and license notices. Models, installed environments, credentials, recordings and internal reports stay outside Git.

## Documentation guide

- [ARCHITECTURE.md](ARCHITECTURE.md): application modules, clocks, requests and service lifecycle.
- [VERSIONS.md](VERSIONS.md): dependency and runtime pins.
- [LOCAL_SECURITY.md](docs/LOCAL_SECURITY.md): loopback admission, service credentials and remaining limits.
- [SECURITY.md](SECURITY.md): how to report a vulnerability during the private beta.
- [LOCAL_AUDIO.md](docs/LOCAL_AUDIO.md) and [LOCAL_AUDIO_LICENSES.md](docs/LOCAL_AUDIO_LICENSES.md): audio setup, voice tools and licensing.
- [CLOUD_COMPUTE.md](docs/CLOUD_COMPUTE.md): optional cloud connection and provisioning.
- [DEVICES.md](docs/DEVICES.md): optional BLE setup and controls.
- [STABLE_CONTENT.md](docs/STABLE_CONTENT.md): upstream content, local modifications and attribution.

## License and beta scope

Original project code is available under [AGPL-3.0-only](LICENSE), including commercial use under its terms. Separately negotiated commercial permissions may be available for rights controlled by the maintainer. See [LICENSING.md](LICENSING.md) for scope, third-party notices and contact, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code.

A private beta does not revoke the redistribution rights granted by the AGPL.

This is a development beta. Real microphone quality, native platform setup, service recovery and connected hardware need their own checks. Repository/build checks do not establish model accuracy or a complete security audit.
