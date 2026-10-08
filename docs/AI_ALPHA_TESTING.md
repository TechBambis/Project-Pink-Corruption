# Try the local-AI alpha

The accompanied AI alpha includes local chat and speech runtimes, model setup, saved model folders and **Extras → Settings & presets**. No account, payment, Node, Python or compiler installation is required to run it. Model data is installed separately after your explicit choice.

Choose the newest **AI alpha** from [GitHub Releases](https://github.com/TechBambis/Project-Pink-Corruption/releases). A release labelled **Smoke** tests packaging and playback and does not contain local AI.

| Your computer | Download |
| --- | --- |
| Windows x64 | The `.exe` installer |
| Linux x64 | The `.AppImage` |

The optional technical-details/source archive contains matching source, notices, capability records, verification instructions and the Windows reference-test kit. You do not install this archive as another application. Private repository downloads require repository access. macOS and ARM targets are not included in this alpha.

## First run

1. Install/open the program and save your Privacy & access choices. Try the included offline sample first.
2. Open model setup and choose the reference Qwen3.5 9B Q4_K_M profile. Download and verify, or choose existing supported model files/folders. Chat plus speech data is about 6.05 GB; allow at least 15 GB free space for setup and the application. Reference hardware has 16 GB RAM and an 8 GB compatible GPU; these are tested conditions rather than universal minimum requirements.
3. After verification, start local AI. Cold model preparation and initial full-prompt processing can take longer than warm replies. Test text, speech and the separate Audio Mute, Mic Mute and End session controls.
4. Quit and reopen offline after setup to test local operation. On Windows, follow the optional reference kit for automatic acceleration and CPU-mode observations.
5. Open **Extras → Settings & presets** to export settings, share a preset or preview an import. Imported settings do not grant permissions, start sessions or download models. See [settings transfer](SETTINGS_BACKUP.md).

The release notes and capability records list the actual tested OS/hardware and outstanding checks. Full-model Windows 11 GPU/CPU/offline behavior, physical microphone/listening, sleep/wake and recipient security behavior require reference observations. Linux results on the Fedora reference do not qualify every distribution. Devices, online media and automatic updates remain unqualified. Keep ordinary OS security controls enabled and report blocked installation/launch.

A shared preset is a configuration recipe; live AI output need not be identical. Personal settings files can contain personal text, shown in the export preview. Share portable presets deliberately and retain private backups privately.
