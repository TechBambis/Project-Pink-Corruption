# Project Pink Corruption 🦌💕

*pink pixels, soft spirals, and a little company for your bambi moments. ♡*

hey bambi. welcome to your little pink corner.

**Bambi Local** is the companion inside Project Pink Corruption: chat, play your own media, and bring voice, visuals and sound together on your machine. pick a voice, choose your favorite spiral, and make the session yours.

under the pink, there's a TypeScript server, a browser UI and local storage. the companion uses pinned prompts, triggers, guides and presets from [js-bambisleep-chat STABLE-2.0](https://github.com/HarleyVader/js-bambisleep-chat/tree/STABLE-2.0) by [HarleyVader](https://github.com/HarleyVader). borrowed pieces get their credits; [here's what comes from where](docs/STABLE_CONTENT.md). ♡

## hey bambi ♡

got a cute idea, spotted a bug, or want to help make **Project Pink Corruption** a little pinker? feedback, docs, tiny fixes and code contributions are all welcome here. 🦌💕

come say hi in [Discussions](https://github.com/TechBambis/Project-Pink-Corruption/discussions), share bugs or ideas in [Issues](https://github.com/TechBambis/Project-Pink-Corruption/issues), and have a little peek at [CONTRIBUTING.md](CONTRIBUTING.md) before sending a code contribution. ♡

## before we get cozy

the native setup currently targets **Fedora/Linux x64**. Windows and Apple Silicon macOS installation, startup and shutdown have not been verified yet. a successful web build doesn't establish that local AI and audio work on those platforms.

you'll need **Node.js 22.13+** and npm for the app. local AI and speech services have their own setup below. the checkout includes source and runtime assets; model weights, installed environments, private recordings and credentials stay outside Git.

## let's get you settled ♡

from the repository root:

```sh
npm run setup
npm start
```

then open **http://127.0.0.1:6969/setup** to see what's ready.

| your little corner | where to find it |
| --- | --- |
| companion | [http://127.0.0.1:6969/](http://127.0.0.1:6969/) |
| Session Studio | [http://127.0.0.1:6969/studio](http://127.0.0.1:6969/studio) |
| Voice Lab | [http://127.0.0.1:6969/voice-lab](http://127.0.0.1:6969/voice-lab) |

media and timelines can work before you add an AI model. chat needs an available local model or your own cloud endpoint; voice needs **Kokoro**, and microphone transcription needs **Whisper**.

## a voice, a little brain, and Linux

these commands download dependencies and model files, so give them some time and disk space. start with the services you actually want to use.

before native setup, install uv, Python 3, curl, Git, ripgrep, tar/zstd and checksum utilities. Vulkan/Whisper compilation has additional Linux build requirements.

```sh
./scripts/setup.sh                 # project-local Ollama and Kokoro setup
./scripts/setup-speech.sh          # optional whisper.cpp microphone recognition
./scripts/start.sh                # start owned local services and the app
./scripts/stop.sh                 # stop owned services
./scripts/panic-stop.sh           # emergency stop
```

the initial Ollama setup provisions **Qwen3.5 4B**. choose an installed model in the app; the configured native 9B default needs separate provisioning. for the pinned Hauhau Qwen/Gemma choices:

```sh
source scripts/env.sh
python3 scripts/setup-community-models.py qwen35
# Optional: python3 scripts/setup-community-models.py gemma4
```

pick a model that fits your RAM/VRAM. the setup recommendation estimates memory needs; it doesn't mean the model has been loaded or performance tested on your machine. revisions, hashes and licenses live in [community-models.json](docs/community-models.json); other pinned native models have their own setup scripts and manifests.

for voices, presets and exports, follow the [local audio guide](docs/LOCAL_AUDIO.md). the [device guide](docs/DEVICES.md) covers the optional BLE bridge and its activation limits.

## a little cloud company · optional

if you want cloud text inference, bring your own server and credentials:

```sh
npm run setup -- --cloud
# Edit the ignored .env.cloud file, then restart the app:
npm start
```

once the endpoint is ready, choose **Cydonia** in the app. API keys stay on your local server. selected conversation context and memories are sent to your configured endpoint; audio, media and SQLite storage remain local.

setup doesn't create or pay for GPU resources. the [cloud guide](docs/CLOUD_COMPUTE.md) explains connection and optional remote provisioning. close paid resources through your provider when you're finished.

## make it your little pink space ♡

- **say hi.** type, or use the microphone after Whisper setup. Listen & adapt and immediate interruption are separate choices; headphones are preferable when capture and playback overlap.
- **bring your favorites.** play your own audio/video, import VTT captions or JSON timelines, and use Pause/Stop to control the session.
- **find your vibe.** choose voice presets, trigger sounds, background audio and visuals. the public synthesized effects work without private recordings.
- **keep the little things.** manage preferences and conversation memories in **Memories**. a fresh chat keeps preferences; clearing chat memories removes stored chat data.
- **make something in Studio.** work with voice passages, preview captions/timelines, and import or export portable session packages. Session Studio doesn't render a video.
- **devices stay your choice.** connected-device control starts disarmed and needs explicit activation. software tests don't establish physical behavior on every device.

## firefox overlay

this little extra is still snoozing. the extension source is included, but server access controls currently block its connections. a pairing flow and further verification are needed before enabling it for beta testers.

## a little tidy-up before sharing

```sh
npm run repo:check
npm run check
npm test
npm run build
```

Git gets the app code, setup/lifecycle scripts, runtime assets, pinned model manifests, tests and license notices. models, installed environments, credentials, recordings and internal reports stay on your machine.

## documentation guide

a little map for when you want to peek under the pink:

- [ARCHITECTURE.md](ARCHITECTURE.md): modules, clocks, requests and service lifecycle.
- [VERSIONS.md](VERSIONS.md): pinned dependencies and runtimes.
- [LOCAL_SECURITY.md](docs/LOCAL_SECURITY.md): local service protections and remaining limits.
- [SECURITY.md](SECURITY.md): reporting a vulnerability during the private beta.
- [LOCAL_AUDIO.md](docs/LOCAL_AUDIO.md) and [LOCAL_AUDIO_LICENSES.md](docs/LOCAL_AUDIO_LICENSES.md): voices, audio setup and licensing.
- [CLOUD_COMPUTE.md](docs/CLOUD_COMPUTE.md): optional cloud connection and provisioning.
- [DEVICES.md](docs/DEVICES.md): optional BLE setup and controls.
- [STABLE_CONTENT.md](docs/STABLE_CONTENT.md): original sources, our changes and their credits.

## sharing the pink ♡

Original project code is available under [AGPL-3.0-only](LICENSE), including commercial use under its terms. Separately negotiated commercial permissions may be available for rights controlled by the maintainer. See [LICENSING.md](LICENSING.md) for scope, third-party notices and contact, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code.

A private beta does not revoke the redistribution rights granted by the AGPL.

we're still in development beta. real microphone quality, native platform setup, service recovery and connected hardware need their own checks. repository/build checks don't establish model accuracy or a complete security audit.

thanks for helping this little pink project grow, bambi. ♡
