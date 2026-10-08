# Architecture

The desktop shell runs the same localhost application as development: Vite/TypeScript UI, Node 22.13+ with Express, WebSocket and built-in SQLite. Python owns speech and optional Bluetooth services.

## Modules

| Path | Responsibility |
| --- | --- |
| [apps/web/src/](apps/web/src/) | UI, media transport, reply playback and controls |
| [apps/server/](apps/server/) | Local HTTP/WebSocket admission, service adapters and storage |
| [apps/desktop/](apps/desktop/) | Desktop shell and owned service lifecycle |
| [packages/ai/](packages/ai/), [content/](packages/content/) | Models, complete character prompts, context budgets and dialogue |
| [packages/runtime/](packages/runtime/) | Accelerator selection, preparation and fallback |
| [packages/session-director/](packages/session-director/), [timeline/](packages/timeline/) | Phases, narration, event schedules and transport |
| [packages/audio/](packages/audio/), [speech/](packages/speech/) | Mixer, capture, recognition, synthesis and word timing |
| [packages/visuals/](packages/visuals/) | Rendering and audio/phase reactions |
| [packages/storage/](packages/storage/), [media/](packages/media/), [knowledge/](packages/knowledge/) | SQLite, explicit media analysis and reference retrieval |
| [packages/devices/](packages/devices/) | Playback cues, caps, ownership and watchdogs |

## Timing and cancellation

The session scheduler reads `AudioContext.currentTime`; speech captions and cues use the estimated output clock. Before audio starts, both fall back to `performance.now()`. A timer continues transport when visual frames stall; transient effects over 150 ms late are dropped. Browser throttling can still delay background work.

User conversation leaves session time running. Pause freezes transport and zeros devices. Stop cancels generation, audio, cues and capture. Speech interruption discards unheard output while an active session's background and bounded patterns continue. Every reply has a client request ID and server reply ID; cancellation epochs reject late preparation, text and audio, including events arriving before `begin`.

The director owns phases, intensity and effects. The model supplies text and validated presentation cues. Narration waits for completed playback, the phase gap and pending listener input. Sentence synthesis overlaps generation and playback through a bounded acknowledgement queue. History retains the delivered excerpt after interruption.

## Models and conversation

Native chat ships llama.cpp CPU/Vulkan; other configured local models use Ollama. Kokoro and streaming recognition run on CPU. The shared accelerator controller reserves 1024 MiB GPU memory, checks full context and a one-token inference, then tries at most three eligible GPU paths and one CPU path. Failed workers are cleaned up and quarantined for the session. CPU mode skips GPU probes, caps threads at six and leaves two where possible. Worker crashes need explicit preparation; replies are never automatically replayed. Speech stays on CPU because an isolated RX 6600 XT WebGPU trial was slower (896 vs 1429 ms on its second synthesis) and changed audio duration (2.944 vs 3.725 seconds). That fixture failed output equivalence; it is not a general GPU benchmark.

Preparation checks the complete selected character, enabled collar/strategy and response reserve. Per-request planning retains mandatory instructions, complete recent exchanges and bounded memory; it removes optional history before rejecting an oversized request. Native/cloud tokenizers count the actual template; Ollama uses estimates. Defaults live in [models.ts](packages/ai/models.ts) and [sampling.ts](config/sampling.ts). Native 9B uses a 2048 MiB prompt-cache cap and puts changing application context after the fixed system prefix so recurrent state can be reused.

Local llama.cpp/Ollama share one inference slot; cloud generation/listening share another. Credentials stay server-side. Individual HTTP streams are aborted before releasing their slot. See [model setup](docs/MODEL_SETUP.md) and [cloud setup](docs/CLOUD_COMPUTE.md).

**Conversation style → Situational** is the default; Classic keeps continuous authored narration. Situational chooses `respond`, `ask`, `guide` or `close` through a stripped `[turn:...]` header. Without a recognized header, a completely delivered ending question opens a reply window. Explicit actions override that heuristic. Unheard/interrupted questions cannot open it. Engine continuations are not listener statements; fictional memories cannot count as actual consent or confirmed preferences. New chat resets temporary turn state. Character and turn rules live in [character.ts](packages/ai/character.ts), [interaction.ts](packages/content/interaction.ts) and [voice.ts](packages/content/voice.ts).

## Audio, storage and output

[Local audio](docs/LOCAL_AUDIO.md) covers Kokoro, voice blending and recognition. AudioWorklet capture and worker VAD feed local Whisper or a server-owned streaming recognizer. Provisional transcripts are status only; one final result becomes input. The mixer separates session, speech, ambience, effects and microphone monitor; speech ducks session audio.

SQLite stores preferences, sessions, conversations and media metadata. Memory retrieval uses FTS5 and optional pinned CPU embeddings, scoped by profile/model, selecting up to eight confirmed preferences and four older excerpts. Confirmed revisions remain authoritative. Forget/clear invalidates caches and late indexing; fresh chat keeps saved memories. Setup: `npm run setup:memory`, pins: [memory-model.json](config/memory-model.json).

Media bytes use browser object URLs and must be reselected after reload. Explicit analysis uses loopback ffmpeg/Whisper and caches results in `runtime/media-analysis/`. [Device commands](docs/DEVICES.md) originate from actual playback, require separate arming and stop on watchdog expiry. Studio validates versioned packages with embedded audio hashes; imports cannot execute code or activate devices.

Rendering is capped at 60 Hz, 30 Hz during AI work and 1920 × 1080 backing pixels, with adaptive resolution. Reduced motion freezes the spiral and disables flashes/strobe. The Firefox overlay requires admission/pairing work; it strips device metadata and never arms devices.

## Pins and checks

| Dependency group | Authoritative configuration |
| --- | --- |
| Node packages | [package.json](package.json), [package-lock.json](package-lock.json) |
| Speech runtime and weights | [requirements.lock](packages/speech/local/requirements.lock), [models.json](packages/speech/local/models.json) |
| Streaming recognition | [streaming-speech-model.json](config/streaming-speech-model.json), [setup helper](scripts/setup-streaming-speech.py) |
| Bluetooth | [requirements.lock](packages/devices/requirements.lock) |
| Chat models | [catalog](docs/community-models.json), [Qwen](docs/qwen36-model.json), [comparison models](docs/comparison-models.json) |
| Cloud runtime | [build helper](scripts/cloud/build-llama.sh), [model](docs/cydonia-cloud-model.json), [profiles](docs/cydonia-server-profiles.json) |
| Upstream content | [manifest](packages/content/stable-2.0/manifest.json), [provenance](docs/STABLE_CONTENT.md) |

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and setup. Browser fixtures use simulated AI/audio; native models, drivers and physical devices need separate qualification. `node scripts/dialogue-server-check.mjs` checks conversation delivery; `npm run eval:conversation -- --run` explicitly calls the selected model. Real speech acceleration and Apple Silicon packaging remain future qualification work.
