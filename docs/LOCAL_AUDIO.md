# Local Kokoro audio and Voice Lab

Local speech uses Kokoro-82M v1.0 through kokoro-onnx in an isolated CPU service. Model files and dependencies are downloaded during explicit setup; normal rendering uses local files. There is no automatic cloud voice fallback.

## Setup on Linux

From the repository root:

```sh
./scripts/setup-local-tts.sh
./scripts/start.sh
```

Install uv before running this setup; it also needs Python provisioning/network access for the initial download. Setup uses uv, Python 3.12, frozen requirements and model downloads verified against committed SHA-256 hashes. Models are stored under ignored `models/kokoro/`; the Python environment is under ignored `.runtime/tts-venv/`. The TTS path does not require Docker or a GPU.

Open **http://127.0.0.1:6969/voice-lab** to compare voices, render A/B passages and export WAVs. In the main app, select a voice/preset in the audio settings. Missing speech services are shown as unavailable; text/media remain separate capabilities.

The service binds to **127.0.0.1:8882**. Its render credential rotates when it starts and is read by the application server from an ignored token file. See [local access limits](LOCAL_SECURITY.md).

## Voices and presets

The initial voices are af_heart, af_bella, af_sarah, af_nicole, af_sky, af_river and af_aoede. Comparison recordings are created locally rather than shipped in the source.

The bundled `bambi_classic.npy` is an original normalized blend of af_nicole (0.15), af_bella (0.425) and af_heart (0.425). Provenance and the raw tensor hash are in `voices/bambi_classic.json`. It is a derivative embedding, with no reference recordings.

Presets in `presets/audio/` define voice, speed, pauses, processing and background layers. Clean disables drone/noise; Classic and Classic Deep add configurable processing/background; Voice Test disables those additions for comparison. Manual voice/speed controls can override the preset defaults.

Pitch processing uses varispeed: pitch and duration change together. Captions use phrase text and measured spoken duration. The provider can also return word boundaries matched to measured model phoneme durations; alignment can be partial, and unmatched words are not assigned fabricated offsets. Rendering rescales these boundaries when varispeed changes duration. Side speech layers are opt-in. Drone and noise have separate controls and can be switched off.

## Local exports

```sh
.runtime/tts-venv/bin/python tools/voice_lab.py render \
  --preset bambi_classic --text 'Clear and calm.' \
  --output runtime/bambi-test.wav

.runtime/tts-venv/bin/python tools/voice_lab.py compare

.runtime/tts-venv/bin/python tools/voice_lab.py export-voice \
  --name my_local_voice --mix 'af_sarah:0.6 + af_bella:0.4'
```

The CLI writes metadata beside each WAV. Custom voice exports stay local and are loaded on the next owned speech-service start. Only the reviewed bundled blend is included by default.

## Imported media analysis

Normal audio/video playback runs in the browser. The **≈** button beside an imported track calculates its waveform and pauses locally. This optional feature needs `ffmpeg` and `ffprobe` on the server's PATH. Generating captions during analysis also needs the local Whisper setup. Files are processed on this machine and are not sent to a cloud model.

## Timing and controls

Explicit pause markers insert digital silence and do not reach synthesis as words. Named-trigger preset settings can adjust synthesis speed and vocal volume independently of sound effects. The browser schedules speech, pauses and effect cues on one audio clock; interruption cancels queued speech/effects.

The main app exposes independent sound levels, post-effect pauses and Wiper duration. Generated public fallback effects are included; optional private recordings are not distributed. Rendering may finish the currently executing ONNX phrase before cancellation takes effect.

## Verification and licenses

```sh
npm run check
npm test
npm run test:audio
npm run build
```

Audio tests need the local TTS setup and exercise the real provider in addition to protocol/DSP checks. Passing fixtures does not establish perceptual voice similarity.

[LOCAL_AUDIO_LICENSES.md](LOCAL_AUDIO_LICENSES.md) retains upstream attribution and license details. The phonemizer/eSpeak stack includes GPL components; the whole audio dependency stack must not be described as Apache-only. Private recordings, caches and installed environments remain outside Git.
