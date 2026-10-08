# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
"""Keep the bundled eSpeak data accessible within its native path buffer."""
from contextlib import contextmanager
import os
import sys
import espeakng_loader


@contextmanager
def bundled_espeak_data(data_path=None):
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
