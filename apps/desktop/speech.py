# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
"""Frozen console entry point. Services retain their existing DSP/protocol."""
import sys
import faulthandler

faulthandler.enable()

if len(sys.argv) != 2 or sys.argv[1] not in ('kokoro', 'streaming'):
    raise SystemExit('Choose kokoro or streaming')
if sys.argv[1] == 'kokoro':
    from packages.speech.local.server import main
    from packages.speech.local.espeak import bundled_espeak_data
    with bundled_espeak_data():
        main()
else:
    from packages.speech.streaming.worker import run, load, emit
    try:
        run(load())
    except Exception:
        emit({'type': 'error', 'message': 'Local streaming speech failed. Retry setup.'})
        sys.exit(1)
