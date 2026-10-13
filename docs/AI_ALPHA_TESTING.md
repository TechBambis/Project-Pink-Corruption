# Getting started

[Download the alpha](https://github.com/TechBambis/Project-Pink-Corruption/releases). Windows x64 uses the **.exe** installer or optional **windows-x64.zip** (extract the complete folder and open Bambi Local.exe); Linux x64 needs the **.AppImage**; Apple Silicon Mac (macOS 14+) needs the **macos-arm64.zip**. On Mac, extract the ZIP and copy Bambi Local to Applications. No Node, Python or compiler installation is needed. Private downloads require repository access.

1. Open the app, save your **Privacy & access** choices and try the included offline sample.
2. In Setup choose **Get AI & voice models**, review the selected model and choose **Download and verify**. This installs the AI, Bambi Mix voice and English microphone data together; no separate model website is needed. If downloads are off, the button opens Privacy & access at Model downloads. Save that choice and click Download again. The reference Qwen3.5 9B profile plus speech data downloads about **6.05 GB**; allow **15 GB free space**. Existing supported model files/folders can be imported instead. The tested Linux reference has 16 GB RAM and an 8 GB GPU.
3. After verification, start local AI. The default is the original **Bambi Mix** (Nicole 15%, Bella 42.5%, Heart 42.5%) through Kokoro at speed 0.78. Try text, voice, Audio Mute, Mic Mute and End session. The first model start can take longer.
4. Quit and reopen offline after setup. Saved models and settings remain in your profile when replacing the application.
5. Find export, import and shared presets in **Extras → Settings & presets**. [Details](SETTINGS_BACKUP.md).

Studio includes a chime sample for import/preview/export. Export your own Studio drafts before closing.

If Linux cannot mount the AppImage, run `chmod +x FILE.AppImage`, then `./FILE.AppImage --appimage-extract` and `squashfs-root/AppRun`. `--bambi-port=N` selects three consecutive ports; `--bambi-user-data=/absolute/path` selects a dedicated profile.

**Still being tested:** Windows 11 full-model GPU/CPU/offline use, physical microphone/listening, sleep/wake and broader Linux compatibility. Intel Macs, Linux ARM, devices, online media and automatic updates are not qualified alpha features. macOS builds have an ad-hoc signature and are not notarized. Keep OS security controls enabled; report blocked installation or launch.

The optional technical ZIP contains matching source, notices, test reports and a Windows reference-test kit. Most users do not need it.

Try reactive and situational chat, guided journeys, live captions, interruptions, and Studio import/preview/export. In Extras, Settings & presets retains ordinary settings transfer; Profiles & backups adds offline setting codes and optional encrypted backups. Export a backup before changing versions; local media files must be reselected after restoring.

MOSS and other voice experiments are separate, optional research tools and are not installed by the alpha setup. Use Bambi Mix for this test release. Report your exact app version, operating system, hardware, selected model/accelerator, steps and result. Never include private conversations, recordings, passwords or access tokens in a public report.
