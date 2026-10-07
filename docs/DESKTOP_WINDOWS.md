# Windows x64 desktop build and acceptance

The Windows port is prepared for native build and qualification. No Windows installer or Windows conversation has been qualified by the Linux development checks. The existing Linux `0.1.0-alpha.1` handoff is a separate, preserved reference.

## Build on native Windows x64

Extract the reviewed source snapshot into a writable local directory. Use Windows 11 x64 and an ordinary user account. The build bootstrap downloads its checksum-pinned Node tool into `.runtime`, installs locked npm dependencies, and runs the native builder. It does not install tools globally or change PowerShell execution policy. Build tools are for the build host; testers receive bundled runtimes.

From Command Prompt in that source directory:

```bat
scripts\desktop-windows-build.cmd smoke 0.1.0-smoke.4
```

This first milestone includes Electron, bundled Node 24.18.1 with SQLite, private user data, the original offline chimes, and the native process ownership helper. It excludes local AI runtimes. Allow at least 2 GiB free for the build; installed size is determined by the actual build.

Run the packaging acceptance before adding speech and inference:

```bat
.runtime\desktop-windows-tools\node-v24.18.1-win-x64\node.exe scripts\desktop-windows-install-check.mjs "dist\desktop-windows\0.1.0-smoke.4"
```

Then build the full alpha:

```bat
scripts\desktop-windows-build.cmd alpha 0.1.0-alpha.2
```

The alpha creates a fresh uv-managed CPython 3.12.13 environment on Windows and freezes the locked Kokoro/ONNX/streaming services there. It retains the reviewed llama server, CPU variants, optional Vulkan libraries and notices from the checksum-pinned acquisition archive. It does not package an Ollama daemon, CUDA tree, model weights, developer venv, credentials, conversations or recordings. Allow at least 6 GiB free for the build tree and downloads; model setup needs additional space for the reviewed assets and staging reserve. The builder checks native x64 PE headers and normal/delay DLL imports. Vulkan additionally needs the actual driver's `vulkan-1.dll`; that optional driver dependency is recorded separately. Static import closure does not replace native loader/service tests.

Version outputs are immutable. For another attempt after an output has been created, use a new suffix. If a build was forcibly interrupted, `.runtime/desktop-windows-build.lock` may remain: verify the PID recorded there has stopped before removing that single stale lock. Never remove an active build's lock.

Each successful native build writes `dist/desktop-windows/VERSION/` with a per-user NSIS installer, matching application source, runtime manifest, notices, tester guide and SHA256SUMS. The matching source includes the actual worktree inputs; it does not assume a clean Git checkout. The manifest records `built-unqualified`; building does not certify install, audio, GPU or conversation behavior.

## Native automated acceptance

The installer check installs the actual NSIS executable into a fresh path containing spaces and Unicode, verifies the installed resources and executable against the packaged files, and runs the application acceptance below. It then uninstalls, reinstalls and uninstalls again while checking retention of the disposable fixture database. `INSTALLER-CHECK.json` records these outcomes separately from the application evidence. Silent installation on an administrative hosted Windows Server runner does not qualify ordinary-user Windows 11 installation or browser-received download security.

The check copies an unpacked app outside the repository when needed, launches from a directory containing spaces and Unicode with an empty PATH, and records evidence under `%LOCALAPPDATA%\Bambi qualification`. Test tooling remains on the build/qualification host. It audits source/runtime/shell hashes and PE architecture, SQLite, private NTFS ACLs, sample output PCM, pause/resume, audio mute, End session, persistence, single ownership, ordinary Quit, killed Electron/backend/supervisor/guard, unchanged resources and an unrelated process/listener canary. It does not read private service command lines into its saved evidence.

Run packaging acceptance on the alpha too, then test the reviewed public model data through Setup's folder chooser:

```bat
.runtime\desktop-windows-tools\node-v24.18.1-win-x64\node.exe scripts\desktop-windows-check.mjs "dist\desktop-windows\0.1.0-alpha.2\win-unpacked\Bambi Local.exe"
.runtime\desktop-windows-tools\node-v24.18.1-win-x64\node.exe scripts\desktop-windows-ai-check.mjs "dist\desktop-windows\0.1.0-alpha.2\win-unpacked\Bambi Local.exe" "D:\Reviewed model data"
.runtime\desktop-windows-tools\node-v24.18.1-win-x64\node.exe scripts\desktop-windows-ai-check.mjs "dist\desktop-windows\0.1.0-alpha.2\win-unpacked\Bambi Local.exe" "D:\Reviewed model data" --cpu
```

These native AI checks cover verified copying, real text and spoken replies, the unchanged `bambi_classic` voice and preset, synthetic microphone recognition, separate audio/mic controls, End session, eight spoken turns, runtime cleanup, model reopen, timings and sampled owned process resources. Both accelerator runs are required to assess Vulkan and CPU separately. A GPU name is not proof of offloading. Record the actual llama offload log lines and conversation result. Working set, private commit and CPU counters have different meanings; the evidence describes the sampling method and limitations. Save complete preparation and first-playback times, hardware, Windows build and driver versions. Do not substitute Linux measurements.

## Tester flow and remaining qualification gates

Receive the actual NSIS installer through the intended download route. Compare its SHA-256 with the supplied sums. Install for the current user without administrator elevation. The application requires no Node, Python, Git or compiler installation. Verify normal launch from Start, including paths containing spaces and Unicode. Resources are treated as immutable and audited for changes; database, cache, models and logs are placed under `%LOCALAPPDATA%\bambi-local-alpha` (smoke uses `bambi-local-smoke`). Explicit `--bambi-user-data` paths must be dedicated empty directories or already owned Bambi profiles; unrelated existing data is retained.

Keep Windows Defender, SmartScreen, Smart App Control and the Chromium sandbox enabled. If the received unsigned artifact is blocked by the actual machine policy, record that result; it is a failed received-artifact gate and needs an eligible signing/distribution route. Do not disable protection to claim success. Microsoft distinguishes [SmartScreen reputation and code signing](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

Complete and record these additional checks on the target:

- Run the actual installer and uninstaller. Reinstall and verify retained profile data. Test received-download security behavior separately from an unpacked build.
- Play the included sample before Setup, after canceled or failed Setup, and after reopen. Import, preview and export `/samples/studio-chimes.bambi.json` in Studio on the alpha.
- Start the actual model download; cancel during transfer; confirm partial cleanup, retained verified assets and a useful retry. Independently test the folder-copy path. Damage a disposable copied asset, reopen, and confirm readiness is rejected until repair. Never damage the source model data.
- Cancel model preparation and a spoken reply; verify generation and microphone output stop and canceled speech does not replay. Inject a stalled supervisor/main process using a scoped native test tool and verify the independent guard cleans only its job after owner death.
- Disconnect the network using normal user controls. Reopen with installed models, play the sample and complete a local conversation. Record isolation conditions; a reopen on an online host is not an offline test.
- Test a physical microphone and speakers/headphones, listening quality, controls, denied permission, sleep/wake and device changes. The synthetic microphone and nonzero PCM checks do not replace these observations.
- Confirm GPU offloading and CPU fallback on the reference machine; record driver versions, full 24576-token context, authored prompt preservation, peak resource observations and warm first-audio latency.

The backend/services enter a private Windows Job Object with kill-on-close. A helper outside that job watches Electron and supervisor handles independently. Only the packaged backend's process tree is assigned; no global process search or taskkill operation is used. This design follows [Microsoft's Job Object ownership semantics](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), but native fault tests remain the evidence needed to qualify this particular implementation.

## Optional private CI

The manual Windows workflow requires the user's explicit authorization to push, dispatch and retain private artifacts. Before GitHub writes, verify the authenticated user has numeric ID `337824705`. Before any private CI run, inspect actual remaining GitHub Free Actions and shared artifact storage allowances plus zero-spend budgets that prevent further paid usage; record the check time, account and available allowance. Use standard runners only, no paid upgrades or extra quota. The workflow has no automatic trigger, no publishing step, no model download, no dependency cache, and no artifact upload by default. Upload only the installer, matching source, notices, manifests, guide, hashes and qualification evidence if explicitly requested and their measured size fits the confirmed remaining shared allowance. Artifacts expire after one day. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

On the separate `build/windows-smoke-*` branch, `cla.yml` is a manual dispatch entry point that calls `desktop-windows.yml`; GitHub requires a dispatchable workflow path already registered on the default branch. The default branch's CLA workflow is preserved. The build branch excludes itself from automatic source CI. Only the explicitly dispatched, bounded Windows job runs. CI records native install and application outcomes without uploading profiles, process command lines or private service logs; reference-PC qualification remains separate.
