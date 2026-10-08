# BambiCloud playback

BambiCloud playlists contain finished recordings. Playback uses their original audio and full duration, without automatic AI narration, extra ticks or background beds.

1. In **Library → From BambiCloud**, paste a public `https://bambicloud.com/playlist/<uuid>` URL and choose **Add playlist**.
2. Select a track and **Play session**. Import itself does not start playback.
3. Optionally enable **Show timed trigger words & visuals**; it is off by default.

Search, favorites, notes and tags are saved locally. Reimporting a playlist deduplicates it. Playback continues through available tracks in that playlist only; private/locked tracks remain unavailable. Missing cues do not prevent audio playback. No AI model or TTS is needed.

Pause, Seek, volume and End session use the normal player. Finished playlists complete the session. Selecting a recording restores original-media mode; optional AI accompaniment is a separate choice. AI duration settings do not cut recordings short.

## Integration

`packages/media/bambicloud.ts` validates public metadata/cues; the server proxies approved HTTPS audio origins with redirect checks, Range support, cancellation and payload limits (2 MiB metadata/cues, 1 GiB audio). Cookies are not forwarded; media is not archived to disk. Requests require online-media access and a user action.

Cue words/visuals follow source timing on the media clock. They do not imply device choreography. Audio-driven haptics remain an unimplemented proposal; the existing device arming/limits and independent Stop stay authoritative.

Run `node --import tsx --test tests/bambicloud.test.ts` and `node scripts/bambicloud-browser-check.mjs` after building. Fixtures cover import, playback, cues, seeking, continuation and Stop. Real recordings need listening/timing checks.

Source media and cue data belong to BambiCloud/their creators. Audio-sync research used [HarleyVader's Church player](https://github.com/HarleyVader/js-bambisleep-church/blob/aaffd4212f2c448e2792cadf298b2011f55fafa8/public/audio-player.js); that research did not copy its source into this app.
