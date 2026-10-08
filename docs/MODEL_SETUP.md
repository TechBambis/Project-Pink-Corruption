# Model setup

The first-run flow saves **Privacy & access** choices, then opens model setup. Reopen it under **Extras → Local AI models & setup** or `/setup`. Hardware recommendations estimate memory fit; actual acceleration and speed require a runtime check.

## Catalog

`config/local-model-catalog.json` pins IDs, revisions, sizes and hashes. Chat sizes exclude speech/cache/staging:

| Model | Download | Setup status |
| --- | ---: | --- |
| Qwen3.5 9B, HauhauCS, Q4_K_M | 5.63 GB | Default; existing Linux reference alpha evidence |
| Qwen3.5 9B, Defiant Fable NEO, IQ4_XS | 6.40 GB | Explicit experimental opt-in; pinned download and native adapter |
| Qwen3.6 35B-A3B, HauhauCS, IQ3_M | 15.44 GB | Explicit experimental opt-in; substantial memory required |
| Gemma 4 E4B, HauhauCS, Q4_K_M | 5.34 GB | Listed; existing Ollama/development path, not desktop download |
| Qwen3.5 9B, RolePlay, Q4_K_M | 5.63 GB | Listed; separate qualification needed |
| Anubis Mini 8B v1, Q4_K_M | 4.92 GB | Listed; existing development path, long-context/cache adapter not qualified for desktop |

Downloadable desktop profiles use a 24,576-token context. Recommendations favor the reference 9B when it fits; experimental models need explicit opt-in. Installed Ollama models appear in development mode. Smoke packages cannot install/run AI.

## Downloads and existing files

Setup shows connecting, bytes/percentage/speed, SHA-256 verification, copying, preparation and failure separately. Downloads need both permission and a deliberate click. Cancel removes the active partial; Retry retains verified files. Transfers stop after 90 seconds without data. Closing the guide leaves a transfer running; Quit stops it. Polling loss preserves last confirmed progress and offers reconnection.

**Choose a model file / Add a model folder** uses the native chooser. Folder scans skip symlinks/dependency folders and are bounded to three levels/5,000 entries. Size matching discovers candidates; hashes verify activation. Choose symlinked cache files individually. Import copies supported GGUFs into the private store without changing originals; **Forget location** removes only a reference. Arbitrary models/quantizations are not executed. Missing speech assets keep preparation unavailable.

Selection persists and assets are reverified on startup. Switching is blocked during setup/conversation. Permissions, model paths and source references stay outside shared settings files.

## Windows and tests

GPU detection uses bounded absolute System32 probes; AMD detection does not require NVIDIA tools. CIM AdapterRAM is not trusted for modern VRAM. Runtime offload evidence is separate from detected adapter identity.

Run `npm run test:model-setup` and `node scripts/desktop-audio-browser-check.mjs` after building/installing Chromium. Fixtures exercise flow/transfer states and tick PCM at 44.1/48 kHz; they do not download a real model or establish driver/audio quality. Native package checks qualify their exact bytes.

## Anubis development profile

`python3 scripts/setup-anubis.py` verifies the pinned [Anubis Mini Q4_K_M](anubis-model.json) weights and links an existing Ollama blob without downloading/replacing it. The native profile uses 65,536 tokens, Flash Attention, six CPU threads and a q4_0 KV cache; advertised model capacity is 131,072. It is a development profile, not a qualified desktop option. The complete selected character is retained; preparation rejects an insufficient context budget.
