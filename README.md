# Project Pink Corruption 💕

Bambi Local is a free local companion for the hypnosis community: chat, voice, spirals, your own media and Session Studio.

[**Download for Windows, Linux or Mac**](https://github.com/TechBambis/Project-Pink-Corruption/releases)

Windows: install the **.exe**. Linux: open the **.AppImage**. Apple Silicon Mac: extract the **macos-arm64.zip**. Choose and download a model inside the app. No developer tools needed.

This is an alpha. Kokoro’s Bambi Mix is the default voice. GPU/CPU/offline use, microphone, physical audio and sleep/wake need testing on each recipient’s machine. Private downloads require repository access.

[Getting started](docs/AI_ALPHA_TESTING.md) · [Settings & presets](docs/SETTINGS_BACKUP.md) · [Report a bug](https://github.com/TechBambis/Project-Pink-Corruption/issues) · [Discussions](https://github.com/TechBambis/Project-Pink-Corruption/discussions)

## Development

Node.js 22.13+ and npm:

```sh
npm ci --ignore-scripts
npm run setup
npm start
```

Open [localhost:6969/setup](http://127.0.0.1:6969/setup). Native development setup targets Linux.

[Setup & contributing](CONTRIBUTING.md) · [Architecture](ARCHITECTURE.md) · [Desktop builds](docs/DESKTOP_RELEASE.md) · [Security](SECURITY.md)

## Credits & license

Prompts, triggers and guides include [HarleyVader's js-bambisleep-chat STABLE-2.0](https://github.com/HarleyVader/js-bambisleep-chat/tree/STABLE-2.0). [Credits](docs/STABLE_CONTENT.md).

Original code: [AGPL-3.0-only](LICENSE). [Licensing & third-party notices](LICENSING.md).
