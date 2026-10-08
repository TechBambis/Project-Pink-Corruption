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

Unmute / Mute -> AudioWorklet capture -> VAD worker -> 16 kHz WAV in memory -> local whisper.cpp
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

Transport control runs on visual frames with a separate timer when frames are suspended or stalled. Hidden pages do not render visuals, while phase updates, session completion, device heartbeats, reply planning and persistence continue to read the audio clocks. Browser timers can still be throttled; this is not a real-time background guarantee. Timeline delivery uses a sorted cursor, skips expired duration events, and drops transient effects more than 150 ms late. Current captions and persistent scene/ambient state can be restored after a stall; playback accounting is retained. Pause and backward seek remain explicit transport operations.

Typing, microphone capture, transcription and ordinary conversation do not freeze session time. Media, phase visuals, ticks and background audio continue while the companion replies; speech ducks their level. Explicit Pause suspends transport/audio and keeps event positions fixed. Seeking updates timeline and media position. Hard stop resets transport, stops sources, cancels requests, clears captions and exits fullscreen. Speech interruption instead discards unheard voice and future speech cues while retaining an active session's bounded patterns and background playback. The state is implemented in `packages/session-director/`.

Session stages and intensity curves are deterministic. The AI receives a validated snapshot of phase, time, intensity, selected scene and trigger metadata. It can supply validated presentation cues, but the app owns session timing and output limits. Continuous narration waits for completed playback and a phase-specific gap; pending user input blocks the next passage. Narration scheduling is implemented in `packages/session-director/narration.ts`.

## Inference and speech streaming

Preparation checks complete conversation instructions and, when enabled, each representative narration phase with its required response reserve before generating the warmup token. The selected native/cloud tokenizer is used when available; Ollama budgets remain explicitly estimated. The full authored prompt is retained. History and changing session metadata are checked again for every real request. Preparation returns separate budgets for each checked mode/phase, and conversation-only preparation does not require a full narration passage to fit.

Microphone resampling, Silero ONNX inference and frame classification run in a dedicated browser worker. Capture stays in the AudioWorklet. Optional English streaming recognition sends confirmed 16 kHz PCM over the same-origin `/ws/speech` connection to one server-owned sherpa-onnx CPU process through private pipes. Provisional words remain status text; only a matching final transcript becomes a chat input. The existing Whisper WAV endpoint remains selectable and recovers completed utterances after streaming failure. Mailboxes, PCM queues and utterance lifetimes are bounded. Reset epochs and utterance identities discard replies in transit, and muting cancels loading or terminates capture. Playback echo guards and classified-speech interruption thresholds are unchanged. The streaming model stays resident for 60 seconds after disconnect and closes immediately on Stop. See [STREAMING_SPEECH.md](docs/STREAMING_SPEECH.md).

The server proxies loopback AI/speech endpoints and an optional server-configured cloud endpoint. Configured native Qwen models use llama.cpp; other local models use Ollama. Cydonia cloud inference uses a separate adapter with server-side credentials, bounded requests and cancellation. The browser receives connection capabilities but no upstream API key. See [CLOUD_COMPUTE.md](docs/CLOUD_COMPUTE.md). Thinking is disabled by default. The native 9B family has a configured 24,576-token context; the 35B family has 16,384. Requested output can be up to 8,192 tokens, but context budgeting reserves actual output space and a safety margin before generation. Native token counts use the loaded template/tokenizer; Ollama counts are explicitly estimates. Mandatory persona/input content is not silently truncated. Model/backend settings are in [packages/ai/models.ts](packages/ai/models.ts) and [config/sampling.ts](config/sampling.ts).

Runtime prompt construction retains the complete authored main document, strategy and enabled collar, removing only identical complete sections. Stable shared instructions precede per-request state and task guidance. Narration receives phase passage guidance; ordinary conversation prioritizes the latest task. Explicit request intent separates conversation from narration. A context plan considers up to 128 candidate messages, keeps complete recent exchanges, and reserves bounded capacity for confirmed preferences and relevant older episodes. Native and cloud tokenizers count mandatory instructions first; calibrated local estimates choose optional evidence, then an exact count checks the complete history. If it fits, planning needs only two token counts. Overflow uses cached exact probes to fit a contiguous history suffix, removing older history before reserved evidence unless that evidence would displace the latest two exchanges. Technical context metrics report planning-call counts and exact fallback use.

Native 9B models have a 2,048 MiB RAM prompt-cache cap so a measured approximately 862 MiB recurrent conversation state can survive a switch to the listening classifier. Their fixed persona/voice/format instructions occupy the initial system message. A fixed system instruction defines the first user message as internal application context; that message carries changing response guidance, session metadata and quoted memory before actual history and the final user input. This user-message boundary gives llama.cpp a recurrent checkpoint before changing state. Both preflight and per-request token counting include this exact layout and its overhead; internal context is never stored as a conversation turn. Warmup uses the same system prefix. The full authored content remains present. Qwen's template requires system messages at the start; changing context is not sent as a later system message. Other backends retain their existing message layout, and the memory-scoped 35B cache budget remains 256 MiB. Cache availability improves subsequent requests; cold preparation still evaluates the long prompt.

Sentence synthesis overlaps token generation and playback. The acknowledgement window bounds pending sentences and lets a multi-chunk sentence finish. Native spoken generation yields after small sentence batches so prioritized listening decisions can run before continuation. Text-only and Ollama requests retain their ordinary stream. Playback reports let interrupted history retain the heard excerpt rather than all generated text. The production logic is in `packages/ai/` and `apps/web/src/concurrent-input.ts`.

Main-app and overlay requests carry a client-issued UUID before server preparation begins. The server echoes it on every reply event; a shared reply gate admits only the current request and its server reply ID. Stop invalidates that identity immediately, including before `begin`, so delayed text, audio, actions and errors cannot revive a cancelled reply. Transport epochs also discard chat preparation that finishes after Stop, disconnect or a fresh/cleared conversation. The connection handshake advertises correlation support and asks clients to restart an older server when needed. Legacy external chat requests remain parseable.

Native llama.cpp and Ollama share one local inference slot; cloud generation and cloud listening share a separate remote slot. A slow cloud request therefore does not occupy the local GPU queue. Returning from a native, Ollama or cloud stream aborts its individual HTTP request before releasing its slot, without cancelling the overall reply or a subsequent assistant continuation. Requests cancelled immediately after acquiring a slot never start inference.

Kokoro-82M ONNX runs in an owned Python CPU process on port 8882 with resident local weights, cached embeddings and a bounded phrase cache. Its phrase-aware renderer inserts explicit digital pauses and sends short WAV chunks over the existing protocol. Client captions use measured phrase durations and phoneme/PCM-derived word timings when available; the renderer does not invent word offsets. Speech-provider capabilities declare language, timing, blending and control support. The same renderer serves the local Voice Lab and CLI WAV export. The microphone path uses browser VAD with optional CPU streaming recognition or in-memory 16 kHz WAV capture for local whisper.cpp.

## Visuals and audio

Visual rendering combines a full-screen layered shader (smooth spiral/tunnel, gradients, particles, vignette, audio response) with a smooth analytic two-arm classic spiral. The attributed upstream triangle-strip renderer is preserved as a source reference. Complexity is capped at 1.5; a heart focus reserves a static clear center. Rendering is capped at 60 Hz (30 Hz during AI work) and 1920 × 1080 backing pixels (1080p), preserving aspect ratio; sustained slow frames reduce actual resolution and density, including at 1× pixel density.

The existing WebAudio buses remain: MASTER, SESSION, AI_VOICE, AMBIENCE, EFFECTS, MIC_MONITOR. Additional speech/audio buses are main_voice, left_voice, right_voice, echo_voice, drone, noise and music_optional. MASTER remains user-controlled. Voice ducks SESSION with gain envelopes; AMBIENCE is optional stereo soft noise. Preset drone/noise are independently synthesized continuously in the browser and stop with the session. WAV export mixes the equivalent Python buses with gain staging and one final limiter. Optional side voice layers are disabled by default. Microphone monitoring is muted by default. Browser decoding handles media playback.

## Storage, media and devices

SQLite in `data/bambi.sqlite` separates preferences, conversations, sessions, media metadata and technical events. Profile and conversation identifiers scope transcript retrieval. FTS5 indexes older episodes; explicit user-confirmed preference revisions retain source turn and supersession metadata. Optional semantic retrieval combines word matches with multilingual embedding similarity through reciprocal-rank fusion. It selects up to eight current preferences and four older excerpts, scanning at most 10,000 profile/model-scoped vectors. Confirmed revisions remain authoritative; retrieval cannot invent facts. Assistant sources use visible, heard dialogue excerpts.

`npm run setup:memory` explicitly installs the pinned q8 multilingual MiniLM model from [config/memory-model.json](config/memory-model.json), verifying sizes and SHA-256 hashes and retaining Apache-2.0 licensing/provenance. Runtime inference allows local files only and runs in a dedicated CPU worker with one inference thread. Background indexing yields between batches of eight; queries take priority over the next batch and have a two-second budget with lexical fallback. SQLite caches vectors across restarts by model identity; source changes invalidate them. Query embeddings have a bounded 32-entry cache. Clear/forget aborts indexing and retrieval, clears query caches and prevents removed sources from being reinserted by late work. Forgetting a preference excludes all its revision sources from lexical and semantic search while preserving the transcript for explicit history/export.

Prompt budgeting combines recent exchanges, current preferences and relevant episodes. The earlier extractive summary remains available for compatibility but is no longer the primary prompt-memory mechanism. Fresh chat changes the context boundary while retaining confirmed preferences and older episodes; clearing memory removes profile turns, preference revisions and their searchable/vector entries. KnowledgeProvider separately indexes an explicitly cloned upstream snapshot with keyword matching. No runtime system tools are exposed.

Normal local media playback uses browser object URLs. File bytes are not automatically persisted; users reselect files after reload while SQLite restores metadata. Explicit analysis uploads to this machine's loopback backend for ffmpeg waveform/silence processing and optional whisper.cpp transcription. Temporary media/decoded WAVs are removed; cached analysis stays in `runtime/media-analysis/`.

Optional Pearlconch/JoyHub commands originate from actual browser playback cues. Model text generation alone does not actuate hardware. The server validates ownership, channel mapping, caps and watchdog state; the Python bridge serializes BLE writes and independently stops output on timeout. Connecting does not arm control, and reload/reconnect does not restore an armed state. Conversation interruption removes future unheard commands while explicit Pause zeros channels and Stop disarms them. See [DEVICES.md](docs/DEVICES.md) for protocol and physical verification limits.

## Process lifecycle and extension

Process lifecycle is explicit and user-owned: project-local binaries, an isolated offline Kokoro ONNX environment, and detached process groups whose PID plus Linux starttime are recorded. Stop scripts validate identities before terminating only owned groups. Legacy services can still launch the rootless Kokoro container with a matching owner label, but normal application start uses the ONNX process. Changed speech code, presets or custom embeddings restart only the owned speech service. No autostart unit is installed. Model downloads occur exclusively during explicit setup, never during runtime startup.

Preset JSON, original voice provenance, the complete audio integration and upstream licensing are documented in [LOCAL_AUDIO.md](docs/LOCAL_AUDIO.md) and [LOCAL_AUDIO_LICENSES.md](docs/LOCAL_AUDIO_LICENSES.md).

The Firefox extension has a background connection to localhost and an explicitly injected content overlay. Its request builder shares model/context/intent defaults with the main app, and its background reconnects only while the overlay remains open without replaying requests. It reads selected HTML media timing/volume; its fallback is a manual clock. Background requests go to loopback rather than sending login data or browsing history. Device metadata is stripped in the overlay without arming or forwarding actuator control. Native temporary-installation/background/player integration has recorded fixture checks; authenticated platform playback still needs validation in a logged-in browser. The overlay is currently blocked by server admission controls; see the [README status](README.md#firefox-overlay).

## Studio, setup and evaluation

Vite builds three entry pages: the main app, Session Studio and Setup. Studio uses a versioned, strictly validated session-package schema with embedded audio hashes, declared cue timing and attribution. It provides audio/caption preview, scene indication, package import/export, transcript export and presentation timeline export; package contents cannot activate connected devices or execute code.

Setup reports component readiness and server-relative reply traces. Playback-start events from the main app follow the output clock. Client speech-input durations are reported separately; physical microphone/speaker latency still requires a physical test. An opt-in English phrase heuristic can merge a resumed utterance before committing a reply.

The neutral 48-case evaluation corpus uses production prompt/context/memory builders with isolated storage. Real chat inference runs only when explicitly requested. `npm run eval:memory` tests seven synthetic English retrieval cases using the installed local embedding model and an in-memory database; it checks paraphrases and unrelated questions without reading user history. `npm run test:integration` first builds the current app, then runs an in-memory server with inference and silent-WAV speech stubs. The fixture script is `scripts/high-impact-browser-check.mjs`; it checks setup, Studio, chat, playback traces, memory editing, Stop before/after `begin` with delayed output, and session completion with visual frames suspended. An opt-in mode also checks the installed streaming recognizer against a public upstream speech recording, including partial-before-final ordering and exactly one committed input; see [STREAMING_SPEECH.md](docs/STREAMING_SPEECH.md). CI runs the default fixture on Node 22 and 24 and retains diagnostics on failure. These checks do not establish general model or physical-device quality.

## Where to continue

The [README documentation guide](README.md#documentation-guide) lists the retained setup/security docs. [STABLE_CONTENT.md](docs/STABLE_CONTENT.md) records upstream provenance. Browser fixtures check orchestration, while real-model, microphone and hardware behavior need their own integration checks.
