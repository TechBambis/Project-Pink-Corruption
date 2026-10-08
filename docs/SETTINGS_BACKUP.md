# Settings files and presets

Open **Extras → Settings & presets**. The settings status link is visible throughout Settings. A save is complete only after the local server acknowledges the SQLite revision. Failed saves retain a browser draft. **Retry saving** retries the current draft; overlapping edits from another window show **Save my changes** and **Use saved values**. Non-overlapping changes merge with at most two conflict retries. Each window retains its own draft; reopening can recover a retained draft for the same server profile.

**Export settings** flushes pending edits and previews the exact file contents. Personal text is included by default and shown in the preview. Machine settings are optional. **Share current preset** and **Save named preset** default to audio/voice, visuals, trigger timing/effects and session/conversation settings; personal text requires checking its section. Presets cannot include machine settings. Named presets persist in the current private profile, and saving the same name replaces its snapshot. Selecting a preset opens the same import review.

**Import settings or preset** validates the complete file before showing changed values and selectable sections. Cancel writes nothing. Apply stops the session, microphone, pending replies and device output; it does not prepare AI, download resources, connect devices or start playback. Unavailable model/voice/preset choices are shown and left unchanged; choose or install resources separately. Importing machine settings turns automatic device reconnect off. Only selected sections change. **Undo last import** restores the previous snapshot in one SQLite transaction and is available until another settings write. Duplicate retries with the same import request ID preserve the original restore point; importing already-identical values does not replace it.

Ordinary same-profile updates continue to reuse the private profile. Settings export is not required for an update. A settings file contains neither model weights nor chats, memories, recordings, media, access grants, saved location or credentials. Model folders/source paths belong to model setup. Media/library and authored Studio sessions keep their existing formats. This feature does not implement full database backup, cloud synchronization or arbitrary downgrade restoration.

## Shared registry and owners

`packages/settings/index.ts` inventories 138 ordinary settings with validators, defaults, categories and sections. It supplies the UI persistence list, HTTP validation and transfer schemas. Numbers from controls use canonical numeric strings; booleans remain booleans. `runtimeSettingsInventory` classifies derived controls, transient preview/transport fields and controls owned by other stores. Trigger category controls serialize through `trigger-timing-config`. Read-aloud, occasional replies and file-companion choices derive from `ai-mode`/`mode`.

| Category | Contents | Transfer |
| --- | --- | --- |
| Portable | Audio/voice, visual presentation, trigger timing/effects, session and conversation preferences; logical model IDs | Settings and presets |
| Personal | Bambi name, persona, guided style, collar text | Settings default; preset explicit opt-in |
| Machine-specific | Performance, recognizer/playback choice, device address/UUID, channel mapping, limits and calibration | Optional personal settings section only |
| Runtime-only/other owner | Device arming/manual commands, preview choices, transport position, file input, media notes, memory edits, UI searches | Excluded |

`device-auto-connect` persists for ordinary same-machine use but cannot be transferred. Machine-specific model paths/source references, access/location and histories are separate storage owners and excluded entirely. Imported data cannot grant access or arm actuators.

The `profile` SQLite key remains readable by existing runtime consumers. `settings-revision`, profile identity, last import operation and undo point live alongside it in the private preferences table. All preference writers (including startup migration, model selection, device disconnect and the Voice Lab) participate in the revision contract. Startup migrations preserve valid explicit model/speed choices. Acknowledgements include the new revision and actual saved snapshot. Stale writes return HTTP 409; invalid writes return 400; storage failures return 500. New UI drafts are scoped to the server profile identity and window. No browser local-storage snapshot silently overrides acknowledged server settings. Existing desktop smoke-check preference requests use the new envelope; packaging and desktop CI workflows are unchanged.

## File contract

Current format: `format: "bambi-settings"`, `version: 1`, `kind: "settings" | "preset"`, `name`, optional `description`/`appVersion`, `sections`, and informational `requirements`. Files are bounded to 96 KiB. Unknown fields, wrong sections, invalid ranges, external model paths/URLs and future versions are rejected. Resource references are data; requirements never initiate downloads. Personal files use `.bambi-settings.json`; presets use `.bambi-preset.json`, independently of Studio's session format.

The one supported older settings-file shape is version 0: `{format:"bambi-settings",version:0,kind,name,preferences:{...}}`. This flat envelope uses the known profile migrations for duration, visuals, narration style and dialogue defaults, then the current registry validators. Unknown or invalid legacy settings reject the file. Version 0 is a documented compatibility input, not a previously shipped backup feature. Format version is independent of application release version.

The backend import endpoint accepts the migrated version 1 envelope, selected sections, expected revision and a UUID request ID. The request commits profile, revision and restore point together. Undo requires exactly the import revision and cannot overwrite later changes. Repeating an operation ID with different content or after later changes returns a conflict.

## Verification

Run from the isolated feature worktree:

```sh
npm ci --ignore-scripts
npm run check
node --import tsx --test tests/settings.test.ts
npm run test:settings
npm run test:navigation
npm run test:integration
npm run repo:check
git diff --check
```

`BAMBI_BROWSER_BINARY` can select an installed Chromium. The settings browser harness runs real baseline source `58b4887`, replaces it with the feature server, retains the same temporary SQLite profile, model fixture and history, then tests a transfer to a new server database/browser profile. It checks real failed HTTP saves/reopening, tab conflicts, latest-edit export, previews, selected sections, cancellation, active-session stopping, undo, invalid/future/legacy files, missing resources, preset persistence/privacy, duplicate imports and mobile layout. Every transferable field passes import → UI → export, with more than 100 non-default values, including optional machine settings. Voice Lab saves and conflicts use the actual server. It forbids inference/download/capture/connection requests and active device/chat commands. Temporary data and ports are isolated; model data is an inert fixture and never loaded. Screenshots and reports stay under ignored `.runtime/settings-evidence/`.

Platform-neutral file tests cover Windows-style machine identifiers/paths and Linux-style paths, CRLF files, Unicode, logical resources, and exclusion of local source directories. **Open qualification: native Windows↔Linux transfer and installer updates.** The user approved completion with local browser, file and migration tests on 2026-10-08, leaving native Windows verification open because a separate Windows environment was unavailable. Native qualification requires the feature running on both native targets; Linux browser/schema results do not qualify a Windows installer or physical audio/device behavior. The separate desktop packaging work remains unchanged.
