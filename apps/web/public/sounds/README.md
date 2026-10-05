# Local trigger sound files

These are original deterministic synthesized sound effects, dedicated under **CC0-1.0**: https://creativecommons.org/publicdomain/zero/1.0/

- `finger-snap.wav`: a short noise transient and damped resonances, centered.
- `windshield-wiper.wav`: five seconds of repeated friction/squeak strokes moving left/right.
- `balloon-pop.wav`: a short generated noise burst.
- `balloon-inflate.wav`: 2.2 seconds of shaped air noise and stretching resonances.
- `balloon-squeak.wav`: a short generated rubber chirp.
- `metronome-tick.wav`: a brief generated pacing click.
- `bell-chime.wav`: generated decaying harmonics.
- `trigger-beep.wav`: the original chat's 800 Hz / 100 ms tone, rendered mathematically.

No Bambi Sleep recordings or extracted commercial samples were used. Snap and Wiper are local approximations, not the original Bambi Prime samples. The pinned STABLE-2.0 source contains no bundled audio and uses a common beep for all triggers.

Snap, Wiper, Pop, Inflate, Squeak, Tick and Bell share a −24 dBFS active-window RMS reference with peak protection. The legacy beep retains its original level. Per-sound main-page sliders adjust their playback gains independently.

Settings/associations live in `config/trigger-sounds.ts`; synthesis runs in `packages/audio/trigger-synthesis.ts`. `manifest.json` records provenance, sample rate, duration, gain, associations and SHA-256 hashes for the bundled WAVs. Previews/downloads are exposed in the Voice Lab.

Private user-provided MP3/WAV imports remain under ignored `runtime/imported-sounds/`, outside these CC0 assets. The runtime prefers those files locally when present; generated fallback sounds are available in a source-only installation. Trigger sequencing follows the shared speech/audio clock.
