# Local companion architecture

Bambi Local is a local companion runtime using pinned [js-bambisleep-chat STABLE-2.0](https://github.com/HarleyVader/js-bambisleep-chat/tree/STABLE-2.0) content. It has its own UI, server, storage and process lifecycle. Reused prompts, triggers, guides and presets are recorded in [STABLE_CONTENT.md](docs/STABLE_CONTENT.md), including the explicit Classic prompt override and preserved upstream originals.

[apps/server/index.ts](apps/server/index.ts) serves a Vite-built HTML/CSS/TypeScript browser app and a localhost WebSocket. The backend uses Node 22.13+, Express 5, `ws` and Zod; persistence uses Node's built-in SQLite API. Shared TypeScript modules support the main app and the optional Firefox content overlay. Python provides the Kokoro service, provisioning utilities and optional BLE bridge.

## Components and data flow

```text
Local files / typed text / microphone
                 |
Browser UI -> deterministic SessionDirector -> session TimelineScheduler
                 |              |                 |
            Local AI         WebAudio          WebGL + captions
          Ollama/llama         mixer               |
                 |              ^             audio clock
      incremental sentences     |
                 |         local Kokoro ONNX WAV + phrase timings
        bounded TTS queue ------+

Unmute / Mute microphone toggle -> automatic VAD -> 16 kHz WAV in memory -> local whisper.cpp
```

| Component | Responsibility |
| --- | --- |
| [apps/web/src/main.ts](apps/web/src/main.ts) | UI wiring, media transport, session and speech-playback clocks, streamed reply handling and explicit Pause/Stop. |
| [packages/session-director/](packages/session-director/) and [timeline/](packages/timeline/) | Session state/intensity, phase progression, narration scheduling and imported events. |
| [packages/ai/](packages/ai/) and [content/](packages/content/) | Backends, runtime prompts, token budgeting, inference scheduling and dialogue/listening policy. |
| [packages/speech/](packages/speech/) and [audio/](packages/audio/) | Capture/STT, speech chunks, WAV playback, mixer buses, effect timing and ducking. |
| [packages/visuals/](packages/visuals/) | Rendering, phase choreography and audio/trigger/breath reactions. |
| [packages/storage/](packages/storage/), [media/](packages/media/) and [knowledge/](packages/knowledge/) | Persistent metadata, explicit analysis and read-only reference retrieval. |
| [packages/devices/](packages/devices/) | Playback-triggered actuator commands, ownership, caps, bridge lifecycle and watchdogs. |

## Session and playback clocks

The main app maintains two scheduler instances. The session scheduler uses the AudioContext's monotonic `currentTime` after audio is initialized and drives transport, phases and media timeline events. The speech-playback scheduler uses `AudioEngine.outputTime` to align conversation captions and playback feedback with output timing. Both initially fall back to `performance.now()` before audio exists.

Typing, microphone capture, transcription and ordinary conversation do not freeze session time. Media, phase visuals, ticks and background audio continue while the companion replies; speech ducks their level. Explicit Pause suspends transport/audio and keeps event positions fixed. Seeking updates timeline and media position. Hard stop resets transport, stops sources, cancels requests, clears captions and exits fullscreen. Speech interruption instead discards unheard voice and future speech cues while retaining an active session's bounded patterns and background playback. The state is implemented in `packages/session-director/`.

Session stages and intensity curves are deterministic. The AI receives a validated snapshot of phase, time, intensity, selected scene and trigger metadata. It can supply validated presentation cues, but the app owns session timing and output limits. Continuous narration waits for completed playback and a phase-specific gap; pending user input blocks the next passage. Narration scheduling is implemented in `packages/session-director/narration.ts`.

## Inference and speech streaming

The server proxies loopback AI/speech endpoints and an optional server-configured cloud endpoint. Configured native Qwen models use llama.cpp; other local models use Ollama. Cydonia cloud inference uses a separate adapter with server-side credentials, bounded requests and cancellation. The browser receives connection capabilities but no upstream API key. See [CLOUD_COMPUTE.md](docs/CLOUD_COMPUTE.md). Thinking is disabled by default. The native 9B family has a configured 24,576-token context; the 35B family has 16,384. Requested output can be up to 8,192 tokens, but context budgeting reserves actual output space and a safety margin before generation. Native token counts use the loaded template/tokenizer; Ollama counts are explicitly estimates. Mandatory persona/input content is not silently truncated. Model/backend settings are in [packages/ai/models.ts](packages/ai/models.ts) and [config/sampling.ts](config/sampling.ts).

Runtime prompt construction retains the complete authored main document, strategy and enabled collar, removing only identical complete sections. Stable shared instructions precede per-request state and task guidance. Narration receives phase passage guidance; ordinary conversation prioritizes the latest task. Explicit request intent separates conversation from narration. A context plan considers up to 128 candidate messages, keeps complete recent exchanges, and reserves bounded capacity for confirmed preferences and relevant older episodes. The cloud path calibrates local estimates against the mandatory prompt and verifies the final request with the native tokenizer when supported.

Sentence synthesis overlaps token generation and playback. The acknowledgement window bounds pending sentences and lets a multi-chunk sentence finish. Native spoken generation yields after small sentence batches so prioritized listening decisions can run before continuation. Text-only and Ollama requests retain their ordinary stream. Playback reports let interrupted history retain the heard excerpt rather than all generated text. The production logic is in `packages/ai/` and `apps/web/src/concurrent-input.ts`.

Kokoro-82M ONNX runs in an owned Python CPU process on port 8882 with resident local weights, cached embeddings and a bounded phrase cache. Its phrase-aware renderer inserts explicit digital pauses and sends short WAV chunks over the existing protocol. Client captions use measured phrase durations and phoneme/PCM-derived word timings when available; the renderer does not invent word offsets. Speech-provider capabilities declare language, timing, blending and control support. The same renderer serves the local Voice Lab and CLI WAV export. The microphone path uses browser VAD, in-memory 16 kHz WAV capture and local whisper.cpp recognition.

## Visuals and audio

Visual rendering combines a full-screen layered shader (smooth spiral/tunnel, gradients, particles, vignette, audio response) with a smooth analytic two-arm classic spiral. The attributed upstream triangle-strip renderer is preserved as a source reference. Complexity is capped at 1.5; a heart focus reserves a static clear center. Rendering is capped at 60 Hz (30 Hz during AI work) and 1920 × 1080 backing pixels (1080p), preserving aspect ratio; sustained slow frames reduce actual resolution and density, including at 1× pixel density.

The existing WebAudio buses remain: MASTER, SESSION, AI_VOICE, AMBIENCE, EFFECTS, MIC_MONITOR. Additional speech/audio buses are main_voice, left_voice, right_voice, echo_voice, drone, noise and music_optional. MASTER remains user-controlled. Voice ducks SESSION with gain envelopes; AMBIENCE is optional stereo soft noise. Preset drone/noise are independently synthesized continuously in the browser and stop with the session. WAV export mixes the equivalent Python buses with gain staging and one final limiter. Optional side voice layers are disabled by default. Microphone monitoring is muted by default. Browser decoding handles media playback.

## Storage, media and devices

SQLite in `data/bambi.sqlite` separates preferences, conversations, sessions, media metadata and technical events. Profile and conversation identifiers scope transcript retrieval. FTS5 indexes older episodes; explicit user-confirmed preference revisions retain source turn and supersession metadata. Prompt budgeting combines recent exchanges, current preferences and relevant episodes. The earlier extractive summary remains available for compatibility but is no longer the primary prompt-memory mechanism. Fresh chat changes the context boundary while retaining confirmed preferences and older episodes; clearing memory removes profile turns, preference revisions and their searchable entries. KnowledgeProvider indexes an explicitly cloned upstream snapshot with keyword matching. It is not an embedding/vector database. No runtime system tools are exposed.

Normal local media playback uses browser object URLs. File bytes are not automatically persisted; users reselect files after reload while SQLite restores metadata. Explicit analysis uploads to this machine's loopback backend for ffmpeg waveform/silence processing and optional whisper.cpp transcription. Temporary media/decoded WAVs are removed; cached analysis stays in `runtime/media-analysis/`.

Optional Pearlconch/JoyHub commands originate from actual browser playback cues. Model text generation alone does not actuate hardware. The server validates ownership, channel mapping, caps and watchdog state; the Python bridge serializes BLE writes and independently stops output on timeout. Connecting does not arm control, and reload/reconnect does not restore an armed state. Conversation interruption removes future unheard commands while explicit Pause zeros channels and Stop disarms them. See [DEVICES.md](docs/DEVICES.md) for protocol and physical verification limits.

## Process lifecycle and extension

Process lifecycle is explicit and user-owned: project-local binaries, an isolated offline Kokoro ONNX environment, and detached process groups whose PID plus Linux starttime are recorded. Stop scripts validate identities before terminating only owned groups. Legacy services can still launch the rootless Kokoro container with a matching owner label, but normal application start uses the ONNX process. Changed speech code, presets or custom embeddings restart only the owned speech service. No autostart unit is installed. Model downloads occur exclusively during explicit setup, never during runtime startup.

Preset JSON, original voice provenance, the complete audio integration and upstream licensing are documented in [LOCAL_AUDIO.md](docs/LOCAL_AUDIO.md) and [LOCAL_AUDIO_LICENSES.md](docs/LOCAL_AUDIO_LICENSES.md).

The Firefox extension has a background connection to localhost and an explicitly injected content overlay. Its request builder shares model/context/intent defaults with the main app, and its background reconnects only while the overlay remains open without replaying requests. It reads selected HTML media timing/volume; its fallback is a manual clock. Background requests go to loopback rather than sending login data or browsing history. Device metadata is stripped in the overlay without arming or forwarding actuator control. Native temporary-installation/background/player integration has recorded fixture checks; authenticated platform playback still needs validation in a logged-in browser. The overlay is currently blocked by server admission controls; see the [README status](README.md#firefox-overlay).

## Studio, setup and evaluation

Vite builds three entry pages: the main app, Session Studio and Setup. Studio uses a versioned, strictly validated session-package schema with embedded audio hashes, declared cue timing and attribution. It provides audio/caption preview, scene indication, package import/export, transcript export and presentation timeline export; package contents cannot activate connected devices or execute code.

Setup reports component readiness and server-relative reply traces. Playback-start events from the main app follow the output clock. Client speech-input durations are reported separately; physical microphone/speaker latency still requires a physical test. An opt-in English phrase heuristic can merge a resumed utterance before committing a reply.

The neutral 48-case evaluation corpus uses production prompt/context/memory builders with isolated storage. Real inference runs only when explicitly requested. The headless integration script uses an in-memory server plus inference and silent-WAV speech stubs. The fixture script is `scripts/high-impact-browser-check.mjs`; it does not establish real-model or physical-device quality.

## Where to continue

The [README documentation guide](README.md#documentation-guide) lists the retained setup/security docs. [STABLE_CONTENT.md](docs/STABLE_CONTENT.md) records upstream provenance. Browser fixtures check orchestration, while real-model, microphone and hardware behavior need their own integration checks.
