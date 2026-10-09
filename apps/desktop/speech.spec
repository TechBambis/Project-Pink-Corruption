# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
from pathlib import Path
import sys
from PyInstaller.utils.hooks import collect_all, copy_metadata, collect_dynamic_libs
root = Path(SPECPATH).resolve().parents[1]
datas, binaries, imports = [], [], []
for package in ('espeakng_loader', 'phonemizer', 'kokoro_onnx', 'sherpa_onnx'):
    data, binary, hidden = collect_all(package)
    datas += data
    binaries += binary
    imports += hidden
for package in ('kokoro-onnx', 'phonemizer', 'sherpa-onnx-core', 'onnxruntime'):
    datas += copy_metadata(package)
binaries += collect_dynamic_libs('onnxruntime')
a = Analysis([str(root / 'apps/desktop/speech.py')], pathex=[str(root)], binaries=binaries,
             datas=datas, hiddenimports=imports, hookspath=[], hooksconfig={}, runtime_hooks=[],
             excludes=[], noarchive=False, optimize=0)
# ctypes fallback analysis discovers host eSpeak/audio libraries. Kokoro explicitly
# uses the wheel's eSpeak library/data. Do not accidentally redistribute host audio stacks.
a.binaries = [entry for entry in a.binaries
              if not entry[1].startswith(('/lib64/', '/usr/lib64/'))]
pyz = PYZ(a.pure)
# eSpeak consumes UTF-8 paths; select that code page before CRT initialization.
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='bambi-speech', console=True, upx=False,
          target_arch='arm64' if sys.platform == 'darwin' else None,
          manifest=str(root / 'apps/desktop/speech.manifest') if sys.platform == 'win32' else None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='bambi-speech')
