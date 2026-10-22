# Settings & presets

Open **Extras → Settings & presets**.

- **Export settings:** review the file before saving. Personal text is included; machine settings are optional.
- **Save named preset / Share current preset:** portable audio, visuals, triggers and session settings. Personal text is off by default; machine settings are excluded. Saving an existing name replaces it.
- **Import:** preview changes and choose sections. Apply stops the active session without starting AI, downloads or devices. Unavailable resources remain unchanged. Machine imports disable automatic device reconnect.
- **Undo last import:** restores the previous settings until another settings write.

The save indicator confirms server persistence. Failed saves retain a draft for retry; conflicting edits show **Save my changes** or **Use saved values**.

Ordinary updates reuse the existing profile; no export is required. Files exclude chats, memories, recordings, media, model data/paths, credentials, location and permissions. A shared preset does not guarantee identical AI output.

## Developer contract

`packages/settings/index.ts` owns validation/defaults; `transfer.ts` owns the file format. Files use `format: "bambi-settings"`, `version: 1`, `kind: "settings" | "preset"`, metadata and selected sections. Maximum size: **96 KiB**. Unknown fields, future versions and invalid values reject before writes. Version 0 is a supported flat compatibility input, not a previously shipped format.

Writes use the expected SQLite revision; stale writes return 409, invalid data 400 and storage failure 500. Imports atomically commit settings, revision and Undo snapshot. Request IDs make retries idempotent; Undo cannot overwrite later edits. UI drafts are scoped to profile/window. All preference writers share this contract.

Run `npm run check`, `node --import tsx --test tests/settings.test.ts` and `npm run test:settings`. The browser harness uses baseline commit `58b4887` for same-profile migration and tests transfer to a fresh profile. It needs Git history and Chromium. Native Windows↔Linux transfer remains an open tester check.

**Profiles & backups** in Extras supports offline share codes, personal settings files and password-encrypted backups. Chats/memories and library metadata are included only when explicitly selected. Preview before restoring; permission grants, device arming and computer-specific model paths do not transfer. Backups contain media metadata rather than the media files, which must be reselected. Keep the backup password separately.
