# Local streaming speech recognition

Streaming recognition processes confirmed microphone speech while you are still speaking. Provisional words appear under **Microphone & conversation**. Only the final transcript becomes a chat input; provisional words never enter conversation storage or trigger a reply.

## Install and choose recognition

From the repository root, with Python 3 and its `venv`/pip support installed:

```sh
npm run setup:streaming-speech
```

This explicit setup installs `sherpa-onnx==1.13.8` and `numpy==2.5.3` into `.runtime/streaming-stt-venv`, and downloads about 73 MB of model assets into `.runtime/streaming-speech/model`. The model revision, file sizes and SHA-256 checksums are pinned in [streaming-speech-model.json](../config/streaming-speech-model.json). Setup verifies downloads, and the recognition worker verifies weights again when loading. Installed packages, model weights and recordings stay outside Git. Normal startup never downloads these assets.

Restart the app server after installation, reload the page, then open **Microphone & conversation → Recognition**:

| Choice | Behavior |
| --- | --- |
| Automatic | Uses streaming if installed. Falls back to an available Whisper service if streaming preparation fails. |
| Whisper | Transcribes complete speech segments through the existing local Whisper endpoint. |
| Streaming | Requires the installed English streaming model. Reports preparation failure instead of silently choosing Whisper. |

Changing recognition takes effect on the next microphone activation. If streaming fails during an utterance, the completed in-memory WAV is submitted to Whisper. This recovery requires Whisper to be installed and running; otherwise its unavailable-service error is shown. No cancelled utterance is retried. Whisper remains useful for comparing accuracy on names, special vocabulary and languages beyond English.

## Audio and process boundaries

The existing AudioWorklet captures microphone audio. A browser worker resamples it to 16 kHz and runs Silero VAD. Streaming begins only after speech is confirmed, using up to 896 ms of buffered onset so the opening words are retained. Playback guards clear recognition input when capture is blocked.

The browser sends float32 PCM over the same-origin `/ws/speech` WebSocket, protected by the app's Host and Origin admission checks. The server owns one resident Python recognizer through private stdin/stdout pipes, with no additional listening port. The quantized Zipformer model runs on the CPU with two inference threads, leaving the GPU available for the chat model. One microphone connection owns streaming recognition at a time. Muting releases the connection; the model stays resident for up to 60 seconds for quick reactivation, then the server releases it. Stop shuts it down immediately.

Partial results are transient status text. Utterance identities reject results arriving after reset or cancellation. Each completed utterance can commit one final result or one Whisper fallback. Audio queues, PCM sizes, utterance duration and loading/finalization time are bounded. Recognition receives at most 27 seconds per utterance; overload or timeout uses the same recovery path. Neither the streaming worker nor its server bridge stores PCM or transcripts. Final chat inputs follow the existing conversation storage and selected chat-backend rules, including the optional remote chat backend.

The [model card](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26) declares Apache-2.0. Sherpa-onnx is also Apache-2.0. Preserve upstream notices when redistributing installed environments or weights; see [local audio licenses](LOCAL_AUDIO_LICENSES.md).

## What to verify in the app

This model recognizes English. Compare it with Whisper using your microphone, room noise and Bambi-specific names before relying on its accuracy. Streaming moves recognition work into the time spent speaking; it does not establish better accuracy or a measured physical-microphone speedup.

The existing VAD pause setting still determines when an utterance finishes. The optional unfinished-phrase feature remains an English phrase heuristic. Streaming does not add a neural conversation-turn detector. Reply generation and voice synthesis have their own latency after transcription.

## Reproduce the browser check

The normal `npm run test:integration` uses synthetic silence and local inference/speech stubs; it needs no streaming model. An optional check uses the installed CPU model and a public upstream test recording, with an isolated in-memory database and stub chat replies:

```sh
npm run setup:streaming-speech
curl --fail --location \
  https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/672fbf1b30579d6585301139bb363f42a0ad4a24/test_wavs/0.wav \
  --output .runtime/streaming-speech/test.wav
BAMBI_BROWSER_STREAMING=1 npm run test:integration
```

Install the matching Playwright Chromium beforehand, or set `BAMBI_BROWSER_BINARY` to an existing compatible executable. The recording is injected into a generated MediaStream and never connected to speakers. The check verifies provisional results arrive before the final transcript, provisional text stays out of history, exactly one final user input is stored, and Mute terminates capture. It reports finalization time measured from VAD completion, excluding the VAD silence interval. It does not access private recordings, use a physical microphone or evaluate general transcription quality.
