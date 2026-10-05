# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

from pathlib import Path
import subprocess
root=Path('.runtime/toolchain').resolve();root.mkdir(parents=True,exist_ok=True)
for rpm in Path('.runtime/rpms').glob('*.rpm'):
 if 'i686' in rpm.name:continue
 p=subprocess.Popen(['rpm2cpio',str(rpm.resolve())],stdout=subprocess.PIPE)
 subprocess.run(['cpio','-idmu','--quiet'],stdin=p.stdout,cwd=root,check=True);p.wait()
p=root/'usr/lib64/libvulkan.so.1'
if not p.exists():p.symlink_to('/usr/lib64/libvulkan.so.1')
