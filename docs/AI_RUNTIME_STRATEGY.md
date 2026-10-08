# AI runtime decisions

Chat uses **llama.cpp CPU/Vulkan**; Kokoro and streaming recognition use **CPU**. Keep the selected model, full context, prompts, voice fingerprint and playback/cancellation contracts when changing acceleration.

## Current controller

`packages/runtime/accelerator-policy.mjs` and `accelerator-runtime.mjs` provide shared selection for desktop and the Python launcher. Owned probes are bounded; plugins must stay inside the native runtime. The builders currently ship CPU/Vulkan, even though discovery recognizes additional backends.

Preparation fits layers with a **1024 MiB GPU reserve**, verifies the full requested context, then performs a one-token inference check. It tries at most three eligible GPU paths followed by one CPU attempt, cleaning each failed worker first. Failing paths are quarantined for the session. CPU mode skips GPU probes and disables offload, using at most six threads and leaving two where possible.

Cancellation, corrupt models, context changes and foreign port conflicts do not trigger accelerator retries. Worker crashes require explicit re-preparation; audible replies are never replayed automatically. Health/setup report actual current-launch offload evidence. A GPU name or successful short probe is not a conversation benchmark.

## Speech acceleration decision

Keep speech on CPU. An isolated RX 6600 XT Kokoro trial with ONNX WebGPU 0.4.0 ran actual mixed GPU/CPU kernels but failed output equivalence:

| Short fixture | CPU | WebGPU |
| --- | ---: | ---: |
| First synthesis | 941 ms | 1636 ms |
| Second synthesis | 896 ms | 1429 ms |
| Audio duration | 2.944 s | 3.725 s |

The 26.5% duration difference needs explanation before enabling it. This single profiled sentence is diagnostic evidence, not a general benchmark. Sherpa manages separate sessions; a Kokoro ONNX plugin does not accelerate it automatically.

## Next work

Qualify the complete Windows 11 9B GPU/CPU/offline conversation first. Then evaluate speech acceleration under concurrent chat load, persistent driver-aware capability caching and native Apple Silicon packaging. Optional CUDA/vendor adapters require their own pinned bundles and acceptance; no runtime/model rewrite is needed for the current targets.

Tests must preserve context, output timing, recognition resets, owned-process cleanup and offline use. Physical audio, sleep/wake and recipient drivers need native observations. Package support follows the tested OS/backend combination, not engine portability alone.

[llama.cpp build options](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md) · [ONNX providers](https://onnxruntime.ai/docs/execution-providers/) · [WebGPU](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)
