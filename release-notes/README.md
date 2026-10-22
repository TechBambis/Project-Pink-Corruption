# Release notes

Codex writes the release notes as part of preparing **every** release, including manually published AI alphas. There is no runtime AI call or bot to host. The published GitHub body is also the Discord post; a hidden delivery receipt is the only extra GitHub markup.

Before tagging, create `release-notes/TAG.md`, for example `release-notes/v0.1.0-alpha.42.md`. Write 40–110 words in casual English: a short opening, one to five useful change bullets, and any limitation or action people need to know. No emojis, mentions, hype, commit lists or implementation jargon. Explain what changes for the person using the app. Check the actual changes and packages; do not invent features or imply unfinished work is included. Add exact platform download links when preparing a manual release. Smoke downloads and their scope warning are added by the tag publisher.

Preview locally without posting:

```sh
node scripts/release-notes.mjs preview v0.1.0-alpha.42
```

For a manual release, use this file as `gh release create TAG --notes-file release-notes/TAG.md` (with the already verified release's normal assets and options). Never use generated notes or paste a technical commit dump. Commit the notes with that release's source. The tag publisher requires the matching notes before starting native jobs and uses them for the GitHub release.

Published releases trigger `.github/workflows/discord-release.yml`. The tag publisher calls the same sender directly after publication, because releases created with `GITHUB_TOKEN` do not trigger another workflow. If another automation publishes using `GITHUB_TOKEN`, it must also call `node scripts/discord-release.mjs TAG` with `GH_TOKEN`, `GITHUB_REPOSITORY` and `DISCORD_RELEASE_WEBHOOK`, or explicitly dispatch the changelog workflow after publication. The sender reads the published GitHub body, checks the target channel/server, and disables all mention parsing and link previews.

The repository secret `DISCORD_RELEASE_WEBHOOK` targets channel `1559980104560681035` on server `1559980103650386000`. Only the release notification jobs receive it. No Discord bot token is used by Actions. Never commit the webhook URL or print it in logs.

The sender saves a hidden message receipt in the GitHub body. Running the workflow again updates that message rather than posting another. A timeout during sending or a failed receipt write requires checking the channel before retrying; errors provide the receipt to recover when Discord confirmed delivery. Do not remove an existing receipt. Editing release text does not automatically announce again; dispatch the workflow with its tag to update the original Discord message. Old releases are not backfilled automatically.
