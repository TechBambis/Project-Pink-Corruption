# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
# Separate commercial permissions: see LICENSING.md.

"""Private credentials for Node-to-Kokoro rendering; never sent to the browser."""
import os
from pathlib import Path
import secrets
import tempfile


def render_token():
    configured = os.environ.get('BAMBI_TTS_TOKEN')
    if configured is not None:
        if len(configured) != 64 or any(c not in '0123456789abcdef' for c in configured):
            raise ValueError('BAMBI_TTS_TOKEN must contain 64 lowercase hexadecimal characters')
        return configured
    path = Path(os.environ.get('BAMBI_TTS_TOKEN_FILE', 'runtime/tts-access.token'))
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    token = secrets.token_hex(32)
    # Rotate on startup and publish atomically; mkstemp creates a mode-0600 file.
    descriptor, temporary = tempfile.mkstemp(prefix='.tts-access-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            output.write(token)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return token
