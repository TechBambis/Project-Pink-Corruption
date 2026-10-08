# Local audio sources and licenses

The audio setup installs dependencies locally from public upstream packages. It does not vendor their executable code into this repository. Preserve the packages' license/notice files when distributing an installed environment, and preserve the model's Apache license and upstream attribution when distributing weights or derived embeddings.

| Component | Installed version | License and source |
| --- | --- | --- |
| Kokoro-82M v1.0 model and bundled voices | v1.0 | Apache-2.0; [official model card and license declaration](https://huggingface.co/hexgrad/Kokoro-82M), [retained license text](licenses/KOKORO-APACHE-2.0.txt) |
| Model/voice release files | model-files-v1.1 | Same upstream model license; [kokoro-onnx release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1); URLs and SHA-256 are in `packages/speech/local/models.json` |
| Custom bambi_classic embedding | original local blend | Derived under Apache-2.0; [attribution and modification notice](licenses/KOKORO-ATTRIBUTION.md), method, weights and hash in `voices/bambi_classic.json`; not claimed CC0 |
| Generated trigger WAVs | original local synthesis | CC0-1.0; provenance/hashes in `apps/web/public/sounds/manifest.json`; no reference recordings |
| kokoro-onnx | 0.6.1 | [MIT](https://github.com/thewh1teagle/kokoro-onnx/blob/main/LICENSE) |
| ONNX Runtime | 1.30.0 | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| NumPy | 2.5.3 | BSD-3-Clause with bundled 0BSD/MIT/Zlib/CC0 notices; [upstream](https://github.com/numpy/numpy/blob/main/LICENSE.txt) |
| Optional streaming recognition: sherpa-onnx / sherpa-onnx-core | 1.13.8 | [Apache-2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE); installed in a separate environment |
| English streaming Zipformer model | revision `672fbf1b30579d6585301139bb363f42a0ad4a24` | Apache-2.0; [upstream model card](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26); hashes in `config/streaming-speech-model.json` |
| SciPy | 1.17.1 | BSD-3-Clause plus bundled third-party notices; [upstream](https://github.com/scipy/scipy/blob/main/LICENSE.txt) |
| espeakng-loader Python wrapper | 0.2.4 | [MIT wrapper](https://github.com/thewh1teagle/espeakng-loader/blob/main/LICENSE); its bundled eSpeak NG library has a separate license |
| eSpeak NG shared library/data | bundled by loader | [GPL-3.0-or-later](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING); [upstream source](https://github.com/espeak-ng/espeak-ng), [loader build/submodule source](https://github.com/thewh1teagle/espeakng-loader) |
| phonemizer | 3.4.0 | [GPL-3.0-or-later](https://github.com/bootphon/phonemizer/blob/master/LICENSE) |
| attrs | 26.1.0 | MIT |
| cloudpickle | 3.1.2 | BSD-3-Clause |
| dlinfo | 2.0.0 | MIT |
| flatbuffers | 25.12.19 | Apache-2.0 |
| joblib | 1.6.0 | BSD-3-Clause |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| protobuf | 7.36.2 | BSD-3-Clause |
| typing-extensions | 4.16.0 | PSF-2.0 |

Exact transitive versions are frozen in `packages/speech/local/requirements.lock`; dependency notices remain in the installed `.dist-info` directories. NumPy/SciPy binary wheels include additional library notices which must remain with those wheels. Python is installed through uv into an isolated runtime; [Python licensing](https://docs.python.org/3/license.html) and [uv licensing](https://github.com/astral-sh/uv) apply to redistributing those tools.

The phonemizer and eSpeak components are needed for local grapheme-to-phoneme conversion, not for DSP. The new filters, EQ, compression, oscillator/noise synthesis and mixer use NumPy/SciPy and local code, with no GPL DSP dependency. The GPL-containing TTS service runs as a separate local process using a plain HTTP/PCM boundary. **This does not remove the GPL obligations for that service and its dependencies.** The whole dependency stack must not be marketed as Apache-only. Distributing an installed binary environment requires retaining applicable notices and satisfying corresponding-source requirements; this source checkout instead installs those dependencies through their upstream packages.

Public sound/voice assets are identified above and in their manifests. User imports and recordings are not part of the distribution and need their own redistribution permissions. Downloaded weights and installed environments stay outside Git.

Optional streaming recognition has a separate environment installed by `scripts/setup-streaming-speech.py`; it does not alter the TTS lockfile. Sherpa-onnx and its core package are pinned to 1.13.8, with NumPy 2.5.3. Preserve their installed package notices and the Zipformer model's upstream attribution when redistributing. [Streaming setup and recognition limits](STREAMING_SPEECH.md).

The optional local device bridge has its own isolated environment: Bleak 3.0.2 and dbus-fast 5.0.4, both MIT, pinned in `packages/devices/requirements.lock`. They do not change the TTS environment. Retain their installed license notices when redistributing; [device setup, upstream packet provenance and licensing](DEVICES.md).

The guided breathing air texture is original local synthesis (`packages/audio/breath.ts`), with no downloaded or human voice recording. Its noise and 200–400 Hz contour are generated in the browser; it adds no third-party sound asset or runtime dependency.
