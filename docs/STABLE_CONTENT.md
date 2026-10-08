# Upstream content

Bambi Local reuses [HarleyVader/js-bambisleep-chat STABLE-2.0](https://github.com/HarleyVader/js-bambisleep-chat/tree/3f5e9b336382f1f49ac2edde3c0281845f74b0a3), commit `3f5e9b336382f1f49ac2edde3c0281845f74b0a3`. Its package declaration is MIT; the retained [MIT notice](LICENSE.stable2) records attribution. The previously imported backup2 geometry retains [Apache-2.0](LICENSE.backup2).

[manifest.json](../packages/content/stable-2.0/manifest.json) pins 20 files by size/SHA-256: prompts, 24 triggers, 14 in-app guides, license declaration and worker/renderer references. The Classic prompt is an explicit local override; [local-overrides.json](../packages/content/local-overrides.json) identifies its preserved original. Other selected files retain pinned bytes. The original guides remain accessible under `/content/stable-2.0/public/docs/` and describe upstream behavior.

| Reused content | Local adaptation |
| --- | --- |
| Classic/Gentle prompts, collar and strategy | Complete authored sections in runtime prompts, selected collar only; phase/task guidance appended |
| Triggers | Original definitions, optional highlighting/pulse/tone; local sound additions configured separately |
| Ambient directives | Running Ambient sessions only; idle threshold five minutes, checks 60 seconds, cooldown three minutes |
| Spiral | Original source retained; current display adds analytic bands, scene presets and reduced-motion behavior |
| Brainwave presets | Original frequencies/default levels; local mixer corrects stereo separation |
| Voice blending | Local Kokoro and two-voice mixing |
| Material links/guides | Original BambiCloud, Church and Wiki links and all 14 guides |

The local UI, storage, clock, cancellation and process lifecycle are independent. Pause freezes session effects; Stop removes output and generation. No community accounts, subscriptions, camera calibration or platform downloads are activated by the import. Upstream contains no audio/video footage; provider links do not imply a downloaded library.

`tests/content.test.ts` checks selected files/hashes, override format and upstream prompt substitution. Route checks verify the 14 guides are served while manifest/reference workers are withheld. Preserve upstream originals and notices when editing integrations.
