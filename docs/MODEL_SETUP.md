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

Development mode downloads chat weights into `models/community`; speech remains the existing development setup. Packaging smoke builds display the guide/catalog but cannot install or run AI. Existing alpha executables do not gain this change automatically: rebuild an immutable package and qualify the new assembled artifact before handing it out.

## Validation

Run `npm run check`, `npm test`, `npm run repo:check` and `npm run test:model-setup` (with Playwright Chromium installed). The browser check uses a temporary profile and real isolated server, rejects arbitrary model IDs, exercises the desktop first-run flow, explicit experimental consent, remembered dismissal, saved selection, settings reopening and the small-screen layout. It intercepts the multi-GB transfer request; it does not claim model download or generation qualification. Existing downloader tests verify bounded transfer, hashing, cancellation, retry and path boundaries with small fixtures.

The native alpha acceptance scripts use stable setup phase attributes and visit the install step explicitly. Run those checks on each newly built target; previous release records qualify their original artifacts only.
