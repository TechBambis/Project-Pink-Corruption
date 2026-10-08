# SPDX-FileCopyrightText: 2026 BambiOS
# SPDX-License-Identifier: AGPL-3.0-only
"""Use the shared JS policy over private pipes; no environment is persisted."""
import json
import os
import signal
import subprocess


def runtime_policy(root, action, **payload):
    command = [os.environ.get('BAMBI_RUNTIME_NODE', 'node'), str(root / 'scripts/accelerator-plan.mjs')]
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        output, _ = child.communicate(json.dumps({'action': action, **payload}), timeout=12)
        if child.returncode:
            raise RuntimeError('The shared acceleration policy failed. Check the installed application runtime.')
        return json.loads(output)
    finally:
        if child.poll() is None:
            # This child and its device probes belong to this invocation only.
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
