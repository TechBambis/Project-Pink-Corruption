# Getting started

[Download the alpha](https://github.com/TechBambis/Project-Pink-Corruption/releases). Windows needs the **.exe**; Ubuntu 24.04 needs the **.deb**; other Linux systems use the **.AppImage**. Apple Silicon Mac (macOS 14+) uses the ZIP: extract it and copy Bambi Local to Applications. No Node, Python or compiler installation is needed. Downloads need no GitHub sign-in.

1. Open the app, save your **Privacy & access** choices and try the included offline sample.
2. Open **Get AI & voice models** in Setup, choose a model and select **Download and verify**. The reference Qwen3.5 9B profile plus speech data downloads about **6.05 GB**; allow **15 GB free space**. Existing supported model files/folders can be imported instead. The tested Linux reference has 16 GB RAM and an 8 GB GPU.
3. After verification, choose **Start local AI**. The default voice is **Bambi Mix (Kokoro)**. Try text, voice, Audio Mute, Mic Mute and End session. The first model start can take longer.
4. Quit and reopen offline after setup. Saved models and settings remain in your profile when replacing the application.
5. Find export, import and shared presets in **Extras → Settings & presets**. [Details](SETTINGS_BACKUP.md).

Studio includes a chime sample for import/preview/export. Export your own Studio drafts before closing.

On Ubuntu 24.04, install the Debian package with the system package installer, or `sudo apt install ./bambi-local-0.1.0-alpha.41-linux-amd64.deb`. It installs the Chromium sandbox helper with the required ownership and permissions.

If Linux cannot mount the AppImage, run `chmod +x FILE.AppImage`, then `./FILE.AppImage --appimage-extract` and `squashfs-root/AppRun`. `--bambi-port=N` selects three consecutive ports; `--bambi-user-data=/absolute/path` selects a dedicated profile.

**Still being tested:** Windows 11 and Apple Silicon full-model GPU/CPU/offline use, physical microphone/listening, sleep/wake and broader Linux compatibility. Intel Macs, Linux ARM, devices, online media and automatic updates are not qualified in this alpha. Keep OS security controls enabled; report blocked installation or launch.

The optional technical ZIP contains matching source, notices, test reports and a Windows reference-test kit. Most users do not need it.
