# Bambi Local alpha.42 candidate

This candidate builds on alpha.41 and retains its Windows installer and portable ZIP, Linux packaging, Apple Silicon sources, model setup, settings transfer and profile backups.

## Changes

- Add the selectable Bambi Companion focused character, shared speaking style and connected Guided story development. Classic, Gentle, English Conversation and Custom remain selectable.
- Admit complete spoken thoughts before display and synthesis, retain separate main/inner voice roles in heard history, and bound corrective generation and cancellation.
- Add an optional React renderer for the local player (`?ui=react`), using the existing runtime for transport, audio, input and settings. The existing renderer remains the default.
- Preserve character and journey selections through validated saves, portable settings and profile restart. Ordinary preference saves cannot activate runtime preparation options.
- Retain bounded native ownership and improve GPU offload evidence when an auxiliary model reports its own smaller layer count.
- Restrict Git candidates and corresponding-source snapshots to the local application owners. Ordinary scene acceptance generates synthetic effects and needs no private recordings.

## Verification and release state

Source verification covers TypeScript, the automated suite, production UI build, isolated player/chat/audio/setup checks, settings migration and transfer, profile backups, Guided planning and connected-story playback. Synthetic inference and silent or generated WAV fixtures verify integration; they do not establish real model quality, physical listening or device operation.

Native packages must be built from the same frozen source and checked on their own target. A successful source build does not qualify Windows, macOS, offline AI, physical microphone/speaker behavior or recipient installation. Keep the existing alpha limitations until fresh evidence is recorded for each finished package. No automatic update delivery is introduced.
