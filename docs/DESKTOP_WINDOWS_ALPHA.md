# Windows x64 local AI alpha qualification

The preserved Windows `0.1.0-smoke.5` installer passed 21 application checks and five NSIS install/reinstall checks on Windows Server 2022 in run `37684622643`. The Linux alpha is a separate implementation reference. Neither establishes Windows local AI, physical audio or GPU support.

## Work order and evidence

1. Build a small native runtime slice on the standard Windows runner. Freeze the existing Kokoro and streaming workers with a fresh pinned CPython environment and hash-verified Windows wheels. Relocate the services outside the checkout, remove external tools from PATH, synthesize the approved voice, inspect real PCM/captions and stream those samples through the real recognizer. Check the selected llama server's loader and required options without substituting a smaller chat model. Upload only bounded public-fixture evidence.
2. Assemble a new immutable per-user `0.1.0-alpha.N` installer using the same native builder. Preserve full authored prompts, the 24576-token model context, approved voice fingerprint, DSP, timing and cancellation. Ship runtimes and source/notices; install reviewed public model data explicitly through Setup.
3. Repeat the existing application and NSIS checks. Extend native checks to sample/Studio without AI, setup progress/cancel/retry/hash rejection, real speech, separate controls, crashes, persistence and offline restart. State test conditions and coverage per check.
4. Qualify the unchanged full model on a suitable Windows reference machine: real text/spoken conversation, GPU offload logs, CPU fallback, microphone/headphones, received-download security and resource/latency measurements. A standard two-core, 8 GiB runner is not the reference machine. Do not truncate prompts or context to make CI pass.
5. Deliver the actual installer with hashes, matching source, licenses, capability record and short guide. Mark unperformed reference checks as pending, never passed. Keep the goal incomplete until required reference evidence exists.

## Invariants

Native runtime slice `37723827630` passed on Windows Server 2022 (two logical CPUs, 8 GiB). The frozen approved Kokoro voice produced nonzero PCM and existing DSP/word timings; the frozen recognizer emitted real partial/final recognition, reset cancellation and clean EOF shutdown. Relocated Unicode paths and an empty external PATH passed after giving only the frozen speech process an UTF-8 active code page. This is native speech evidence; no full chat model, GPU, physical microphone or listening result is inferred.

The larger private alpha package uses sequential temporary artifact parts when it exceeds the confirmed remaining shared allowance. The local receiver verifies the GitHub ZIP digest, matching run/source manifest, each part and reconstructed payload hashes, and flushes local files to disk before removing only the new temporary part. The next upload requires its predecessor's receipt and a fresh storage inventory, with 50 MiB reserved for other shared storage and archive overhead. Existing Smoke/Linux artifacts are preserved. GitHub's zero-spend blocking budgets remain active; a quota rejection stops transport rather than enabling paid usage. Keep local transfer receipts with the final handoff.

Testers require no Node, Python, Git or compiler. Model downloads remain explicit, pinned and bounded, with atomic activation, progress, cancellation and retry. Sample and prepared Studio playback remain available without setup. Audio Mute only silences output; Mic Mute releases capture; End session cancels session work and capture; Quit terminates the owned services. Windows Job Object ownership protects unrelated processes. Preserve renderer sandboxing, application Host/Origin checks and Windows security controls.

Use only the authorized private repository and standard free runners. Verify actor/account ID `337824705`, remaining included minutes, shared storage and zero-spend blocking budgets before writes. Retain the old qualified artifacts. Do not upload model data, profiles, recordings, conversations, tokens or service logs. Publish no releases and change no visibility or default-branch history.
