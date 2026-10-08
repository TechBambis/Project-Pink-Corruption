# Reliable desktop AI runtime strategy

Research date: 2026-10-08. Status: core chat selection/recovery controller implemented in source, with regression tests and an isolated Linux Kokoro experiment. This document does not qualify a new runtime, modify the delivered Windows alpha, or establish minimum hardware requirements.

## Decision

Prefer GPU acceleration for the large conversational model. Select speech acceleration separately, using output correctness, conversation latency and memory headroom. Maintain one application-level capability and lifecycle controller above a small number of established inference engines. A GPU preference must not become a requirement that prevents otherwise usable hardware from working.

Keep llama.cpp for GGUF chat and ONNX-based speech. Preserve the reviewed 9B model, full 24576-token context, authored prompts, approved voice embedding, DSP, timing and cancellation semantics. Moving a service between CPU and GPU is an execution change, not permission to change its model, precision, language or behavior.

The delivered Windows alpha requests all chat layers on the GPU in its default mode and allows an explicit CPU mode. The new source controller uses the same JavaScript policy in Electron and the Python launcher, through a private Node subprocess bridge. It inventories compatible devices with bounded owned probes, asks llama.cpp to fit layers with a 1024 MiB device reserve, fixes both requested and minimum context to the selected model's full context, checks the reported context and executes a one-token public inference check. This check measures startup correctness and its own duration; it does not establish usable conversation latency.

Preparation tries at most three eligible GPU paths, then one CPU attempt. Each failed worker is stopped before another starts. A failed device/backend path is quarantined for the application session; another available backend remains eligible. Unknown memory budgets on integrated/unified devices are tested rather than rejected as zero-memory hardware. CPU inference uses at most six available threads, leaving two for speech and the desktop where possible. Inherited loader, device-visibility and llama option overrides are cleared, and CPU mode skips GPU probes and explicitly disables offload. Damaged models, changed context, cancellation and foreign port conflicts do not cause accelerator retries. A worker crash is reported immediately; restart/fallback happens on a subsequent explicit preparation, without replaying a reply. Setup and health expose actual current-launch offload evidence and preparation results. Kokoro and streaming recognition retain CPU execution. See [shared policy](../packages/runtime/accelerator-policy.mjs), [owned discovery](../packages/runtime/accelerator-runtime.mjs), [desktop services](../packages/runtime/desktop-services.ts), [Python launcher](../scripts/llama-runtime.py), [Kokoro provider](../packages/speech/local/provider.py) and [streaming worker](../packages/speech/streaming/worker.py).

## Backend choices and limits

| Service | Recommended baseline | Additional acceleration | Acceptance requirement |
| --- | --- | --- | --- |
| Chat on Windows/Linux | llama.cpp Vulkan, with CPU available | CUDA on a separately qualified NVIDIA target | Actual model inference and verified offload, full context and memory headroom |
| Chat on Apple Silicon | llama.cpp Metal, with CPU available | None initially | Native macOS packaging and full conversation tests |
| Kokoro speech | Existing CPU ONNX session | Native ONNX WebGPU as a candidate; CoreML or Windows-specific providers when justified | Same voice, compatible audio/timing, measured conversation improvement |
| Streaming recognition | Existing Sherpa CPU worker | Qualified Sherpa DirectML, CUDA or CoreML build where applicable | Real partial/final transcripts, reset/cancel and sustained latency under chat load |

llama.cpp already exposes CPU, Vulkan, Metal and CUDA backends. Keeping its GGUF model avoids a model conversion solely to unify engine names. Vulkan offers a useful cross-vendor Windows/Linux starting point; CUDA is an optional performance path, not a dependency every tester must install. These are architectural choices, not comparative benchmark conclusions. [Upstream build documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).

The source selection layer understands owned CUDA, Vulkan, Metal, HIP and SYCL devices. It only loads plugins already present inside the owned native runtime and rejects plugin symlinks escaping that directory. The reviewed builders currently package CPU/Vulkan; recognizing other devices does not deliver or qualify those native backends. Native macOS/ARM packages, optional vendor bundles and real GPU acceptance remain separate work. No automatic model substitution or provider download is introduced.

ONNX Runtime provides a common API over different execution providers and can assign unsupported operations to CPU. Provider registration alone does not prove that the expensive operations execute on a physical GPU. Device identity, execution profiling and usable output are required. [Execution providers](https://onnxruntime.ai/docs/execution-providers/).

Native ONNX WebGPU is a promising way to reduce speech backend variants: its Dawn implementation targets Direct3D 12/Vulkan on Windows, Vulkan on Linux and Metal on macOS. It is distinct from moving inference into the browser. Its plugin and core runtime must be packaged as a compatible, pinned pair. Current package metadata lists `onnxruntime-ep-webgpu` 0.4.0 alongside the project's ONNX Runtime 1.30.0; platform wheels exist, but their presence is not application qualification. [Native WebGPU documentation](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html), [plugin package metadata](https://pypi.org/pypi/onnxruntime-ep-webgpu/0.4.0/json).

The current Sherpa 1.13.8 provider parser accepts CPU, CUDA, CoreML, XNNPACK, NNAPI, TensorRT, DirectML, SpacemiT and OpenVINO; it does not accept WebGPU. An unknown provider falls back to CPU. Registering a plugin in the Python ONNX Runtime session used by Kokoro does not retrofit the separately managed Sherpa sessions. Reusing WebGPU there requires upstream integration or another carefully qualified adapter. Prefer a small upstream change over maintaining a private speech engine fork. [Pinned provider parser](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/provider.cc), [pinned session implementation](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/session.cc).

DirectML remains useful for broad Windows GPU compatibility, including AMD. It is in sustained engineering, while new Windows-specific development moves to Windows ML. DirectML requires sequential ONNX execution with memory patterns disabled. It should be a contained compatibility adapter, not the cross-platform architecture. [DirectML documentation](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html).

Windows ML is worth evaluating for modern Windows, but its downloadable provider catalog requires Windows 11 24H2 or later and has vendor/driver restrictions. Download-on-demand also needs explicit preparation for offline use. The documented AMD MIGraphX catalog entry requires RDNA 3 or later; the RX 6600 XT reference machine must not be assumed compatible with that path. Windows ML cannot replace a cross-platform baseline. [Windows ML execution providers](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/supported-execution-providers?tabs=winml2).

Do not build a new ONNX speech plan around the old ROCm execution provider: ONNX Runtime removed it starting with 1.23. Vendor-specific CUDA, MIGraphX, OpenVINO and NPU support should be added only where measured gains justify another compatibility surface. [ROCm removal notice](https://onnxruntime.ai/docs/execution-providers/ROCm-ExecutionProvider.html), [CUDA dependency requirements](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html).

Replacing Kokoro and Sherpa with a single speech framework is not an immediate simplification: voice mixing, measured phoneme/word timing, streaming state and cancellation all need migration evidence. whisper.cpp is another maintained GPU-capable recognition option, but its microphone streaming example uses repeated transcription windows; it is not automatically equivalent to the existing streaming transducer. [whisper.cpp](https://github.com/ggml-org/whisper.cpp).

## What the local experiment established

The isolated experiment used the public, SHA-verified alpha Kokoro model and voice bundle, the approved `bambi_classic` embedding fingerprint, the same neutral sentence and speed, and two profiled synthesis runs in independent CPU/WebGPU processes. No model weights were downloaded; the application, existing environments and delivered installers were unchanged. The plugin wheel was downloaded separately and SHA-256 verified before loading.

Hardware was the Linux Ryzen 5 5600X/Radeon RX 6600 XT reference machine. WebGPU reported a physical GPU device with AMD vendor ID `0x1002`, device ID `0x73ff`, PCI address `0000:08:00.0`. ONNX profiling recorded 3738 WebGPU kernel events and 2192 CPU events across its two runs, so this was actual mixed-provider execution.

| Observation | CPU | Native WebGPU |
| --- | --- | --- |
| Session creation | 817 ms | 1063 ms |
| First synthesis | 941 ms | 1636 ms |
| Second synthesis | 896 ms | 1429 ms |
| Generated audio duration, each run | 2.944 seconds | 3.725 seconds |
| Phoneme / aligned word timing count | 54 / 10 | 54 / 10 |

Both paths produced finite non-silent audio and the same approved voice fingerprint. However, the approximately 26.5% audio-duration difference means output equivalence has not passed. Equal timing counts do not establish equal timings or audio. The WebGPU candidate must remain disabled by default until the discrepancy is understood and semantic/audio acceptance passes.

These are diagnostic observations from one short sentence with profiling enabled, not a statistically controlled benchmark, a full conversation test, a physical listening assessment or Windows/macOS measurements. They show why an automatic GPU preference for every speech service would be premature. The isolated reports and profile traces remain under ignored `.runtime/ai-runtime-research-2026-10-08/`.

## One selection and recovery policy

The following describes the overall target. Core chat discovery, fitting, startup/inference checks, reporting and bounded fallback are implemented in source. Persistent driver-aware capability caching, measured speech selection and the broader hardware matrix remain future work. The delivered installer has not been replaced by these source changes:

1. Inventory the exact OS, architecture, runtime versions, GPU identities and drivers. Map actual backend device IDs to hardware; never assume adapter zero is the fastest device on a laptop. Verify local model assets before probing.
2. Run bounded public-fixture probes in owned worker processes. Probe loading, actual inference and cancellation, not just library import. A missing driver, unsupported operator, crashed worker or incorrect result makes that candidate unavailable.
3. Admit chat first with the full required context and a reserve for the desktop/audio pipeline. Use the measured allocation of the exact model/backend. GGUF file size alone does not represent all runtime memory. Prefer full GPU offload when it fits; then qualified partial offload; finally CPU if RAM and measured latency allow it.
4. Preserve model/context/prompt invariants during adaptation. Do not let a memory-fitting heuristic silently lower context, truncate prompts or select another model. llama.cpp exposes fitting controls, but their behavior must be pinned and checked against the required context. [Server fitting options](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
5. Start speech on its known CPU baseline. Enable a qualified GPU candidate only if concurrent chat/recognition/synthesis trials improve end-of-utterance-to-first-audible-response latency without recognition lag, playback underruns or memory pressure. CPU/GPU transfers and graph partitions are part of that measurement. [ONNX I/O binding](https://onnxruntime.ai/docs/performance/tune-performance/iobinding.html).
6. Cache a bounded capability result keyed by model hash, runtime/backend version, OS/architecture, device and driver. Invalidate after relevant updates or device loss. Avoid a long benchmark at every start. Offer simple Automatic and CPU modes; keep engineering knobs out of the normal setup flow.
7. On failure, cancel the active task and audio queue, stop only owned processes, then attempt a bounded fallback between turns. Do not automatically replay a reply that already became audible. Reset recognition state before reuse and prevent old provisional text from becoming a committed utterance. Quarantine a failing GPU path for the current configuration instead of repeatedly restarting it.
8. If the unchanged model cannot fit or meet usable latency, keep sample/Studio/text controls working and explain the unavailable capability. Do not promise CPU fallback can make insufficient RAM or arbitrarily weak hardware usable.

## Maintenance and qualification

Keep application contracts shared across platforms: chat/token counting, timed synthesis, streaming recognition, health/device reporting, cancellation and ownership. Keep platform-specific loading, provider options and dependency inventories inside adapters. Retain the current packaged Python worker while this abstraction is introduced; a simultaneous language/engine/model rewrite would expand the acceptance surface.

Pin native runtimes, provider plugins, model files and redistributables in a common manifest. Ship the matching required libraries, licenses and source in native per-platform builds. Optional acceleration bundles should be verified and activated atomically through the existing explicit setup flow, with a known-working rollback path. Users should not install CUDA SDKs, Python or compilers themselves. Offline restart must use already prepared assets and never depend on an unannounced provider download.

Define support as tested OS/architecture/backend combinations. Windows 11 x64 and Linux x64 are existing targets; Apple Silicon/macOS is the next distinct native target. Current ONNX Runtime 1.30.0 PyPI wheels require macOS 14 for arm64 and use manylinux 2.28 on Linux. ARM Windows/Linux, Intel Macs, older OS versions and mobile/browser clients need separate dependency and acceptance decisions. Engine portability alone does not provide installers, permissions or enough memory on every device. [ONNX Runtime package metadata](https://pypi.org/pypi/onnxruntime/1.30.0/json).

Run inexpensive contract, native loader, model-transfer and lifecycle cases in normal CI. Record separate hardware qualification for AMD/NVIDIA/Intel and Apple Silicon; CPU-only hosted runners do not establish GPU support. Test multilingual requirements separately: the current streaming asset is English-only. Add concurrent-load, low-memory, unplugged-device, sleep/wake, driver-failure, permissions-denied, damaged-download, offline restart and update rollback cases to the supported-target matrix. Capture public-fixture timing/resource evidence without collecting private conversations or recordings.

Implementation order: shared controller and truthful capability reporting; unchanged full-model Windows GPU/CPU reference acceptance; bounded memory-aware selection and recovery; speech acceleration qualification; native macOS packaging; additional vendor optimizations only after evidence. The present research supports this direction, not a promise that every machine can run all three models on its GPU.
