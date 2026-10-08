# Pinned dependencies and runtime identities

Reviewed against repository configuration on 2026-10-05. These are project pins, not a list of the newest upstream releases or a promise that another operating system is supported.

## Application

The application requires Node.js **22.13+**. [package.json](package.json) defines exact direct package versions; [package-lock.json](package-lock.json) freezes the dependency tree. GitHub CI uses Node 22 and 24 on Linux.

| Component | Repository pin |
| --- | --- |
| Express / ws / Zod | 5.1.0 / 8.22.0 / 3.25.76 |
| Vite / TypeScript / tsx | 7.3.6 / 5.9.3 / 4.20.6 |
| Extension build / esbuild | 0.25.12 |
| Browser VAD / ONNX Runtime Web | @ricky0123/vad-web 0.0.31 / onnxruntime-web 1.22.0 |
| Playwright | 1.56.0 |
| Local memory embeddings / Transformers.js | @huggingface/transformers 4.3.0 |
| CI secret scanner | Gitleaks 8.30.1; archive SHA-256 checked in the workflow |

## Local services

| Component | Pin source |
| --- | --- |
| Project-local Ollama | v0.35.1; official Linux amd64 archive and release checksum verified by `scripts/setup.sh` |
| Kokoro Python environment | Python 3.12; [requirements.lock](packages/speech/local/requirements.lock), including kokoro-onnx 0.6.1 and onnxruntime 1.30.0 |
| Kokoro model and voice bundle | [models.json](packages/speech/local/models.json): immutable release URLs and SHA-256 |
| Optional BLE bridge | [requirements.lock](packages/devices/requirements.lock): Bleak 3.0.2, dbus-fast 5.0.4 on Linux |
| whisper.cpp | v1.9.4; setup in `scripts/setup-speech.sh`, with separately checked base-model SHA-256 |
| Optional streaming speech | sherpa-onnx 1.13.8 / NumPy 2.5.3 in a separate environment; English int8 Zipformer revision, sizes and SHA-256 in [streaming-speech-model.json](config/streaming-speech-model.json) |
| Whisper build tools | CMake 4.4.3 / Ninja 1.13.2 |
| Native Qwen/Gemma imports | [community-models.json](docs/community-models.json), [qwen36-model.json](docs/qwen36-model.json), [comparison-models.json](docs/comparison-models.json) |
| Cloud Cydonia model | [cydonia-cloud-model.json](docs/cydonia-cloud-model.json) |
| Optional CPU memory model | q8 paraphrase-multilingual-MiniLM-L12-v2; revision, sizes and SHA-256 in [memory-model.json](config/memory-model.json) |
| Cloud llama.cpp build | Revision `11fe02151f79c41d0d4af7da708755d73b9c0da6`, pinned in `scripts/cloud/build-llama.sh` |

Some setup sources use a version tag or a model URL with checksum validation; not every download URL is an immutable commit URL. Review setup scripts and manifests before changing pins.

Native provisioning/lifecycle currently targets Linux. Machine-specific kernel, driver, browser and performance observations belong to the local archive, not the support matrix. A clean npm audit only describes the packages checked at that time; it is not a continuing security guarantee.

## Reused content and licenses

[js-bambisleep-chat STABLE-2.0](https://github.com/HarleyVader/js-bambisleep-chat/tree/STABLE-2.0) source is pinned to [commit `3f5e9b336382f1f49ac2edde3c0281845f74b0a3`](https://github.com/HarleyVader/js-bambisleep-chat/tree/3f5e9b336382f1f49ac2edde3c0281845f74b0a3). The manifest identifies 20 selected content/provenance files; the editable Classic prompt has an explicit local override and its original is preserved separately. Regular content tests verify the selected files, pinned hashes and prompt compatibility.

[STABLE_CONTENT.md](docs/STABLE_CONTENT.md) records modifications and provenance. Third-party [content notices](docs/LICENSE.stable2), [geometry license](docs/LICENSE.backup2) and [audio licenses](docs/LOCAL_AUDIO_LICENSES.md) remain included. Original project code is licensed under AGPL-3.0-only; [LICENSING.md](LICENSING.md) explains scope and separately negotiated commercial permissions.

Dependencies, model weights and installed environments are downloaded during explicit setup and excluded from Git. Normal startup does not provision them automatically.
