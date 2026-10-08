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

Media and timelines can work before you add an AI model. Chat needs an available local model or your own cloud endpoint. Voice needs **Kokoro**. Microphone transcription needs **local streaming speech or Whisper**.

## Give it a voice · Linux

These commands download dependencies and model files. Give them time and disk space. Set up the services you want to use.

Before native setup, install uv, Python 3, curl, Git, ripgrep, tar/zstd and checksum utilities. Vulkan/Whisper compilation has additional Linux build requirements.

```sh
./scripts/setup.sh                 # project-local Ollama and Kokoro setup
./scripts/setup-speech.sh          # optional whisper.cpp microphone recognition
npm run setup:streaming-speech     # optional English streaming recognition on CPU
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

First use asks which optional features may access the microphone, devices or online services. Every optional permission starts off. Reopen **Extras → Privacy & access** to change them. Date/time and an explicit approximate IP-location lookup can provide session context, with separate permission for sharing that context with cloud AI. See [Privacy & access](docs/PRIVACY_ACCESS.md) and [Local model setup](docs/MODEL_SETUP.md).

AI preparation loads the selected model, checks complete conversation and enabled narration prompts against its context budget, processes the full fixed instructions and checks voice when enabled. Native/cloud tokenizers provide exact counts when available; Ollama uses an explicitly estimated budget. Incompatible settings fail before warmup generation without shortening the authored prompt. A first start can take longer. If preparation fails, automatic retries pause for those settings; **Start** retries. A verified project-owned runner on port 8080 is reused. If another application owns that port, stop it through its own controls before retrying. Local model diagnostics are in `runtime/llama.log`.

For voices, presets and exports, follow the [local audio guide](docs/LOCAL_AUDIO.md). The [device guide](docs/DEVICES.md) covers the optional BLE bridge and its activation limits.

## Remember across different wording

Optional local memory search finds relevant older conversations by meaning, even when your question uses different words:

```sh
npm run setup:memory
# Restart the app after updating its code.
npm run eval:memory                # seven synthetic retrieval checks, no chat model
```

Setup downloads about 135 MB of pinned, checksum-verified model files. The Apache-2.0 [multilingual MiniLM model](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) runs on the CPU in a separate worker. Embedding inference stays on this machine; without the model, word search continues to work. Clearing memories removes the profile's stored conversation data and embedding cache. Forgetting a preference removes its revisions and excludes their source passages from future memory search; those passages remain in the transcript until memories are cleared.

## Cloud text, if you want it

Bring your own server and credentials:

```sh
npm run setup -- --cloud
# Edit the ignored .env.cloud file, then restart the app:
npm start
```

Once the endpoint is ready, choose **your configured remote model** in the app. API keys stay on your local server. Selected conversation context and memories are sent to your configured endpoint. Audio, media and SQLite storage remain local.

Setup doesn't create or pay for GPU resources. The [cloud guide](docs/CLOUD_COMPUTE.md) explains connection and optional remote provisioning. Close paid resources through your provider when you're finished.

## Set the scene ♡

- **Talk.** The player has one message field and microphone. The empty field shows recognized microphone words and the latest reply, including engine event narration. Streaming recognition shows provisional words without storing them as conversation history; Whisper shows its completed recognition. Spoken replies appear word by word on the same output clock as captions, regardless of whether captions are visible. Text-only replies still stream immediately. Typing keeps your draft separate from incoming text. Enter sends, Shift Enter adds a line. Yellow status covers AI preparation and narration generation; a muted microphone icon stays red independently. Microphone recognition and headphones/speakers are configured in **Voice & AI** after streaming/Whisper setup. Listen & adapt and immediate interruption are separate choices.
- **Use the player.** Its fullscreen icon enters or exits fullscreen; **F** does the same. **Space** pauses or resumes. These shortcuts leave message inputs and settings fields available for typing. The controls follow hover and pointer movement, independently of AI activity.
- **Bring your own media.** Play audio/video and import VTT captions or JSON timelines. Plain file playback uses Play/Pause. An **End session** icon appears during preparation or when AI, microphone capture or device control is active. It stops all live work and keeps the conversation and settings. Natural session or playlist completion also releases capture and device output.
- **Play BambiCloud sessions.** Import a public playlist in Your files. Finished recordings play in full, without added AI narration; optional source-timed trigger text and visuals follow the recording. [Details and limits](docs/BAMBICLOUD.md).
- **Shape the atmosphere.** Choose voices, trigger sounds, background audio and visuals. Spirals follow the browser’s display cadence, with alternate refreshes during AI work and a stable WebGL resolution within a 1440p pixel budget. Pixel-aware shader edges preserve detail; scene changes blend briefly on the session clock, while blanks and seeking cut immediately. Public synthesized effects work without private recordings.
- **Vary narration delivery.** Adaptive narration gives engine-selected passages different speech speeds, phrase gaps and background levels. Optional adaptive session direction adds recurring ring/heart/gear motifs, contrast, repeated anchors and staged returns inside the five existing phases. Your voice speed remains the base setting; finished file audio is unchanged. [Controls and timing](docs/ADAPTIVE_DELIVERY.md).
- **Add a second voice.** Enable **Voice & AI → Voice blend & persona → Dual Voice** for a softer Bambi voice in generated guided passages. It speaks in the main voice’s pauses and grows more present through the session. [Settings and script format](docs/DUAL_VOICE.md).
- **Choose what stays.** **Voice & AI → Conversation & memories** contains **Memories** and **New conversation**. A new conversation resets the current context, retaining saved preferences and searchable earlier chats. Clearing chat memories removes stored chat data.
- **Follow the conversation.** The default **Situational** conversation style chooses between answering, asking one relevant question and continuing a short passage. A fully played question leaves room for your answer; your actual words shape the next contribution. Choose **Classic** in **Voice & AI → Conversation & memories** for the previous reply/narration behavior. [Behavior and implementation](docs/SITUATIONAL_CONVERSATION.md).
- **Use Anubis Mini.** Its installed Q4_K_M weights can be reused by the native Vulkan runner with a 64K context window. Situational conversation retains the complete chosen character prompt. [Setup, context and measured limits](docs/ANUBIS_RUNTIME.md).
- **Create in Studio.** Work with voice passages, preview captions/timelines, and import or export portable session packages. Session Studio doesn't render a video.
- **Activate devices yourself.** Connected-device control starts disarmed and needs explicit activation. Software tests don't establish physical behavior on every device.

## Linux desktop packaging smoke

`npm run desktop:build` produces a local Linux x64 AppImage and tar.gz fallback with a bundled Node backend and an offline sample. AI, speech and device integration remain later milestones. See [the smoke-build guide](docs/DESKTOP_SMOKE.md) for build, isolated startup, controls, source and verification instructions. This command does not upload or publish.

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
- [STREAMING_SPEECH.md](docs/STREAMING_SPEECH.md): local streaming recognition, Whisper fallback and browser verification.
- [CLOUD_COMPUTE.md](docs/CLOUD_COMPUTE.md): optional cloud connection and provisioning.
- [DEVICES.md](docs/DEVICES.md): optional BLE setup and controls.
- [STABLE_CONTENT.md](docs/STABLE_CONTENT.md): original sources, our changes and their credits.

## Sharing the pink ♡

Original project code is available under [AGPL-3.0-only](LICENSE), including commercial use under its terms. Separately negotiated commercial permissions may be available for rights controlled by the maintainer. See [LICENSING.md](LICENSING.md) for scope, third-party notices and contact, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code.

A private beta does not revoke the redistribution rights granted by the AGPL.

This is still a development beta. Real microphone quality, native platform setup, service recovery and connected hardware need their own checks. Repository/build checks don't establish model accuracy or a complete security audit.

Bring your ideas. Keep the credits. Make it yours. ♡

## Verified tag releases

The automatic tag workflow builds and qualifies Linux x64 and Windows x64 smoke packages together, verifies the exact final bytes, and publishes them only after all required checks pass. See [release security and maintainer setup](docs/RELEASE-SECURITY.md) for private free-tier setup, immutable releases, provenance verification and the first beta tag. AI alphas remain a separate qualification scope.
