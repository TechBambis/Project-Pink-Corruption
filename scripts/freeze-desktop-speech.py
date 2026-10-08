# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
"""Run only with the clean, pinned alpha build environment on the native target."""
from pathlib import Path
import os
import PyInstaller.__main__

root = Path(__file__).resolve().parents[1]
PyInstaller.__main__.run([
    str(root / 'apps/desktop/speech.spec'), '--noconfirm',
    '--distpath=' + str(os.environ.get('BAMBI_SPEECH_DISTPATH', root / '.runtime/alpha-speech')),
    '--workpath=' + str(os.environ.get('BAMBI_SPEECH_WORKPATH', root / '.runtime/alpha-speech-build')),
])
