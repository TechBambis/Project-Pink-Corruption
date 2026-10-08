# Dual Voice

Enable **Voice & AI → Voice blend & persona → Dual Voice** to add a distinct, softer Bambi voice to generated guided passages. The preference is off by default and saved with the local profile. It works with Classic and Situational conversation styles. Ordinary questions and conversation retain the main voice. Existing recordings and authored event narration use their original audio.

The main voice remains the selected voice or blend and speed. Bambi uses `af_bella` at speed `0.7` and pitch `+1` semitone; selecting Bella alone for the main voice instead uses Heart for Bambi. During Dual Voice passages the main voice uses pitch `-2`, centered pan, and no duplicate voice layers or echoes. Both voices share one resident Kokoro model and the existing cancellable renderer queue, avoiding duplicate model memory. Their independent playback settings are applied after synthesis.

| Phase | Main voice | Bambi voice | Writing direction |
| --- | ---: | ---: | --- |
| Induction | 0 dB | −14 dB | 1–2 short fragments |
| Deepening | 0 dB | −12 dB | 3–4 short fragments |
| Conditioning | −2 dB | −10 dB | 5–6 short fragments |
| Anchor | −4 dB | −6 dB | Full Bambi sentences; one brief main phrase |
| Awakening | −8 dB | −6 dB | Bambi closes; one final main word |

Levels are relative to the existing voice bus and user fader. Each background fragment alternates left/right pan (`−0.3`, `+0.3`). A short room effect uses three decaying taps ending at 200 ms with a combined wet gain of −18 dB. Mono output centers pan and retains the lower level and room effect. Phase settings are captured when the passage is requested; subsequent passages use the current phase.

## Script format

```text
[owner] Rest here. [pause:long]
[bambi:…so warm…]
[owner] Stay here. [pause:medium]
[bambi] I feel soft. [pause:normal] I feel warm.
[owner] Good girl. [pause:long]
```

Both inline `[bambi:...]` fragments and `[owner]`/`[bambi]` blocks are recognized across streaming token boundaries. Inline fragments return to the main voice; blocks remain Bambi until the next role marker. Untagged text is the main voice. The model receives the dual protocol and current phase guidance as runtime prompt additions, preserving pinned upstream JSON and attribution.

Bambi fills an available trailing main-voice pause of at least 900 ms, after any main-voice effects. The dual-voice response holds a bounded six-phrase audio lookahead so Bambi can be prepared before a main-voice pause passes. A late fragment starts at the current audio clock. If no eligible pause exists, the engine reserves a new gap after the main phrase. Long fragments extend the gap; the next main phrase waits until the full fragment and its room tail finish. There is no simultaneous spoken overlap and no cropping to fit a short pause.

Background ellipses are styling, rather than extra pauses. Background fragments cannot execute sounds, hardware controls or trigger effects. A background fragment containing a known selected trigger is discarded. Disabling Dual Voice drops background fragments before synthesis. Voice markers do not appear in captions or speech; background words count toward passage word limits. Pause, interruption and Stop use the same transport as ordinary speech, and Stop disconnects both voice tracks and room tails.

Fragment counts and wording are prompt guidance, not a guaranteed model quota. This feature describes audio presentation; it does not establish a psychological effect.

## Verification

- `npm run check`, `npm test`, `npm run repo:check`, `npm run build`.
- `node scripts/dual-voice-check.mjs` after building: isolated production server and browser with deterministic inference/WAV fixtures, enabled/disabled playback, timing, saved preference, Stop, desktop/mobile layout and screenshots in ignored `runtime/`. Set `BAMBI_BROWSER_BINARY` if using an existing Chromium executable instead of Playwright's default headless shell.
- `tests/dual-voice.test.ts` covers marker boundaries, phase levels, routing, cancellation, renderer settings, Mono, background trigger rejection and passage counting.

Local validation also rendered a real four-phrase Kokoro passage with both voices, valid WAV output, model word timings and alternating background pan metadata. Audio samples and reports remain outside Git in `runtime/`.
