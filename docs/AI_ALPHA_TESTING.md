# Getting started

[Download the alpha](https://github.com/TechBambis/Project-Pink-Corruption/releases). Windows needs the **.exe**; Linux needs the **.AppImage**. No Node, Python or compiler installation is needed. Private downloads require repository access.

1. Open the app, save your **Privacy & access** choices and try the included offline sample.
2. Choose a model in setup. The reference Qwen3.5 9B profile plus speech data downloads about **6.05 GB**; allow **15 GB free space**. Existing supported model files/folders can be imported instead. The tested Linux reference has 16 GB RAM and an 8 GB GPU.
3. After verification, start local AI. Try text, voice, Audio Mute, Mic Mute and End session. The first model start can take longer.
4. Quit and reopen offline after setup. Saved models and settings remain in your profile when replacing the application.
5. Find export, import and shared presets in **Extras → Settings & presets**. [Details](SETTINGS_BACKUP.md).

Studio includes a chime sample for import/preview/export. Export your own Studio drafts before closing.

If Linux cannot mount the AppImage, run `chmod +x FILE.AppImage`, then `./FILE.AppImage --appimage-extract` and `squashfs-root/AppRun`. `--bambi-port=N` selects three consecutive ports; `--bambi-user-data=/absolute/path` selects a dedicated profile.

**Still being tested:** Windows 11 full-model GPU/CPU/offline use, physical microphone/listening, sleep/wake and broader Linux compatibility. macOS/ARM, devices, online media and automatic updates are not available as qualified alpha features. Keep OS security controls enabled; report blocked installation or launch.

The optional technical ZIP contains matching source, notices, test reports and a Windows reference-test kit. Most users do not need it.
