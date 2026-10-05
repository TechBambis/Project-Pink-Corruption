# Project Pink Corruption 🦌💕

*Pink. A voice. A spiral. A space of your own.*

There you are. Welcome to **Project Pink Corruption**. ♡

A local companion for the hypnosis scene and the community around it. For listeners, creators, and people who like to build. **Bambi Local** is the runtime inside: chat, your own media, synchronized voice, visuals and sound.

Choose a voice. Set the pace. Make the session yours.

The app has its own TypeScript server, browser UI and local storage. It uses pinned prompts, triggers, guides and presets from [js-bambisleep-chat STABLE-2.0](https://github.com/HarleyVader/js-bambisleep-chat/tree/STABLE-2.0) by [HarleyVader](https://github.com/HarleyVader). The original work keeps its credits. [Here's what comes from where](docs/STABLE_CONTENT.md).

## Bring something of your own ♡

An idea. A fix. A different way to do things.

Feedback, docs, small fixes and code contributions are welcome. This is a place for the wider scene to build together.

Come say hi in [Discussions](https://github.com/TechBambis/Project-Pink-Corruption/discussions). Share bugs or ideas in [Issues](https://github.com/TechBambis/Project-Pink-Corruption/issues). Before contributing code, read [CONTRIBUTING.md](CONTRIBUTING.md).

## First, the essentials

Native setup currently targets **Fedora/Linux x64**. Windows and Apple Silicon macOS installation, startup and shutdown have not been verified yet. A successful web build doesn't establish that local AI and audio work on those platforms.

You'll need **Node.js 22.13+** and npm for the app. Local AI and speech services have their own setup below. The checkout includes source and runtime assets. Model weights, installed environments, private recordings and credentials stay outside Git.

## Start here

From the repository root:

```sh
npm run setup
npm start
```

Open **http://127.0.0.1:6969/setup** to see what's ready.

| space | where to find it |
| --- | --- |
| companion | [http://127.0.0.1:6969/](http://127.0.0.1:6969/) |
| Session Studio | [http://127.0.0.1:6969/studio](http://127.0.0.1:6969/studio) |
| Voice Lab | [http://127.0.0.1:6969/voice-lab](http://127.0.0.1:6969/voice-lab) |

Media and timelines can work before you add an AI model. Chat needs an available local model or your own cloud endpoint. Voice needs **Kokoro**. Microphone transcription needs **Whisper**.

## Give it a voice · Linux

These commands download dependencies and model files. Give them time and disk space. Set up the services you want to use.

Before native setup, install uv, Python 3, curl, Git, ripgrep, tar/zstd and checksum utilities. Vulkan/Whisper compilation has additional Linux build requirements.

```sh
./scripts/setup.sh                 # project-local Ollama and Kokoro setup
./scripts/setup-speech.sh          # optional whisper.cpp microphone recognition
./scripts/start.sh                # start owned local services and the app
./scripts/stop.sh                 # stop owned services
./scripts/panic-stop.sh           # emergency stop
```

The initial Ollama setup provisions **Qwen3.5 4B**. Choose an installed model in the app. The configured native 9B default needs separate provisioning. For the pinned Hauhau Qwen/Gemma choices:

```sh
source scripts/env.sh
python3 scripts/setup-community-models.py qwen35
# Optional: python3 scripts/setup-community-models.py gemma4
```

Pick a model that fits your RAM/VRAM. The setup recommendation estimates memory needs. It doesn't mean the model has been loaded or performance tested on your machine. Revisions, hashes and licenses live in [community-models.json](docs/community-models.json). Other pinned native models have their own setup scripts and manifests.

For voices, presets and exports, follow the [local audio guide](docs/LOCAL_AUDIO.md). The [device guide](docs/DEVICES.md) covers the optional BLE bridge and its activation limits.

## Cloud text, if you want it

Bring your own server and credentials:

```sh
npm run setup -- --cloud
# Edit the ignored .env.cloud file, then restart the app:
npm start
```

Once the endpoint is ready, choose **Cydonia** in the app. API keys stay on your local server. Selected conversation context and memories are sent to your configured endpoint. Audio, media and SQLite storage remain local.

Setup doesn't create or pay for GPU resources. The [cloud guide](docs/CLOUD_COMPUTE.md) explains connection and optional remote provisioning. Close paid resources through your provider when you're finished.

## Set the scene ♡

- **Talk.** Type, or use the microphone after Whisper setup. Listen & adapt and immediate interruption are separate choices. Headphones are preferable when capture and playback overlap.
- **Bring your own media.** Play audio/video and import VTT captions or JSON timelines. Pause/Stop keeps the session under your control.
- **Shape the atmosphere.** Choose voices, trigger sounds, background audio and visuals. Public synthesized effects work without private recordings.
- **Choose what stays.** Manage preferences and conversation memories in **Memories**. A fresh chat keeps preferences. Clearing chat memories removes stored chat data.
- **Create in Studio.** Work with voice passages, preview captions/timelines, and import or export portable session packages. Session Studio doesn't render a video.
- **Activate devices yourself.** Connected-device control starts disarmed and needs explicit activation. Software tests don't establish physical behavior on every device.

## Firefox overlay

The extension source is included. Server access controls currently block its connections. A pairing flow and further verification are needed before enabling it for beta testers.

## Before you share a change

```sh
npm run repo:check
npm run check
npm test
npm run build
```

Git gets the app code, setup/lifecycle scripts, runtime assets, pinned model manifests, tests and license notices. Models, installed environments, credentials, recordings and internal reports stay on your machine.

## Documentation guide

Want to look beneath the pink? Start here.

- [ARCHITECTURE.md](ARCHITECTURE.md): modules, clocks, requests and service lifecycle.
- [VERSIONS.md](VERSIONS.md): pinned dependencies and runtimes.
- [LOCAL_SECURITY.md](docs/LOCAL_SECURITY.md): local service protections and remaining limits.
- [SECURITY.md](SECURITY.md): reporting a vulnerability during the private beta.
- [LOCAL_AUDIO.md](docs/LOCAL_AUDIO.md) and [LOCAL_AUDIO_LICENSES.md](docs/LOCAL_AUDIO_LICENSES.md): voices, audio setup and licensing.
- [CLOUD_COMPUTE.md](docs/CLOUD_COMPUTE.md): optional cloud connection and provisioning.
- [DEVICES.md](docs/DEVICES.md): optional BLE setup and controls.
- [STABLE_CONTENT.md](docs/STABLE_CONTENT.md): original sources, our changes and their credits.

## Sharing the pink ♡

Original project code is available under [AGPL-3.0-only](LICENSE), including commercial use under its terms. Separately negotiated commercial permissions may be available for rights controlled by the maintainer. See [LICENSING.md](LICENSING.md) for scope, third-party notices and contact, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code.

A private beta does not revoke the redistribution rights granted by the AGPL.

This is still a development beta. Real microphone quality, native platform setup, service recovery and connected hardware need their own checks. Repository/build checks don't establish model accuracy or a complete security audit.

Bring your ideas. Keep the credits. Make it yours. ♡
