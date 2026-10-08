# Local AI models and first-run setup

Desktop AI builds offer a three-step guide on first use: inspect the computer, compare models, and explicitly install/prepare a selection. Choose **Set up later** to keep using playback without AI. The choice is stored with the app profile; it is separate from ordinary settings saves. Reopen the same guide under **Extras → Local AI models & setup**, or visit `/setup`.

The [Privacy & access](PRIVACY_ACCESS.md) choices appear first. Model downloads require their own permission as well as a deliberate transfer click. Offline copying and verified installed models remain usable without download permission. You can open Privacy & access from the model guide to change this choice.

Hardware detection considers RAM, measured GPU memory and Apple unified memory. The recommendation reserves memory for the OS, speech and the renderer and includes a conservative context/cache estimate. It is not a speed benchmark. A model whose configured context cannot hold the full default companion prompt is excluded from recommendations. A real generation/memory check is still needed. Unknown GPU memory is not presented as proven acceleration.

## Current catalog

`config/local-model-catalog.json` is the packaged catalog. Pinned revisions, hashes and file sizes match the existing research pins; upstream metadata was checked on 2026-10-08 without downloading the weights. Sizes below are decimal GB for the chat weights, excluding speech, caches and staging.

| Model | Download | Setup status |
| --- | ---: | --- |
| Qwen3.5 9B, HauhauCS, Q4_K_M | 5.63 GB | Default; existing Linux reference alpha evidence |
| Qwen3.5 9B, Defiant Fable NEO, IQ4_XS | 6.40 GB | Explicit experimental opt-in; pinned download and native adapter |
| Qwen3.6 35B-A3B, HauhauCS, IQ3_M | 15.44 GB | Explicit experimental opt-in; substantial memory required |
| Gemma 4 E4B, HauhauCS, Q4_K_M | 5.34 GB | Listed; existing Ollama/development path, not desktop download |
| Qwen3.5 9B, RolePlay, Q4_K_M | 5.63 GB | Listed; separate qualification needed |
| Anubis Mini 8B v1, Q4_K_M | 4.92 GB | Listed; existing development path, long-context/cache adapter not qualified for desktop |

Installed Ollama models are also listed when their local backend reports them, retaining available size metadata. Their configured prompt/context compatibility and runtime status remain visible. The catalog is not a claim that all six models have passed the desktop conversation checks.

The three downloadable desktop profiles use a 24,576-token context and immutable upstream URLs, size limits and SHA-256. The two experimental profiles have not received new physical/native generation qualification as part of this UI change. First-run recommendations favor the reference model when it fits. Speech assets are shared and reused. Downloads require a deliberate click, use the existing bounded/verified installer and keep earlier model files when changing selection. Switching is refused while setup or conversation work is active. Selection persists under the private model directory; files are rechecked rather than trusting that selection record as proof of installation.

Development mode downloads chat weights into `models/community`; speech remains the existing development setup. Packaging smoke builds display an explicit playback-only notice alongside the catalog; they cannot install or run AI. No disabled action implies a download has started. Existing alpha executables do not gain this change automatically: rebuild an immutable package and qualify the new assembled artifact before handing it out.

## Live setup and existing model locations

On first launch of an AI-enabled desktop build, access choices are saved **before** the model guide opens. No transfer starts automatically. Reopen the guide in **Extras → Local AI models**. Setup resumes the selected model and install step when a transfer is active or files are already verified.

The install step distinguishes selection, connecting, downloading, checking SHA-256, copying, missing speech files, starting the runtime, cancellation and failure. Transfers show byte counts, percentage and an observed speed/rough ETA. File verification shows its own per-file progress and does not count as download speed. Network transfers stop after 90 seconds without data; previously verified assets remain available for retry. An interrupted asset is downloaded again; partial-byte resume is not claimed. Lost polling retains the last confirmed progress, disables new starts and reports reconnection instead of silently hiding the error. Closing the guide leaves a started download running in the backend. Quitting the app stops it.

Use **Choose a model file** or **Add a model folder** in the native app to register existing locations. The path comes from Electron’s file dialog, and registration requires the app’s private instance token; renderer requests cannot register arbitrary filesystem paths. Locations persist in the private model profile. A folder scan searches up to three nested directory levels / 5,000 entries, skips symbolic links and common dependency directories, and lists matching desktop catalog sizes. Size matching is only discovery: SHA-256 verification is mandatory before activation. Choose symlinked cache files individually through the native file dialog instead of broadening the folder boundary.

Import copies a matching GGUF to the private app model store; originals and external repositories are never changed. **Forget location** removes only the app’s reference. A renamed copy of the exact supported quantization works. Other architectures, models or quantizations are reported as unsupported rather than assigned a guessed runtime profile. This feature does not move the app’s model store or execute arbitrary GGUF files. If only the chat GGUF was imported, the guide explicitly shows the remaining speech download; Start stays disabled until all assets are verified. **Import complete model and voice folder** retains the existing offline data-bundle import path.

## Windows graphics and audio

Desktop services intentionally receive a restricted PATH. GPU discovery uses absolute Windows System32 paths for Windows PowerShell and NVIDIA’s tool, with a bounded CIM query and a present-display-device fallback. AMD names do not depend on NVIDIA’s tool. CIM’s `AdapterRAM` is a 32-bit field, so it is deliberately not used as modern VRAM evidence. Detected graphics identity, unknown VRAM and verified runtime offloading remain separate facts. See [Microsoft’s Win32_VideoController documentation](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-videocontroller). A physical AMD driver/offloading check remains necessary on the target PC.

Public tick samples and local recording requests now accept the app’s actual loopback port rather than requiring port 6969. The app marks its own HTML documents; extension overlays on third-party documents do not request these recordings. The metronome continues to use looping buffers on the AudioContext clock. An isolated Chromium PCM test verifies the same shipped tick sample and 60 BPM at 44.1 and 48 kHz on a non-default port. It does not measure speakers, Windows driver latency or subjective timbre.

## Validation

Run `npm run check`, `npm test`, `npm run repo:check` and `npm run test:model-setup` (with Playwright Chromium installed). The browser check uses a temporary profile and real isolated server, rejects arbitrary model IDs, exercises the desktop first-run flow, explicit experimental consent, remembered dismissal, saved selection, settings reopening and the small-screen layout. It intercepts the multi-GB transfer request; it does not claim model download or generation qualification. Existing downloader tests verify bounded transfer, hashing, cancellation, retry, stalled-connection cleanup, partial speech setup and path boundaries with small fixtures. Model-location tests use sparse metadata fixtures; the browser fixture fixes total RAM at 32 GiB so a small CI runner can exercise permitted transfers. Browser source selection, transfer states and import completion are explicitly simulated. Recommendation tests separately cover insufficient RAM and unknown VRAM. No large model is downloaded or qualified by these tests. Run `node scripts/desktop-audio-browser-check.mjs` after installing Playwright Chromium for the rendered PCM check.

The native alpha acceptance scripts use stable setup phase attributes and visit the install step explicitly. Run those checks on each newly built target; previous release records qualify their original artifacts only.
