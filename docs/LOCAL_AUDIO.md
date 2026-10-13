# Local audio

Kokoro-82M runs in a local CPU service. Desktop alpha bundles the runtime; development setup downloads its dependencies and model data:

```sh
./scripts/setup-local-tts.sh
./scripts/start.sh
```

Setup needs uv and network access. Models live in `models/kokoro`, the environment in `.runtime/tts-venv`. Open `/voice-lab` for comparisons and WAV exports. The development service binds to `127.0.0.1:8882` with a rotating server-side credential.

## Voices and exports

The bundled Classic voice blends Nicole 0.15, Bella 0.425 and Heart 0.425; provenance/hash are in `voices/bambi_classic.json`. Presets in `presets/audio/` control voice, speed, pauses, DSP and background. Manual controls override defaults. Pitch uses varispeed, changing duration too; captions use measured timing.

```sh
.runtime/tts-venv/bin/python tools/voice_lab.py render \
  --preset bambi_classic --text 'Clear and calm.' --output runtime/bambi-test.wav
.runtime/tts-venv/bin/python tools/voice_lab.py compare
.runtime/tts-venv/bin/python tools/voice_lab.py export-voice \
  --name my_local_voice --mix 'af_sarah:0.6 + af_bella:0.4'
```

Custom exports stay local and load on the next speech-service start.

## Dual Voice

Enable **Voice & AI → Voice blend & persona → Dual Voice** for generated guided passages. Ordinary conversation and recordings retain their main/original voice. Both voices share one Kokoro model. Bambi uses Bella (Heart when Bella is the main voice), speed 0.7, pitch +1; the main voice uses pitch −2 without extra voice layers/echoes.

| Phase | Main level | Bambi level |
| --- | ---: | ---: |
| Induction | 0 dB | −14 dB |
| Deepening | 0 dB | −12 dB |
| Conditioning | −2 dB | −10 dB |
| Anchor | −4 dB | −6 dB |
| Awakening | −8 dB | −6 dB |

```text
[owner] Rest here. [pause:long]
[bambi:…so warm…]
[owner] Stay here.
```

Inline Bambi fragments return to the main voice; `[bambi]` blocks continue until `[owner]`. Fragments fill trailing pauses of at least 900 ms or reserve a new gap; the next phrase waits for completion. Background fragments cannot execute triggers/device effects. Markers are stripped before speech/captions; Stop cancels both tracks. Implementation: `packages/speech/dual-voice.ts` and `packages/audio/dual-voice.ts`.

## Adaptive delivery and direction

**Voice & AI → Adaptive narration: pace, pauses & mix** changes generated narration, preserving the user's base speed and faders. Conversation and finished files retain their usual delivery.

| Mode | Speed multiplier | Phrase gap | Word cap | Phase-pause multiplier |
| --- | ---: | ---: | ---: | ---: |
| Settle | 0.90 | 650 ms | 50 | 1.50 |
| Guide | 1.00 | 350 ms | 75 | 1.00 |
| Drive | 1.35 | 140 ms | 85 | 0.55 |
| Hold | 0.86 | 900 ms | 35 | 1.80 |
| Return | 0.96 | 500 ms | 150 | 1.20 |

Speed stays within 0.5–1.5. Output-timed visuals respect manual scenes/reduced motion; mix changes never enable disabled sources or raise zero faders. The director owns timing, phases and effects; the model supplies bounded text with the complete selected character.

**Session → Session direction** tunes generated Guided sessions. Imported programs retain their timelines. Unlimited sessions use recurring 20-minute journeys with the 24/16/40/10/10 phase proportions, ending only on explicit Stop. Planning stays bounded to one future episode, 64 live episodes and 128 traces. Missing speech falls back at the episode boundary; unheard text does not enter delivered history. Owners: `packages/session-director/adaptive.ts`, `delivery.ts` and `events/`.

## Media and checks

Imported audio/video plays in the browser. Optional **≈** analysis needs ffmpeg/ffprobe; transcription also needs Whisper. Digital pause markers stay out of synthesis. Interruption discards queued speech; an executing ONNX phrase may finish first.

Run `npm run test:audio` after TTS setup, or `node scripts/dual-voice-check.mjs` after a web build. Fixture checks do not replace listening. [Audio notices](LOCAL_AUDIO_LICENSES.md).

## Microphone recognition

Install optional English streaming recognition with `npm run setup:streaming-speech`, restart the server and reload the page. Setup downloads about 73 MB, verifies the pinned [model](../config/streaming-speech-model.json) and installs a separate `.runtime/streaming-stt-venv`; normal startup does not download it.

Under **Microphone & conversation → Recognition**, Automatic uses streaming when available and falls back to installed Whisper. Whisper processes complete segments; Streaming requires the English model. Selection changes on the next microphone activation. Failure during an utterance can submit its completed WAV to Whisper; cancelled utterances are never retried.

AudioWorklet/worker VAD supplies 16 kHz PCM over the admitted same-origin `/ws/speech` socket to one CPU recognizer through private pipes. Partial words are status only; exactly one final transcript becomes chat input. Muting releases the connection, Stop shuts down the worker, and idle residency lasts at most 60 seconds. Utterance IDs reject late results; audio queues/timeouts are bounded and recognition accepts at most 27 seconds. PCM is not saved by the recognizer; final input follows normal conversation/cloud settings.

For a real-model browser fixture after streaming setup:

```sh
curl --fail --location \
  https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/672fbf1b30579d6585301139bb363f42a0ad4a24/test_wavs/0.wav \
  --output .runtime/streaming-speech/test.wav
BAMBI_BROWSER_STREAMING=1 npm run test:integration
```

Install Playwright Chromium or set `BAMBI_BROWSER_BINARY`. This injected recording checks partial/final ordering, one committed input and Mute; it does not test a physical microphone. Compare English recognition with Whisper on your own names/noise. VAD pause settings still determine when speech ends.

The desktop alpha defaults to **Bambi Mix** (`bambi_classic`): the original verified Nicole 15% / Bella 42.5% / Heart 42.5% embedding. It uses Local Clean at speed 0.78 and neutral pitch. Existing explicit voice choices remain saved. Optional voice experiments are not provisioned by ordinary desktop setup.
