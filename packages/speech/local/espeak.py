# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
"""Keep the bundled eSpeak data accessible within its native path buffer."""
from contextlib import contextmanager
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import espeakng_loader


@contextmanager
def bundled_espeak_data(data_path=None):
    if sys.platform == 'darwin':
        # phonemizer resolves its explicit path before native initialization.
        # eSpeak's fallback must stay short even when the app is relocated into
        # a long Unicode path. Only an alias to immutable bundled data is made.
        with TemporaryDirectory(prefix='bambi-espeak-', dir='/tmp') as temporary:
            alias = Path(temporary) / 'espeak-ng-data'
            alias.symlink_to(Path(data_path or espeakng_loader.get_data_path()).resolve(),
                             target_is_directory=True)
            previous = os.environ.get('ESPEAK_DATA_PATH')
            os.environ['ESPEAK_DATA_PATH'] = str(alias)
            try:
                yield
            finally:
                if previous is None:
                    os.environ.pop('ESPEAK_DATA_PATH', None)
                else:
                    os.environ['ESPEAK_DATA_PATH'] = previous
        return
    # eSpeak 1.52 has a small fixed path buffer. A Linux directory descriptor
    # names the very same immutable files without copying them or changing cwd.
    # phonemizer resolves its explicit path, so use eSpeak's own fallback lookup.
    if sys.platform != 'linux':
        yield
        return
    descriptor = os.open(data_path or espeakng_loader.get_data_path(),
                         os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    previous = os.environ.get('ESPEAK_DATA_PATH')
    os.environ['ESPEAK_DATA_PATH'] = f'/proc/self/fd/{descriptor}'
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop('ESPEAK_DATA_PATH', None)
        else:
            os.environ['ESPEAK_DATA_PATH'] = previous
        os.close(descriptor)
