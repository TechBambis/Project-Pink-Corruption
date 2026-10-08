# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Package the small standalone cloud helpers using an explicit public-file allowlist."""
import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', nargs='?', help='Optional ZIP output path.')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
output = Path(args.output) if args.output else root / 'runtime/bambi-cloud-setup.zip'
selected = [
    'scripts/cloud/download-model.py',
    'scripts/cloud/check-network.py',
    'scripts/cloud/build-llama.sh',
    'scripts/cloud/serve-cydonia.sh',
    'scripts/cloud/server-config.py',
    'scripts/cloud/control-cydonia.py',
    'scripts/cloud/token-counter.py',
    'docs/cydonia-server-profiles.json',
    'docs/cydonia-cloud-model.json',
    'docs/CLOUD_COMPUTE.md',
]
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as bundle:
    for name in selected:
        bundle.write(root / name, 'bambi-cloud-setup/' + name)
    bundle.writestr('bambi-cloud-setup/README.md',
                     '# Cloud setup\n\nFollow [Cloud setup](docs/CLOUD_COMPUTE.md).\n')
with ZipFile(output) as bundle:
    if bundle.testzip() is not None:
        raise RuntimeError('Setup ZIP verification failed.')
print(f'Created {output} ({output.stat().st_size:,} bytes). No models, credentials or private app data included.')
