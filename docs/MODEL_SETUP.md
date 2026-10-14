# Model setup & performance

For the [Alpha 41 desktop downloads](https://github.com/TechBambis/Project-Pink-Corruption/releases/tag/v0.1.0-alpha.41).

The first-run flow saves **Privacy & access** choices, then opens model setup. Reopen it under **Extras → Local AI models & setup** or `/setup`. Hardware recommendations estimate memory fit; actual acceleration and speed require a runtime check.

## Catalog

The [release model catalog](https://github.com/TechBambis/Project-Pink-Corruption/blob/v0.1.0-alpha.41/config/local-model-catalog.json) pins IDs, revisions, sizes and hashes. Chat sizes exclude speech/cache/staging:

| Model | Download | Setup status |
| --- | ---: | --- |
| Qwen3.5 9B, HauhauCS, Q4_K_M | 5.63 GB | Default; Linux reference alpha evidence |
| Qwen3.5 4B, HauhauCS, Q4_K_M | 2.71 GB | Experimental desktop choice for smaller systems |
| Qwen3.5 2B, HauhauCS, Q4_K_M | 1.27 GB | Experimental desktop choice for compact systems |
| LFM2.5 1.2B Instruct, Q4_K_M | 0.73 GB | Experimental CPU-focused desktop choice; fresh Linux download and conversation checked |
| Qwen3.5 9B, Defiant Fable NEO, IQ4_XS | 6.40 GB | Explicit experimental opt-in; pinned download and native adapter |
| Qwen3.6 35B-A3B, HauhauCS, IQ3_M | 15.44 GB | Explicit experimental opt-in; substantial memory required |
| Gemma 4 E4B, HauhauCS, Q4_K_M | 5.34 GB | Listed; existing Ollama/development path, not desktop download |
| Qwen3.5 9B, RolePlay, Q4_K_M | 5.63 GB | Listed; separate qualification needed |
| Anubis Mini 8B v1, Q4_K_M | 4.92 GB | Listed; existing development path, long-context/cache adapter not qualified for desktop |

Downloadable desktop profiles use a 24,576-token context. Recommendations account for RAM, dedicated or shared GPU memory and the selected model. Compact and balanced systems can be offered smaller models; an existing selection is retained. Experimental models need explicit opt-in, and smaller models can follow the full Classic personality less reliably. Try English Conversation for ordinary chat. Installed Ollama models appear in development mode. Smoke packages cannot install/run AI.

## Performance and memory adaptation

- **RAM-aware allocation:** compact, balanced and roomy profiles adjust prompt-cache size, checkpoints and batch sizes. Model-specific minimums remain in force; context and the selected companion instructions are retained.
- **Reusable prompt prefix:** fixed companion instructions and heard history are arranged separately from changing turn context, allowing the native engine to reuse its prompt cache across replies instead of invalidating the whole suffix.
- **CPU capacity for speech and the UI:** the ordinary inference thread plan leaves capacity for capture, synthesis and the renderer. A measured profile can use a different bounded thread configuration.
- **Actual acceleration:** CUDA/Vulkan paths on Windows/Linux and Metal on Apple Silicon are selected from native discovery. Runtime layer-offload evidence confirms whether the model used a GPU. GPU startup, driver or memory failures can fall back to another eligible path or CPU.
- **Memory checks before startup:** fit estimates include model, context, cache and speech reserves; CPU preparation also checks available RAM. Smaller models and an explicit Try anyway option are available. A fit estimate is not a speed measurement.

## Test performance on this PC

After verifying model files, open **Get AI & voice models → Install and start → Test performance**.

- Compare eligible CPU/GPU paths, CPU thread counts and bounded batch sizes using the selected companion instructions and full model context.
- Measure the first full-prompt turn separately from three follow-up turns, including first visible text, generation rate and memory. The optional voice test measures synthesis; it does not measure microphone-to-speaker delay or judge the voice.
- A winning configuration must also pass a fresh-load repeat before its settings are saved. Profiles stay local and are matched to hardware, driver/runtime, model, prompt and voice settings; stale or changed configurations are rechecked.
- **Compare chosen models** uses existing verified catalog files, requires experimental consent where applicable, starts no downloads and restores the original model selection.

These controls expose measurements for this PC; they do not promise a universal speedup or establish model quality. The test can be cancelled and does not save its synthetic conversations to chat history or play audio.

## Platform details and experimental controls

| Platform/option | What Alpha 41 provides |
| --- | --- |
| Windows x64 | CPU/Vulkan and bundled CUDA 12/13 runtime paths; bounded DXGI/System32 hardware probes, storage-upgrade and long-installation-path fixes; installer or portable ZIP |
| Linux x64 | CPU/Vulkan and bundled CUDA 12/13 runtime paths; use the Debian installer on Ubuntu 24.04 so the Chromium sandbox is installed correctly; AppImage qualified on Fedora |
| Apple Silicon, macOS 14+ | Native arm64 runtime and Metal discovery with a longer bounded cold-start probe; relocated speech libraries/data and macOS microphone-consent handling |
| Q8 KV cache | Explicit experimental Hauhau 9B option on Linux; standard cache remains the default. Stop active work before changing it |
| DFlash / MTP | Linux source/development experiments, disabled by default; not a qualified desktop acceleration feature or a proven first-speech speedup |

Actual NVIDIA hardware, full-model Windows/Mac conversations and physical microphone/audio still need recipient checks; see the release notes. Bundled CUDA libraries do not replace the system graphics driver. Windows is unsigned; Mac is not notarized.

## Downloads and existing files

Setup shows connecting, bytes/percentage/speed, SHA-256 verification, copying, preparation and failure separately. Downloads need both permission and a deliberate click. Cancel removes the active partial; Retry retains verified files. Transfers stop after 90 seconds without data. Closing the guide leaves a transfer running; Quit stops it. Polling loss preserves last confirmed progress and offers reconnection.

**Choose a model file / Add a model folder** uses the native chooser. Folder scans skip symlinks/dependency folders and are bounded to three levels/5,000 entries. Size matching discovers candidates; hashes verify activation. Choose symlinked cache files individually. Import copies supported GGUFs into the private store without changing originals; **Forget location** removes only a reference. Arbitrary models/quantizations are not executed. Missing speech assets keep preparation unavailable.

Selection persists and assets are reverified on startup. Switching is blocked during setup/conversation. Permissions, model paths and source references stay outside shared settings files.

## Windows and tests

GPU detection uses bounded absolute System32 probes; AMD detection does not require NVIDIA tools. CIM AdapterRAM is not trusted for modern VRAM. Runtime offload evidence is separate from detected adapter identity.

Run `npm run test:model-setup` and `node scripts/desktop-audio-browser-check.mjs` after building/installing Chromium. Fixtures exercise flow/transfer states and tick PCM at 44.1/48 kHz; they do not download a real model or establish driver/audio quality. Native package checks qualify their exact bytes.

## Anubis development profile

`python3 scripts/setup-anubis.py` verifies the pinned [Anubis Mini Q4_K_M](anubis-model.json) weights and links an existing Ollama blob without downloading/replacing it. The native profile uses 65,536 tokens, Flash Attention, six CPU threads and a q4_0 KV cache; advertised model capacity is 131,072. It is a development profile, not a qualified desktop option. The complete selected character is retained; preparation rejects an insufficient context budget.
